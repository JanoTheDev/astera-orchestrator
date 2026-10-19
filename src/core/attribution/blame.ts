// W8-A: line attribution from git blame and the Wave 8 notes. Each line's commit (`git blame --porcelain`), then that
// commit's note: no note is human, a bad note is unknown, a note with `lines` names the AI (and mixed) lines by their
// number in that commit, and a note without `lines` makes the whole commit AI.
import type { GitRun } from '../git/range'
import { git as realGit, GIT_WRITE_TIMEOUT_MS } from '../worktrees/git'
import { kindOf, notesIndex, readNote, type AttributionNote, type LineRange, type NoteRead } from './note'

export type LineKind = 'ai' | 'human' | 'mixed' | 'unknown'

export interface BlameLine {
  /** 1-based, in the file as blamed. */
  line: number
  sha: string
  kind: LineKind
  /** The note that made it AI, mixed or human by Astera's word. */
  note?: AttributionNote
  content: string
}

interface PorcelainLine {
  sha: string
  origLine: number
  finalLine: number
  path: string
  content: string
}

/** The lines of `git blame --porcelain` output: each with its commit, its number in that commit's version of the file
 *  (`path` there), its number now, and its text. */
export function parseBlamePorcelain(text: string): PorcelainLine[] {
  const out: PorcelainLine[] = []
  const pathOf = new Map<string, string>()
  let cur: { sha: string; origLine: number; finalLine: number } | null = null
  for (const line of text.split('\n')) {
    if (cur === null) {
      const m = /^([0-9a-f]{40,64}) (\d+) (\d+)/.exec(line)
      if (m) cur = { sha: m[1], origLine: Number(m[2]), finalLine: Number(m[3]) }
      continue
    }
    if (line.startsWith('filename ')) pathOf.set(cur.sha, line.slice('filename '.length))
    else if (line.startsWith('\t')) {
      out.push({ ...cur, path: pathOf.get(cur.sha) ?? '', content: line.slice(1) })
      cur = null
    }
  }
  return out
}

const inRanges = (n: number, ranges: readonly LineRange[] | undefined): boolean => (ranges ?? []).some(([s, e]) => n >= s && n <= e)

/** What one line is, given its commit's note and its number and path in that commit. */
export function lineKind(note: NoteRead, path: string, origLine: number): LineKind {
  const kind = kindOf(note)
  if (kind !== 'ai' || note === null || note === 'unknown' || note.lines === undefined) return kind
  if (inRanges(origLine, note.lines[path])) return 'ai'
  return inRanges(origLine, note.mixed?.[path]) ? 'mixed' : 'human'
}

/** Blames `file` at `rev` (the working tree's HEAD when absent) in `cwd`. Null when git cannot blame it. */
export async function blameFile(cwd: string, file: string, opts: { rev?: string; line?: number; run?: GitRun } = {}): Promise<BlameLine[] | null> {
  const run = opts.run ?? realGit
  const r = await run(
    ['blame', '--porcelain', ...(opts.line !== undefined ? ['-L', `${opts.line},${opts.line}`] : []), ...(opts.rev ? [opts.rev] : []), '--', file],
    { cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS, trim: false }
  )
  if (!r.ok) return null
  const index = await notesIndex(cwd, run)
  const notes = new Map<string, NoteRead>()
  const out: BlameLine[] = []
  for (const l of parseBlamePorcelain(r.stdout)) {
    if (!notes.has(l.sha)) notes.set(l.sha, /^0+$/.test(l.sha) ? null : await readNote(cwd, l.sha, run, index))
    const note = notes.get(l.sha) ?? null
    out.push({
      line: l.finalLine,
      sha: l.sha,
      kind: lineKind(note, l.path, l.origLine),
      ...(note !== null && note !== 'unknown' ? { note } : {}),
      content: l.content
    })
  }
  return out
}
