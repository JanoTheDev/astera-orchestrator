// W8-B: line-level attribution for one commit, the `lines` field of the Wave 8 note (docs/dev/PLAN.md,
// "Wave 8 contracts"): `lines?: { [path]: [start, end][] }`, the AI lines of a mixed commit. `lines` missing means the
// whole commit is AI, so a pure commit leaves it out, and a commit with no AI line at all is `human: true`.
//
// The rule, at stamp time:
// - each added line of the commit diff whose hash a session checkpointed for that path (checkpoint.ts) is that
//   session's; every hash is taken once, so a person adding the same line twice gets the second;
// - a file of the commit with no checkpointed line, last written inside a session's busy window (the EG §26 window,
//   `busyWindowsOf`), is that session's whole: a file written by Bash. git-ai has the same limit;
// - everything else is human. A blank line goes with the line above it in the same hunk.
// The checkpoints of the committed paths are then cleared from the log.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { git } from '../worktrees/git'
import type { GitRun } from '../git/range'
import { lineHash, normLine, takeCheckpoints, realRoot, type BusyWindow, type CheckpointEntry } from './checkpoint'

/** The note's `lines`: per path, the AI line ranges in the commit's version of the file, 1-based and inclusive. */
export type NoteLines = { [path: string]: [number, number][] }

/** One line the commit added: its path, its number in the commit's version of the file, its text. */
export interface AddedLine {
  path: string
  line: number
  text: string
}

/** What the commit's lines say, for the note: `session` the one that wrote most of the AI lines; `lines` only when
 *  the commit is mixed; `human` when no line is AI. The counts are for stats and the plan view. */
export interface LineAttribution {
  session?: string
  lines?: NoteLines
  human?: true
  aiLines: number
  humanLines: number
}

const unquote = (p: string): string => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\(.)/g, '$1') : p)

/** The added lines of a `git show -U0` / `git diff -U0` patch. A deleted file adds nothing. */
export function addedLinesOfDiff(diff: string): AddedLine[] {
  const out: AddedLine[] = []
  let file: string | null = null
  let next = 0
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) {
      const p = unquote(l.slice(4))
      file = p === '/dev/null' ? null : p.replace(/^b\//, '')
    } else if (l.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l)
      next = m ? Number(m[1]) : 0
    } else if (file !== null && l.startsWith('+')) {
      out.push({ path: file, line: next++, text: l.slice(1) })
    }
  }
  return out
}

/** Sorted line numbers folded into inclusive ranges. */
export function rangesOf(lines: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const n of [...lines].sort((a, b) => a - b)) {
    const last = out[out.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else if (!last || n > last[1]) out.push([n, n])
  }
  return out
}

/**
 * Who wrote each added line (the rule at the top of this file). Pure: `mtimeOf` answers when a path of the commit was
 * last written (ms), or null. Returns the attribution and the checkpoints to keep, which are the ones for paths the
 * commit did not touch.
 */
export function attributeLines(
  added: readonly AddedLine[],
  entries: readonly CheckpointEntry[],
  busy: readonly BusyWindow[],
  mtimeOf: (path: string) => number | null
): { result: LineAttribution; keep: CheckpointEntry[] } {
  // path → hash → the sessions that wrote it, oldest first, one per line written
  const pool = new Map<string, Map<string, string[]>>()
  for (const e of entries) {
    const byHash = pool.get(e.path) ?? new Map<string, string[]>()
    pool.set(e.path, byHash)
    for (const h of e.addedLineHashes) byHash.set(h, [...(byHash.get(h) ?? []), e.session])
  }
  const owner: (string | null)[] = added.map((a) => {
    if (normLine(a.text) === '') return null
    return pool.get(a.path)?.get(lineHash(a.text))?.shift() ?? null
  })
  // A file with nothing checkpointed, written inside a busy window: the whole file is that session's
  const paths = [...new Set(added.map((a) => a.path))]
  for (const p of paths) {
    if (added.some((a, i) => a.path === p && owner[i] !== null)) continue
    const m = mtimeOf(p)
    const w = m === null ? undefined : busy.find((b) => b.from <= m && m <= (b.to ?? Infinity))
    if (w) added.forEach((a, i) => a.path === p && normLine(a.text) !== '' && (owner[i] = w.session))
  }
  // A blank line goes with the line above it in the same hunk
  added.forEach((a, i) => {
    const prev = added[i - 1]
    if (normLine(a.text) === '' && prev && prev.path === a.path && prev.line === a.line - 1) owner[i] = owner[i - 1]
  })
  const perSession = new Map<string, number>()
  const aiByPath = new Map<string, number[]>()
  added.forEach((a, i) => {
    const s = owner[i]
    if (s === null) return
    perSession.set(s, (perSession.get(s) ?? 0) + 1)
    aiByPath.set(a.path, [...(aiByPath.get(a.path) ?? []), a.line])
  })
  const aiLines = [...perSession.values()].reduce((x, y) => x + y, 0)
  const humanLines = added.length - aiLines
  const touched = new Set(paths)
  const keep = entries.filter((e) => !touched.has(e.path))
  if (aiLines === 0) return { result: { human: true, aiLines, humanLines }, keep }
  // shortcut: one session per note (the contract's); a commit two sessions wrote names the larger and lists both's
  // lines. Split per session if `attribution-why` ever needs the second one.
  const session = [...perSession.entries()].sort((x, y) => y[1] - x[1])[0][0]
  if (humanLines === 0) return { result: { session, aiLines, humanLines }, keep }
  const lines: NoteLines = {}
  for (const [p, ns] of aiByPath) lines[p] = rangesOf(ns)
  return { result: { session, lines, aiLines, humanLines }, keep }
}

/**
 * The line attribution of commit `sha` in the repository at `repo`, read from that repository's checkpoint log, which
 * it then clears for the committed paths. Call it right after the commit is made, before anything else writes the
 * files (the busy-window rule reads their mtime). A merge is read against its first parent.
 */
export async function linesForCommit(opts: {
  repo: string
  sha: string
  profileDir: string
  busy?: readonly BusyWindow[]
  run?: GitRun
}): Promise<LineAttribution> {
  const run: GitRun = opts.run ?? ((args, o) => git(args, o))
  const top = await run(['rev-parse', '--show-toplevel'], { cwd: opts.repo, timeoutMs: 10_000, trim: true })
  const root = top.ok && top.stdout ? top.stdout.trim() : opts.repo
  const diff = await run(
    ['-c', 'core.quotePath=false', 'show', '--format=', '--no-color', '--no-renames', '--no-ext-diff', '-U0', '--diff-merges=first-parent', opts.sha],
    { cwd: root, timeoutMs: 30_000 }
  )
  if (!diff.ok) throw new Error(`git show ${opts.sha}: ${diff.stderr.trim()}`)
  const added = addedLinesOfDiff(diff.stdout)
  const mtimes = new Map<string, number | null>()
  for (const p of new Set(added.map((a) => a.path)))
    mtimes.set(p, await fs.stat(path.join(root, p)).then((s) => s.mtimeMs, () => null))
  return takeCheckpoints(opts.profileDir, realRoot(root), (entries) =>
    attributeLines(added, entries, opts.busy ?? [], (p) => mtimes.get(p) ?? null)
  )
}
