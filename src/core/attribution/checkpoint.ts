// W8-B: the native line engine's input. Which lines an agent wrote, as hashes, kept until a commit takes them.
//
// Every session Astera spawns gets an `async` PostToolUse hook on `Edit|Write|MultiEdit|apply_patch` that runs
// CHECKPOINT_SCRIPT (installed beside the other hook scripts, core/sessions/statusline.ts). For each file the call
// wrote, it appends one line `{ at, session, path, addedLineHashes }` to a per-repository log under the profile
// (`<profile>/attribution/<key>.jsonl`), outside every repo. **Hashes only, never content**: a log line says that
// session wrote a line with this hash into this path, and nothing that could leak the text.
//
// At stamp time `lines.ts` matches each added line of the commit diff against these hashes, and takes the matched
// ones out of the log (`takeCheckpoints`), so a later commit cannot claim them again.
//
// **The rules the hook runs are the functions below**, spliced into the script text the way subagentCap.ts does, so
// a test of `addedLinesOf` / `normLine` / `repoRootOf` is a test of what the hook does. `lineHash` and `logKeyOf`
// are the two the script cannot splice (they need `crypto`), so the script repeats their one expression and the
// script test pins both against these.
//
// Why the docs/dev/LINUX.md git-ai spike chose this engine over git-ai is written there.
import { createHash } from 'node:crypto'
import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import { hookEventState } from '../hooks/sessionState'
import { hookEventAt } from '../hooks/eventTime'

/** One checkpoint: `session` wrote lines with these hashes into `path` (relative to the repo root, `/`-separated). A
 *  hash appears once per line written, so two identical lines are two entries. */
export interface CheckpointEntry {
  at: number
  session: string
  path: string
  addedLineHashes: string[]
}

/** The folder of the logs, under the profile. */
export function attributionDirIn(profileDir: string): string {
  return path.join(profileDir, 'attribution')
}

/** A line as it is hashed: trailing whitespace and `\r` dropped. '' for a blank line, which is never hashed (it would
 *  match every blank line a person adds). Self-contained: it runs inside CHECKPOINT_SCRIPT. */
export function normLine(line: string): string {
  return line.replace(/\s+$/, '')
}

/** sha256 of the normalised line, first 16 hex digits. CHECKPOINT_SCRIPT repeats this expression. */
export function lineHash(line: string): string {
  return createHash('sha256').update(normLine(line)).digest('hex').slice(0, 16)
}

/** The log of one repository, keyed by its real root path. CHECKPOINT_SCRIPT repeats this expression. */
export function logKeyOf(root: string): string {
  return createHash('sha256').update(root).digest('hex').slice(0, 16)
}

export function logFileOf(profileDir: string, root: string): string {
  return path.join(attributionDirIn(profileDir), `${logKeyOf(root)}.jsonl`)
}

/**
 * The lines one tool call added, per file, read off the hook's `tool_input`. Lines only, unhashed; the script hashes
 * them. A file path may be relative (Codex patches are relative to the session's cwd).
 * - `Write`: every line of `content`.
 * - `Edit`: the lines of `new_string` that `old_string` did not have (as a multiset, so unchanged context lines and a
 *   moved line are not counted).
 * - `MultiEdit`: the same for each of `edits`.
 * - `apply_patch` (Codex): the `+` lines under each `*** Add File:` / `*** Update File:` (a `*** Move to:` renames the
 *   current file). The patch is `tool_input.command[1]`, `tool_input.input` or `tool_input.patch`.
 * Anything else: none. Self-contained: it runs inside CHECKPOINT_SCRIPT.
 */
export function addedLinesOf(toolName: unknown, input: unknown): { file: string; lines: string[] }[] {
  if (typeof input !== 'object' || input === null) return []
  const i = input as Record<string, unknown>
  const split = (s: unknown): string[] => (typeof s === 'string' && s !== '' ? s.replace(/\r?\n$/, '').split(/\r?\n/) : [])
  const minus = (added: string[], removed: string[]): string[] => {
    const left = new Map<string, number>()
    for (const l of removed) left.set(l, (left.get(l) ?? 0) + 1)
    return added.filter((l) => {
      const n = left.get(l) ?? 0
      if (n === 0) return true
      left.set(l, n - 1)
      return false
    })
  }
  const file = typeof i.file_path === 'string' ? i.file_path : null
  if (toolName === 'Write') return file === null ? [] : [{ file, lines: split(i.content) }]
  if (toolName === 'Edit') return file === null ? [] : [{ file, lines: minus(split(i.new_string), split(i.old_string)) }]
  if (toolName === 'MultiEdit') {
    if (file === null || !Array.isArray(i.edits)) return []
    const lines: string[] = []
    for (const e of i.edits as Record<string, unknown>[])
      if (e && typeof e === 'object') lines.push(...minus(split(e.new_string), split(e.old_string)))
    return [{ file, lines }]
  }
  if (toolName === 'apply_patch') {
    const cmd = Array.isArray(i.command) ? i.command[1] : undefined
    const patch = [cmd, i.input, i.patch].find((p) => typeof p === 'string') as string | undefined
    if (patch === undefined) return []
    const out: { file: string; lines: string[] }[] = []
    let cur: { file: string; lines: string[] } | null = null
    for (const l of patch.split(/\r?\n/)) {
      const head = /^\*\*\* (Add|Update) File: (.+)$/.exec(l)
      if (head) {
        cur = { file: head[2].trim(), lines: [] }
        out.push(cur)
      } else if (l.startsWith('*** Move to: ') && cur) cur.file = l.slice('*** Move to: '.length).trim()
      else if (l.startsWith('*** ')) cur = null
      else if (cur && l.startsWith('+')) cur.lines.push(l.slice(1))
    }
    return out
  }
  return []
}

/** The repository a file is in: its real path walked up to the first folder holding `.git` (a folder, or a worktree's
 *  file). `{ root, rel }` with `rel` `/`-separated, or null outside any repository. The file itself may not exist (a
 *  `Write` that failed): its folder is resolved instead. Self-contained: it runs inside CHECKPOINT_SCRIPT, given
 *  node's `fs` and `path`. */
export function repoRootOf(
  file: string,
  fsm: { realpathSync(p: string): string; existsSync(p: string): boolean },
  pathm: typeof path
): { root: string; rel: string } | null {
  let real: string
  try {
    real = fsm.realpathSync(file)
  } catch {
    try {
      real = pathm.join(fsm.realpathSync(pathm.dirname(file)), pathm.basename(file))
    } catch {
      return null
    }
  }
  for (let dir = pathm.dirname(real); ; dir = pathm.dirname(dir)) {
    if (fsm.existsSync(pathm.join(dir, '.git'))) return { root: dir, rel: pathm.relative(dir, real).split(pathm.sep).join('/') }
    if (pathm.dirname(dir) === dir) return null
  }
}

/** The hook. Reads the PostToolUse payload, and appends one entry per file that gained lines to that file's repository
 *  log beside this script. The session is `ASTERA_SESSION`. With no session, a payload it cannot read, or an error, it
 *  writes nothing: a checkpoint lost is a line read as human, never a failed tool call. */
export const CHECKPOINT_SCRIPT = `const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const addedLinesOf = ${addedLinesOf.toString()}
const normLine = ${normLine.toString()}
const repoRootOf = ${repoRootOf.toString()}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
const session = process.env.ASTERA_SESSION
const chunks = []
function finish() {
  try {
    const p = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (session && p && typeof p === 'object') {
      const cwd = typeof p.cwd === 'string' ? p.cwd : process.cwd()
      const dir = path.join(__dirname, 'attribution')
      for (const a of addedLinesOf(p.tool_name, p.tool_input)) {
        const hashes = a.lines.map(normLine).filter((l) => l !== '').map(sha)
        if (hashes.length === 0) continue
        const r = repoRootOf(path.resolve(cwd, a.file), fs, path)
        if (!r) continue
        fs.mkdirSync(dir, { recursive: true })
        fs.appendFileSync(path.join(dir, sha(r.root) + '.jsonl'), JSON.stringify({ at: Date.now(), session, path: r.rel, addedLineHashes: hashes }) + '\\n')
      }
    }
  } catch {}
  process.exit(0)
}
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', finish)
process.stdin.on('error', finish)
`

/** The real root path of a repository, as the hook keys it. */
export function realRoot(root: string): string {
  try {
    return realpathSync(root)
  } catch {
    return path.resolve(root)
  }
}

function parseLog(text: string): CheckpointEntry[] {
  const out: CheckpointEntry[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      const e = JSON.parse(line) as CheckpointEntry
      if (typeof e.session === 'string' && typeof e.path === 'string' && Array.isArray(e.addedLineHashes)) out.push(e)
    } catch {
      /* a torn line says nothing */
    }
  }
  return out
}

/** Every checkpoint of a repository, oldest first. [] with no log. */
export async function readCheckpoints(profileDir: string, root: string): Promise<CheckpointEntry[]> {
  try {
    return parseLog(await fs.readFile(logFileOf(profileDir, realRoot(root)), 'utf8'))
  } catch {
    return []
  }
}

/**
 * Hands the log to `use`, then writes back what it returns. The log is renamed aside first, so a hook appending
 * meanwhile writes into a fresh log and loses nothing; what is kept is appended after it. Two stamps of one
 * repository at once would each read half: integrateGit stamps one merge at a time per repository.
 */
export async function takeCheckpoints<T>(
  profileDir: string,
  root: string,
  use: (entries: CheckpointEntry[]) => { keep: CheckpointEntry[]; result: T }
): Promise<T> {
  const file = logFileOf(profileDir, realRoot(root))
  const aside = `${file}.${process.pid}.${Date.now()}.taking`
  let entries: CheckpointEntry[] = []
  let moved = false
  try {
    await fs.rename(file, aside)
    moved = true
    entries = parseLog(await fs.readFile(aside, 'utf8'))
  } catch {
    /* no log: nothing checkpointed */
  }
  const { keep, result } = use(entries)
  if (keep.length > 0) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, keep.map((e) => JSON.stringify(e)).join('\n') + '\n')
  }
  if (moved) await fs.rm(aside, { force: true })
  return result
}

/** A session's turn, from its first working event to the idle event that ends it: the EG §26 busy window
 *  (core/workUnit/collector.ts opens and closes the same one live, `onSessionBusy`). `to` is absent while it runs. */
export interface BusyWindow {
  session: string
  from: number
  to?: number
}

/** The busy windows in one session's hook events file (`hook-events/<sid>.jsonl`, lines in the order they landed),
 *  by the events' stamp (`hookEventAt`). Events with no stamp are skipped. A `waiting` event keeps the window open:
 *  the turn has not ended. */
export function busyWindowsOf(session: string, lines: readonly string[]): BusyWindow[] {
  const events: { at: number; state: 'working' | 'waiting' | 'idle' }[] = []
  for (const line of lines) {
    let payload: unknown
    try {
      payload = JSON.parse(line)
    } catch {
      continue
    }
    const at = hookEventAt(payload)
    const state = hookEventState(payload)
    if (at !== null && state !== null) events.push({ at, state })
  }
  events.sort((a, b) => a.at - b.at)
  const out: BusyWindow[] = []
  let open: BusyWindow | null = null
  for (const e of events) {
    if (e.state !== 'idle' && open === null) {
      open = { session, from: e.at }
      out.push(open)
    } else if (e.state === 'idle' && open !== null) {
      open.to = e.at
      open = null
    }
  }
  return out
}
