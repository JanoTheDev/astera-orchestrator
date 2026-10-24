// Dependency setup for a fresh worktree: a `git worktree add` checkout has no node_modules, so a repository whose
// pre-push hook needs its tools rejected every push of the plan. forkWorktree runs this once the worktree exists.
//
// This module must stay importable by the Host: no electron, nothing from src/main.

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { killProcessTree } from '../run/kill'

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
}

/** Runs the project's setup command in `dir`. `setting` is the project's `setupCommand`: absent detects from the
 *  lockfile, `off` runs nothing, anything else runs as given. Skipped when `dir/node_modules` is already there, unless
 *  `force`: a delivery whose merges changed the manifest or lockfile installs over the old tree.
 *  Never throws: a failure, a missing tool or a timeout is logged and returned, and the worker starts anyway. */
export async function runWorktreeSetup(o: {
  dir: string
  setting?: string
  log(m: string): void
  timeoutMs?: number
  force?: boolean
}): Promise<SetupResult> {
  const skipped: SetupResult = { ran: false, ok: true, command: null, tail: '' }
  if (o.setting === 'off') return skipped
  const command = o.setting ?? (await detectSetupCommand(o.dir))
  if (command === null || (!o.force && (await exists(path.join(o.dir, 'node_modules'))))) return skipped
  const result = await run(command, o.dir, o.timeoutMs ?? SETUP_TIMEOUT_MS)
  o.log(
    result.ok
      ? `setup: ${JSON.stringify(command)} finished in ${o.dir}`
      : `setup: ${JSON.stringify(command)} failed in ${o.dir}, so the worker starts without it: ${result.tail}`
  )
  return { ran: true, ...result, command }
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
