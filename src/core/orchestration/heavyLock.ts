// W8-C heavy: `astera heavy -- <cmd…>` — one heavy job (full test suite, Electron, dist build) at a time on
// this machine. The owner's laptop crashed from parallel full suites, so this is a hard limit, not a hint.
//
// Two parts:
// - The OS lock is `/tmp/astera-fullsuite.lock`, the same file hand-opened tabs take with
//   `flock /tmp/astera-fullsuite.lock …`, so both kinds share one slot. The command runs under util-linux
//   `flock`, and the kernel drops the lock when the holder dies, so a crash releases it.
// - FIFO order among `astera heavy` callers: one ticket file per caller in a queue dir beside the lock, named
//   so that the names sort by arrival. A caller waits until its ticket is first, then takes the OS lock. A ticket
//   whose pid is dead is dropped, so a crashed waiter never blocks the queue.
//
// It runs in the CLI process (cli/run.ts), not through the Host: the command's stdio is the caller's terminal.
import { spawn, type StdioOptions } from 'node:child_process'
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

/** Each waiting session's place in line, 1-based. The first ticket is the one running (or about to take the
 *  lock), so it is not waiting; the second is 1st in line. */
export function heavyWaits(dir: string = HEAVY_QUEUE_DIR, alive?: (pid: number) => boolean): Map<string, number> {
  const out = new Map<string, number>()
  heavyQueue(dir, alive).forEach((t, i) => {
    if (i >= 1 && t.sessionId && !out.has(t.sessionId)) out.set(t.sessionId, i)
  })
  return out
}

/** One session's place among the waiters, 1-based, or undefined when it is not waiting. */
export const positionOf = (sessionId: string, dir: string = HEAVY_QUEUE_DIR): number | undefined => heavyWaits(dir).get(sessionId)

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
  /** Tests pass 'ignore'; the CLI gives the command the caller's terminal; the source updater passes a log file's fds. */
  stdio?: StdioOptions
  /** Where the usage text and errors go. */
  err?: (text: string) => void
  usage?: string
}

/** Waits for the slot, runs the command under the lock, and resolves with its exit code (a signal is 128+n). */
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
    const waited = await new Promise<number | null>((resolve) => {
      stopped = resolve
      const tick = (): void => {
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
        if (!q.some((t) => t.file === name)) {
          mkdirSync(dir, { recursive: true, mode: 0o700 })
          writeTicket()
        } else if (q[0].file === name) return resolve(null)
        setTimeout(tick, pollMs)
      }
      tick()
    })
    stopped = null
    if (waited !== null) return waited
    return await new Promise<number>((resolve) => {
      const c = spawn('flock', [lock, ...cmdline], { stdio: a.stdio ?? 'inherit', env: a.env, cwd: a.cwd })
      child = c
      c.on('error', (e) => {
        err(`astera heavy: could not run flock (util-linux): ${e.message}`)
        resolve(127)
      })
      c.on('exit', (code, signal) => resolve(code ?? 128 + (signal ? (constants.signals[signal] ?? 0) : 0)))
    })
  } finally {
    cleanup()
  }
}
