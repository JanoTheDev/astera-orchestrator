// Dependency setup for a fresh worktree: a `git worktree add` checkout has no node_modules, so a repository whose
// pre-push hook needs its tools rejected every push of the plan. forkWorktree runs this once the worktree exists.
//
// An install is heavy work (`npm ci` peaks near 0.7 GB, a large `bun install` near 1.7 GB), so with `heavy` it first
// waits for one of the machine's heavy slots, the ones `astera heavy` and the heavy checks take (heavyLock.ts): 25
// agents may start at once, but only that many installs run at once.
//
// This module must stay importable by the Host: no electron, nothing from src/main.

import { AsyncLocalStorage } from 'node:async_hooks'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { killProcessTree } from '../run/kill'
import { HEAVY_QUEUE_DIR, heavyQueue } from '../orchestration/heavyLock'
import { heavySlot } from '../orchestration/exec/validation'

export const LOCKFILES: [files: string[], command: string][] = [
  [['bun.lock', 'bun.lockb'], 'bun install --frozen-lockfile'],
  [['pnpm-lock.yaml'], 'pnpm install --frozen-lockfile'],
  [['yarn.lock'], 'yarn install --frozen-lockfile'],
  [['package-lock.json'], 'npm ci']
]

export const SETUP_TIMEOUT_MS = 15 * 60_000
/** The longest a worker start's install waits for a heavy slot (forkWorktree passes it as `maxWaitMs`). Past it the
 *  install is skipped and the worker starts without it, as after a failed install: a start must end inside its bound
 *  (stallWatch.ts INSTALL_START_WINDOW_MS), and running it without a slot is the load the slots exist to stop. */
export const SETUP_SLOT_WAIT_MS = 30 * 60_000
const TAIL_CHARS = 4000

const exists = (p: string): Promise<boolean> => fs.access(p).then(() => true, () => false)

/** The install command for the package manager whose lockfile is in `dir`, first match wins; null when there is none. */
export async function detectSetupCommand(dir: string): Promise<string | null> {
  for (const [files, command] of LOCKFILES)
    for (const f of files) if (await exists(path.join(dir, f))) return command
  return null
}

export interface SetupResult {
  ran: boolean
  ok: boolean
  command: string | null
  /** The last ~4000 characters of the command's output (or the reason it never ran). */
  tail: string
}

/** How an install waits for one of the machine's heavy slots (exec/validation.ts heavySlot, kind 'setup'). */
export interface SetupHeavy {
  /** How many heavy jobs run at once (the heavyJobsAtOnce setting), read when the install queues. */
  slots(): Promise<number>
  /** Asked while waiting: true once nobody wants the install any more. It is then skipped. */
  abandoned?(): boolean
  /** Test seams: the slot lock and the queue dir (heavyLock.ts HEAVY_LOCK, HEAVY_QUEUE_DIR), the poll. */
  lock?: string
  queueDir?: string
  pollMs?: number
  /** The longest wait for a slot; past it the install is skipped. Absent: it waits until it gets one. */
  maxWaitMs?: number
  /** Called once, when the install will run and is about to wait for its slot. */
  queued?(): void
}

/** Runs the project's setup command in `dir`. `setting` is the project's `setupCommand`: absent detects from the
 *  lockfile, `off` runs nothing, anything else runs as given. Skipped when `dir/node_modules` is already there, unless
 *  `force`: a delivery whose merges changed the manifest or lockfile installs over the old tree.
 *  With `heavy`, an install that will run first waits for a heavy slot and holds it until it ends, fails or times out;
 *  its timeout starts once it holds the slot. A slot that cannot be taken (the lock cannot be made) is logged and the
 *  install runs without one, so it never blocks the worker for good.
 *  Never throws: a failure, a missing tool or a timeout is logged and returned, and the worker starts anyway. */
export async function runWorktreeSetup(o: {
  dir: string
  setting?: string
  log(m: string): void
  timeoutMs?: number
  force?: boolean
  heavy?: SetupHeavy
}): Promise<SetupResult> {
  const skipped: SetupResult = { ran: false, ok: true, command: null, tail: '' }
  if (o.setting === 'off') return skipped
  const command = o.setting ?? (await detectSetupCommand(o.dir))
  if (command === null || (!o.force && (await exists(path.join(o.dir, 'node_modules'))))) return skipped
  let release: (() => void) | undefined
  if (o.heavy) {
    const slot = await waitForSlot(o.heavy, command, o.dir, o.log)
    if (slot.kind === 'skip') return { ran: false, ok: slot.ok, command, tail: slot.why }
    release = slot.release
  }
  try {
    const result = await run(command, o.dir, o.timeoutMs ?? SETUP_TIMEOUT_MS)
    o.log(
      result.ok
        ? `setup: ${JSON.stringify(command)} finished in ${o.dir}`
        : `setup: ${JSON.stringify(command)} failed in ${o.dir}, so the worker starts without it: ${result.tail}`
    )
    return { ran: true, ...result, command }
  } finally {
    release?.()
  }
}

/** Waits for a heavy slot for `command` in `dir`: its release, none (the slot could not be taken: run without one), or a
 *  reason to skip the install (another install of the folder took its place, nobody wants it, or the wait ran out). */
async function waitForSlot(
  h: SetupHeavy,
  command: string,
  dir: string,
  log: (m: string) => void
): Promise<{ kind: 'run'; release?: () => void } | { kind: 'skip'; ok: boolean; why: string }> {
  h.queued?.()
  const t0 = Date.now()
  const secs = (): number => Math.round((Date.now() - t0) / 1000)
  let gaveUp: 'abandoned' | 'waited' | null = null
  try {
    const slots = await h.slots().catch(() => 1)
    log(`setup: waiting for a heavy slot (${heavyQueue(h.queueDir ?? HEAVY_QUEUE_DIR).length} ahead) to run ${JSON.stringify(command)} in ${dir}`)
    const release = await heavySlot({
      cwd: dir,
      cmd: command,
      kind: 'setup',
      slots,
      ...(h.lock !== undefined ? { lock: h.lock } : {}),
      ...(h.queueDir !== undefined ? { queueDir: h.queueDir } : {}),
      ...(h.pollMs !== undefined ? { pollMs: h.pollMs } : {}),
      abandoned: () => {
        if (h.abandoned?.()) gaveUp = 'abandoned'
        else if (h.maxWaitMs !== undefined && Date.now() - t0 >= h.maxWaitMs) gaveUp = 'waited'
        return gaveUp !== null
      }
    })
    if (release === null) {
      log(`setup: ${JSON.stringify(command)} in ${dir} is skipped: a newer install of the folder took its place`)
      return { kind: 'skip', ok: true, why: 'a newer install of this folder took its place' }
    }
    if (gaveUp === 'abandoned') {
      log(`setup: ${JSON.stringify(command)} in ${dir} is skipped: nobody needs it any more`)
      return { kind: 'skip', ok: true, why: 'nobody needs this install any more' }
    }
    if (gaveUp === 'waited') {
      const why = `no heavy slot came free in ${secs()}s, so the worker starts without ${JSON.stringify(command)}`
      log(`setup: ${why} (${dir})`)
      return { kind: 'skip', ok: false, why }
    }
    log(`setup: got a heavy slot after ${secs()}s, running ${JSON.stringify(command)} in ${dir}`)
    return { kind: 'run', release }
  } catch (e) {
    log(`setup: could not take a heavy slot (${e instanceof Error ? e.message : String(e)}), so ${JSON.stringify(command)} runs without one in ${dir}`)
    return { kind: 'run' }
  }
}

/** What a worker start lends its fork's install (host/orch.ts, for `worker-start`): one of the machine's heavy slots to
 *  wait for, and a word the moment the install queues, so the start stops holding its caller (the scheduler pass, the
 *  Host's command chain) while the install waits and runs. forkWorktree reads it (`installTurn`). */
export interface InstallTurn {
  heavy: Pick<SetupHeavy, 'slots' | 'abandoned' | 'lock' | 'queueDir' | 'pollMs'>
  /** Called once, with the new worktree, as its install is about to wait for its slot. */
  queued(dir: string): void
}
const turns = new AsyncLocalStorage<InstallTurn>()

/** The install turn of the start this code runs in, or undefined outside one. */
export const installTurn = (): InstallTurn | undefined => turns.getStore()

/** What `untilInstallQueues` answers: the start's own result, or its install queued and the whole start (`rest`) going on. */
export type UntilInstallQueues<T> = { done: T } | { queued: { dir: string; rest: Promise<T> } }

/** Runs `start` with an install turn and answers as soon as it ends or its fork's install queues for a heavy slot,
 *  whichever comes first. Once queued, `rest` is the whole start, still going: it settles when the install ran and the
 *  start ended, and its caller owns its outcome (a rejection never goes unhandled meanwhile). */
export function untilInstallQueues<T>(heavy: InstallTurn['heavy'], start: () => Promise<T>): Promise<UntilInstallQueues<T>> {
  return new Promise((resolve, reject) => {
    let answered = false
    let queuedDir: string | null = null
    const rest = turns.run(
      {
        heavy,
        queued: (dir) => {
          if (answered || queuedDir !== null) return
          queuedDir = dir
          // A microtask later: `rest` is assigned by then even if the start queued at once
          queueMicrotask(() => {
            if (answered) return
            answered = true
            resolve({ queued: { dir, rest } })
          })
        }
      },
      start
    )
    rest.catch(() => {})
    rest.then(
      (v) => {
        if (answered) return
        answered = true
        resolve({ done: v })
      },
      (e: unknown) => {
        if (answered) return
        answered = true
        reject(e)
      }
    )
  })
}

function run(command: string, cwd: string, timeoutMs: number): Promise<{ ok: boolean; tail: string }> {
  return new Promise((resolve) => {
    let tail = ''
    let done = false
    const finish = (ok: boolean, note: string): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok, tail: `${note}${tail.slice(-TAIL_CHARS)}`.trim() })
    }
    // detached on posix: the shell leads its own process group, so a timeout can end the whole install tree
    const child = spawn(command, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    const timer = setTimeout(() => {
      try {
        if (child.pid !== undefined && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
        else killProcessTree(child)
      } catch {
        // already gone
      }
      finish(false, `timed out after ${Math.round(timeoutMs / 1000)}s\n`)
    }, timeoutMs)
    const take = (b: Buffer): void => {
      tail = (tail + b.toString()).slice(-TAIL_CHARS)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', (e) => finish(false, `${e.message}\n`))
    child.on('close', (code, signal) =>
      finish(code === 0, code === 0 ? '' : code === 127 ? 'command not found (exit 127)\n' : `exit ${code ?? signal}\n`)
    )
  })
}
