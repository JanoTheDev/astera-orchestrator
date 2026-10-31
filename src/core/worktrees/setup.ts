// Dependency setup for a fresh worktree: a `git worktree add` checkout has no node_modules, so a repository whose
// pre-push hook needs its tools rejected every push of the plan. forkWorktree runs this once the worktree exists.
//
// This module must stay importable by the Host: no electron, nothing from src/main.

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
  /** T2: the install never ran because `heavy.abandoned` answered true while it waited for its slot. */
  abandoned?: true
}

/** T2: an install waits for one of the machine's heavy slots (the ones `astera heavy`, heavy checks and deliveries take,
 *  exec/validation.ts heavySlot), so many agents can start while only that many installs run at once. */
export interface SetupHeavy {
  /** How many heavy jobs the machine runs at once (the heavyJobsAtOnce setting), read when the install queues. */
  slots(): Promise<number>
  /** Asked while waiting: true once nobody wants this install any more (its worker start was stopped). It then never
   *  runs, and the answer says `abandoned`. */
  abandoned?(): boolean
  /** Called once, when the install will run and is about to wait for its slot: a skipped setup never calls it. */
  queued?(): void
  /** Test seams: the slot's lock and queue dir (heavyLock.ts HEAVY_LOCK / HEAVY_QUEUE_DIR), its poll, the slot itself. */
  lock?: string
  queueDir?: string
  pollMs?: number
  take?: typeof heavySlot
}

/** Runs the project's setup command in `dir`. `setting` is the project's `setupCommand`: absent detects from the
 *  lockfile, `off` runs nothing, anything else runs as given. Skipped when `dir/node_modules` is already there, unless
 *  `force`: a delivery whose merges changed the manifest or lockfile installs over the old tree.
 *  With `heavy`, an install that will run first waits for a heavy slot (a skipped one takes none), and its timeout
 *  starts once it holds it; the slot is freed when the install ends, fails or times out. A slot that cannot be taken
 *  is logged and the install runs without one: it never blocks a worker for good.
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
  let release: (() => void) | null = null
  if (o.heavy) {
    const slot = await waitForSlot(command, o.dir, o.heavy, o.log)
    if (slot === 'abandoned') {
      o.log(`setup: ${JSON.stringify(command)} in ${o.dir} was given up while it waited for a heavy slot`)
      return { ran: false, ok: false, command, tail: 'given up while waiting for a heavy slot', abandoned: true }
    }
    if (slot === 'superseded') {
      o.log(`setup: ${JSON.stringify(command)} in ${o.dir} is left to a newer install of the same folder`)
      return { ran: false, ok: true, command, tail: 'a newer install of this folder runs in its place' }
    }
    release = slot
  }
  let result: { ok: boolean; tail: string }
  try {
    result = await run(command, o.dir, o.timeoutMs ?? SETUP_TIMEOUT_MS)
  } finally {
    release?.()
  }
  o.log(
    result.ok
      ? `setup: ${JSON.stringify(command)} finished in ${o.dir}`
      : `setup: ${JSON.stringify(command)} failed in ${o.dir}, so the worker starts without it: ${result.tail}`
  )
  return { ran: true, ...result, command }
}

/** One heavy slot for an install: its release, `abandoned` (nobody wants it any more), `superseded` (a newer install
 *  of this folder took the ticket's place), or null when the slot could not be taken at all (the install then runs
 *  without one, logged). */
async function waitForSlot(
  command: string,
  dir: string,
  h: SetupHeavy,
  log: (m: string) => void
): Promise<(() => void) | 'abandoned' | 'superseded' | null> {
  h.queued?.()
  const startedAt = Date.now()
  try {
    const slots = await h.slots()
    // Every live ticket already in line is ahead of this one: holding a slot or waiting for one
    const ahead = heavyQueue(h.queueDir ?? HEAVY_QUEUE_DIR).length
    log(`setup: waiting for a heavy slot (${ahead} ahead) to run ${JSON.stringify(command)} in ${dir}`)
    const release = await (h.take ?? heavySlot)({
      cwd: dir,
      cmd: command,
      kind: 'setup',
      slots,
      ...(h.abandoned ? { abandoned: h.abandoned } : {}),
      ...(h.lock !== undefined ? { lock: h.lock } : {}),
      ...(h.queueDir !== undefined ? { queueDir: h.queueDir } : {}),
      ...(h.pollMs !== undefined ? { pollMs: h.pollMs } : {})
    })
    if (release === null) return 'superseded'
    // heavySlot answers a no-op release to a waiter nobody wants any more
    if (h.abandoned?.() === true) {
      release()
      return 'abandoned'
    }
    log(`setup: took a heavy slot after ${Math.round((Date.now() - startedAt) / 1000)}s for ${JSON.stringify(command)} in ${dir}`)
    return release
  } catch (e) {
    log(`setup: could not take a heavy slot (${e instanceof Error ? e.message : String(e)}), so ${JSON.stringify(command)} runs in ${dir} without one`)
    return null
  }
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
