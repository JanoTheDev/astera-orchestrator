// W8-C heavy: `astera heavy -- <cmd…>` — at most N heavy jobs (full test suite, Electron, dist build) at once on
// this machine, N the app setting heavyJobsAtOnce (core/settings/heavyJobs.ts, default 1). The owner's old laptop
// crashed from parallel full suites, so this is a hard limit, not a hint.
//
// Two parts:
// - N OS locks, one per slot (`heavySlotLock`). Slot 0 is `/tmp/astera-fullsuite.lock`, the same file hand-opened
//   tabs take with `flock /tmp/astera-fullsuite.lock …`, so both kinds share it. The command runs under util-linux
//   `flock` on its slot, and the kernel drops the lock when the holder dies, so a crash releases it.
// - FIFO order among `astera heavy` callers: one ticket file per caller in a queue dir beside the lock, named
//   so that the names sort by arrival. A caller waits until its ticket is among the first N, then takes the first
//   free slot (`takeHeavySlot`); none free (a hand-opened tab holds one) and it keeps waiting. A ticket whose pid is
//   dead is dropped, so a crashed waiter never blocks the queue.
//
// It runs in the CLI process (cli/run.ts), not through the Host: the command's stdio is the caller's terminal.
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { constants } from 'node:os'
import { join } from 'node:path'

export const HEAVY_LOCK = '/tmp/astera-fullsuite.lock'
export const HEAVY_QUEUE_DIR = '/tmp/astera-heavy-queue'

export interface HeavyTicket {
  /** The ticket's file name in the queue dir; names sort by arrival. */
  file: string
  pid: number
  cmd: string
  cwd: string
  /** The agent session that asked (ASTERA_SESSION), so the Host can show its place on the board. */
  sessionId?: string
  at: number
  /** 'check': taken by a Task's check (exec/validation.ts heavySlot); 'delivery': the delivery check's (host/checks.ts
   *  validateTree), which never supersedes or is superseded by a 'check' of its cwd; absent: `astera heavy`. */
  kind?: 'check' | 'delivery'
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // EPERM: alive, just someone else's
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readTicket(dir: string, file: string): HeavyTicket | null {
  try {
    const t = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Omit<HeavyTicket, 'file'>
    return typeof t.pid === 'number' ? { ...t, file } : null
  } catch {
    return null
  }
}

/** The live tickets in arrival order. A missing dir is an empty queue. Reads only; it never deletes. */
export function heavyQueue(dir: string = HEAVY_QUEUE_DIR, alive: (pid: number) => boolean = pidAlive): HeavyTicket[] {
  let names: string[]
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
  } catch {
    return []
  }
  return names.map((n) => readTicket(dir, n)).filter((t): t is HeavyTicket => t !== null && alive(t.pid))
}

/** Each waiting session's place in line, 1-based. The first `slots` tickets are the ones running (or about to take
 *  a slot), so they are not waiting; the next is 1st in line. */
export function heavyWaits(dir: string = HEAVY_QUEUE_DIR, alive?: (pid: number) => boolean, slots = 1): Map<string, number> {
  const out = new Map<string, number>()
  heavyQueue(dir, alive).forEach((t, i) => {
    if (i >= slots && t.sessionId && !out.has(t.sessionId)) out.set(t.sessionId, i - slots + 1)
  })
  return out
}

/** Slot k's OS lock: slot 0 is the lock itself (hand-opened tabs share it), slot k > 0 `<lock without .lock>.<k>.lock`. */
export const heavySlotLock = (lock: string, k: number): string => (k === 0 ? lock : `${lock.replace(/\.lock$/, '')}.${k}.lock`)

/** flock's exit code when the slot is taken (`-E`); told apart from the command's own exit by the fd 3 marker. */
const SLOT_TAKEN = 75

/** Takes the first free one of `slots` slots: `flock -n <slotLock> <cmd…>`, which writes a marker on fd 3 once it
 *  holds the lock (fd 3 is closed before the command runs). Answers the holding child with its exit code (a signal is
 *  128+n), or 'busy' when every slot is held. Rejects when flock cannot run, with `exitCode` (127 for a missing flock,
 *  else flock's own exit). */
export async function takeHeavySlot(a: {
  lock: string
  slots: number
  cmd: string[]
  stdio: StdioOptions
  env?: NodeJS.ProcessEnv
  cwd?: string
}): Promise<{ child: ChildProcess; exited: Promise<number> } | 'busy'> {
  const io = typeof a.stdio === 'string' ? [a.stdio, a.stdio, a.stdio] : [...a.stdio].slice(0, 3)
  for (let k = 0; k < Math.max(1, a.slots); k++) {
    const slotLock = heavySlotLock(a.lock, k)
    const child = spawn('flock', ['-n', '-E', String(SLOT_TAKEN), slotLock, 'sh', '-c', 'echo held >&3; exec 3>&-; exec "$@"', 'sh', ...a.cmd], {
      stdio: [...io, 'pipe'],
      env: a.env,
      cwd: a.cwd
    })
    const marker = child.stdio[3]!
    // The marker's data, or its close without data (flock never held the lock). Its close comes after its data, so
    // this is settled right even when the exit is seen first
    const heldOrNot = new Promise<boolean>((r) => {
      marker.once('data', () => r(true))
      marker.once('close', () => r(false))
    })
    const exited = new Promise<number>((resolve, reject) => {
      child.once('error', (e) => reject(Object.assign(new Error(`could not run flock (util-linux): ${e.message}`), { exitCode: 127 })))
      child.once('exit', (code, signal) => resolve(code ?? 128 + (signal ? (constants.signals[signal] ?? 0) : 0)))
    })
    exited.catch(() => {}) // awaited below; a flock that cannot spawn must not read as an unhandled rejection meanwhile
    if (await heldOrNot) {
      marker.destroy()
      return { child, exited }
    }
    const code = await exited
    if (code !== SLOT_TAKEN) throw Object.assign(new Error(`flock ${slotLock} ended (${String(code)}) before it held the lock`), { exitCode: code })
  }
  return 'busy'
}

let seq = 0

export interface RunHeavyArgs {
  /** The tokens after `heavy`: `-- <cmd> [args…]`. */
  argv: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  sessionId?: string
  lock?: string
  queueDir?: string
  pollMs?: number
  /** How many heavy jobs run at once (the heavyJobsAtOnce setting, read by the caller); 1 when left out. */
  slots?: number
  /** Tests pass 'ignore'; the CLI gives the command the caller's terminal; the source updater passes a log file's fds. */
  stdio?: StdioOptions
  /** Where the usage text and errors go. */
  err?: (text: string) => void
  usage?: string
}

/** Waits for a slot, runs the command under its lock, and resolves with its exit code (a signal is 128+n). */
export async function runHeavy(a: RunHeavyArgs): Promise<number> {
  const err = a.err ?? ((t: string) => process.stderr.write(t.endsWith('\n') ? t : `${t}\n`))
  const sep = a.argv.indexOf('--')
  const before = sep === -1 ? a.argv : a.argv.slice(0, sep)
  const cmdline = sep === -1 ? a.argv : a.argv.slice(sep + 1)
  const usage = a.usage ?? 'usage: astera heavy -- <command> [args…]'
  if (before.some((t) => t === '--help' || t === '-h')) {
    err(usage)
    return 0
  }
  if (cmdline.length === 0 || (sep === -1 && cmdline[0].startsWith('-'))) {
    err(usage)
    return 2
  }
  const lock = a.lock ?? HEAVY_LOCK
  const dir = a.queueDir ?? HEAVY_QUEUE_DIR
  const pollMs = a.pollMs ?? 300
  const slots = a.slots ?? 1
  // Owner-only: one user on this machine, and Ubuntu's umask 002 would otherwise make it group-writable (CONTEXT rule 7).
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const name = `${process.hrtime.bigint().toString().padStart(20, '0')}-${String(process.pid).padStart(8, '0')}-${String(seq++).padStart(4, '0')}.json`
  const path = join(dir, name)
  const body = JSON.stringify({ pid: process.pid, cmd: cmdline.join(' '), cwd: a.cwd, ...(a.sessionId ? { sessionId: a.sessionId } : {}), at: Date.now() })
  const writeTicket = (): void => {
    // Write then rename, so a reader (the Host) never sees half a ticket.
    writeFileSync(`${path}.tmp`, body)
    renameSync(`${path}.tmp`, path)
  }
  const drop = (): void => rmSync(path, { force: true })
  writeTicket()

  let child: ReturnType<typeof spawn> | null = null
  let stopped: ((code: number) => void) | null = null
  const onSignal = (sig: NodeJS.Signals): void => {
    if (child) child.kill(sig)
    else {
      drop()
      stopped?.(128 + (constants.signals[sig] ?? 0))
    }
  }
  process.on('exit', drop)
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  const cleanup = (): void => {
    drop()
    process.off('exit', drop)
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }

  try {
    const waited = await new Promise<{ child: ChildProcess; exited: Promise<number> } | number>((resolve) => {
      stopped = resolve
      const tick = async (): Promise<void> => {
        if (stopped === null) return
        // A crashed waiter's ticket is dropped here, so it never blocks the line.
        try {
          for (const n of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
            const t = readTicket(dir, n)
            if (t !== null && !pidAlive(t.pid)) rmSync(join(dir, n), { force: true })
          }
        } catch {
          /* dir gone: recreated below */
        }
        const q = heavyQueue(dir)
        const at = q.findIndex((t) => t.file === name)
        if (at === -1) {
          mkdirSync(dir, { recursive: true, mode: 0o700 })
          writeTicket()
        } else if (at < slots) {
          try {
            const took = await takeHeavySlot({ lock, slots, cmd: cmdline, stdio: a.stdio ?? 'inherit', env: a.env, cwd: a.cwd })
            if (took !== 'busy') {
              // A signal while flock was being asked: the ticket is gone and the caller answered, so let it go too
              if (stopped === null) took.child.kill('SIGTERM')
              return resolve(took)
            }
          } catch (e) {
            err(`astera heavy: ${(e as Error).message}`)
            return resolve((e as { exitCode?: number }).exitCode ?? 1)
          }
        }
        setTimeout(() => void tick(), pollMs)
      }
      void tick()
    })
    stopped = null
    if (typeof waited === 'number') return waited
    child = waited.child
    return await waited.exited
  } finally {
    cleanup()
  }
}
