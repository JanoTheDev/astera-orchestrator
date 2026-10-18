// W8-A: the squash remap. A pull request merged on GitHub by squash or by rebase leaves new commits on the base branch
// that carry no note: notes follow a commit, and GitHub writes new ones. Astera keeps each Task's commits
// (`Task.links.commits`), so once the merge is fetched it notes the new commits from the old ones:
// - a merge commit: the old commits are on the base branch as they were, and nothing is written;
// - a rebase: each new commit is matched to its old one by author, author date and subject (all three survive a rebase
//   merge), and the note is copied;
// - a squash: the one new commit gets one note: the AI Task with the most commits names it, and its `lines` are merged
//   by path: a path every source of which is AI is AI, a path only humans touched is human, and a path from more than
//   one kind of source is `mixed`.
// Written once: a commit whose note already says the same is left alone.
import type { GitRun } from '../git/range'
import { git as realGit, GIT_WRITE_TIMEOUT_MS } from '../worktrees/git'
import { copyNotes, kindOf, notesIndex, readNote, writeNote, type AttributionNote, type LineRange, type NoteRead, type PathLines } from './note'

export interface RemapResult {
  kind: 'merge' | 'rebase' | 'squash' | 'none'
  /** The new commits that got a note. */
  noted: string[]
}

const o = (cwd: string) => ({ cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS })

/** The lines each path gains in `git diff -U0` output, as 1-based inclusive ranges of the new file. */
export function addedRanges(diff: string): PathLines {
  const out: PathLines = {}
  let path: string | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      path = line === '+++ /dev/null' ? null : line.slice('+++ b/'.length)
      if (path !== null) out[path] ??= []
      continue
    }
    const m = path !== null ? /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line) : null
    if (!m || path === null) continue
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    if (count > 0) out[path].push([start, start + count - 1])
  }
  return out
}

/** The paths one commit touches, or null when git cannot read it. */
async function pathsOf(cwd: string, sha: string, run: GitRun): Promise<string[] | null> {
  const r = await run(['-c', 'core.quotePath=false', 'show', '--name-only', '--no-renames', '--format=', sha], o(cwd))
  return r.ok ? r.stdout.split('\n').filter(Boolean) : null
}

/** author, author date and subject per commit, for matching a rebased commit to its old one. */
async function keysOf(cwd: string, args: string[], run: GitRun): Promise<Map<string, string> | null> {
  const r = await run(['log', '--format=%H%x00%an%x00%ae%x00%at%x00%s', ...args], o(cwd))
  if (!r.ok) return null
  const out = new Map<string, string>()
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('\0')
    if (i > 0) out.set(line.slice(0, i), line.slice(i + 1))
  }
  return out
}

const isAi = (n: NoteRead): n is AttributionNote => n !== null && n !== 'unknown' && kindOf(n) === 'ai'

/** The squash commit's note from the old commits' notes and paths, and the lines the squash adds. Null when no old
 *  commit was the agent's: no note, which reads as human, is then the right answer. */
export function squashNote(
  sources: readonly { note: NoteRead; paths: readonly string[] | null }[],
  added: PathLines
): AttributionNote | null {
  const ai = sources.map((s) => s.note).filter(isAi)
  if (ai.length === 0) return null
  const byTask = new Map<string, number>()
  for (const n of ai) byTask.set(n.task, (byTask.get(n.task) ?? 0) + 1)
  const top = [...byTask.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const { lines: _l, mixed: _m, human: _h, unknown: _u, ...identity } = ai.find((n) => n.task === top)!
  const lines: PathLines = {}
  const mixed: PathLines = {}
  let partial = false
  for (const [path, ranges] of Object.entries(added)) {
    // An old commit git can no longer read may have touched any path: it counts, as unknown
    const from = sources.filter((s) => s.paths === null || s.paths.includes(path))
    const kinds = new Set(from.map((s) => (s.paths === null ? 'unknown' : kindOf(s.note))))
    const carried = from.length === 1 && isAi(from[0].note) && from[0].note.lines !== undefined ? from[0].note : null
    if (carried) {
      partial = true
      lines[path] = (carried.lines![path] ?? []) as LineRange[]
      if (carried.mixed?.[path]) mixed[path] = carried.mixed[path]
    } else if (kinds.size === 1 && kinds.has('ai') && from.every((s) => isAi(s.note) && s.note.lines === undefined)) {
      lines[path] = ranges
    } else {
      partial = true
      if (!(kinds.size === 1 && kinds.has('human')) && ranges.length > 0) mixed[path] = ranges
    }
  }
  return {
    ...identity,
    ...(partial ? { lines } : {}),
    ...(Object.keys(mixed).length > 0 ? { mixed } : {})
  }
}

/**
 * Notes the commits a merged pull request left on the base branch, from `originals` (the PR's old commits, oldest
 * first). `mergeCommit` is GitHub's merge commit for the PR, fetched already. Never throws.
 */
export async function remapMerged(a: { cwd: string; mergeCommit: string; originals: readonly string[]; run?: GitRun }): Promise<RemapResult> {
  const run = a.run ?? realGit
  const { cwd, mergeCommit } = a
  try {
    const originals = [...new Set(a.originals)]
    if (originals.length === 0) return { kind: 'none', noted: [] }
    let all = true
    for (const sha of originals) if (!(await run(['merge-base', '--is-ancestor', sha, mergeCommit], o(cwd))).ok) all = false
    if (all) return { kind: 'merge', noted: [] }

    const index = await notesIndex(cwd, run)
    const notes = new Map<string, NoteRead>()
    for (const sha of originals) notes.set(sha, await readNote(cwd, sha, run, index))

    // A rebase: every old commit matches one of the newest new ones
    const old = await keysOf(cwd, ['--no-walk=unsorted', ...originals], run)
    const fresh = await keysOf(cwd, ['--first-parent', '--no-merges', `--max-count=${originals.length}`, mergeCommit], run)
    if (old && fresh && old.size === originals.length) {
      const pairs: [string, string][] = []
      const taken = new Set<string>()
      for (const [sha, key] of old) {
        const match = [...fresh].find(([n, k]) => k === key && !taken.has(n))
        if (!match) break
        taken.add(match[0])
        pairs.push([sha, match[0]])
      }
      if (pairs.length === originals.length) {
        const due = pairs.filter(([from, to]) => notes.get(from) !== null && index?.get(to) === undefined)
        await copyNotes(cwd, due, run)
        return { kind: 'rebase', noted: due.map(([, to]) => to) }
      }
    }

    // A squash: one new commit with one parent
    const parents = await run(['rev-list', '--parents', '--max-count=1', mergeCommit], o(cwd))
    if (!parents.ok || parents.stdout.trim().split(/\s+/).length !== 2) return { kind: 'none', noted: [] }
    const diff = await run(['-c', 'core.quotePath=false', 'diff', '--unified=0', '--no-renames', `${mergeCommit}^`, mergeCommit], o(cwd))
    if (!diff.ok) return { kind: 'none', noted: [] }
    const sources = await Promise.all(originals.map(async (sha) => ({ note: notes.get(sha) ?? null, paths: await pathsOf(cwd, sha, run) })))
    const note = squashNote(sources, addedRanges(diff.stdout))
    if (note === null) return { kind: 'squash', noted: [] }
    const had = await readNote(cwd, mergeCommit, run, index)
    if (had !== null && had !== 'unknown' && JSON.stringify(had) === JSON.stringify(note)) return { kind: 'squash', noted: [] }
    return { kind: 'squash', noted: (await writeNote(cwd, mergeCommit, note, run)) ? [mergeCommit] : [] }
  } catch {
    return { kind: 'none', noted: [] }
  }
}
