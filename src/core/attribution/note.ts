// W8-A: the Wave 8 attribution note (PLAN "Wave 8 contracts"): one JSON note per commit on `refs/notes/astera`, read
// and written through the git runner (`GitRun`). The note carries ids only: never a prompt, an email or a token.
//
// Two fields beyond the contract, both optional, so a reader of the contract alone still reads every note:
// - `unknown: true`: Astera could not tell who made the commit (stamp.ts). Read as unknown, never as AI or human.
// - `mixed`: on a squash commit, the line ranges whose path came from more than one source (remap.ts).
import type { GitRun } from '../git/range'
import { git as realGit, GIT_WRITE_TIMEOUT_MS } from '../worktrees/git'

export const NOTES_REF = 'refs/notes/astera'
/** Where `git fetch` puts origin's notes. Not `refs/notes/astera` itself: a forced fetch onto the local ref would drop
 *  every note that is not pushed yet (a worker's, between its stamp and the delivery). `syncNotes` merges it in. */
export const NOTES_REMOTE_REF = 'refs/notes/remotes/origin/astera'
export const NOTES_FETCH_REFSPEC = `+${NOTES_REF}:${NOTES_REMOTE_REF}`

export type LineRange = [number, number]
export type PathLines = Record<string, LineRange[]>
export const AGENTS = ['claude', 'codex'] as const
export const ROLES = ['worker', 'coordinator', 'reviewer', 'planner'] as const

export interface AttributionNote {
  v: 1
  tool: 'astera'
  job: string
  task: string
  session: string
  agent: (typeof AGENTS)[number]
  model: string
  /** The account's id label, never an email or a token. */
  account: string
  role: (typeof ROLES)[number]
  human?: true
  /** The AI lines of a mixed commit, per path, 1-based and inclusive. Missing: the whole commit is AI. */
  lines?: PathLines
  unknown?: true
  mixed?: PathLines
}

/** Who made one commit, as a note can say it: the note, `'unknown'` (a note that is bad, foreign or unreadable), or
 *  null (no note: the commit is human). */
export type NoteRead = AttributionNote | 'unknown' | null

/** What the note says of a commit's author, read once for blame and stats. */
export type CommitKind = 'ai' | 'human' | 'unknown'
export const kindOf = (n: NoteRead): CommitKind =>
  n === null ? 'human' : n === 'unknown' || n.unknown ? 'unknown' : n.human ? 'human' : 'ai'

const str = (v: unknown): v is string => typeof v === 'string' && v !== ''

function pathLines(v: unknown): PathLines | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
  for (const ranges of Object.values(v)) {
    if (!Array.isArray(ranges)) return null
    for (const r of ranges)
      if (!Array.isArray(r) || r.length !== 2 || !r.every((x) => Number.isInteger(x) && x >= 1) || r[0] > r[1]) return null
  }
  return v as PathLines
}

/** The note in `text`, or null when it is not one of Astera's (bad JSON, another tool's, a field of the wrong type). */
export function parseNote(text: string): AttributionNote | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const n = v as Record<string, unknown>
  if (n.v !== 1 || n.tool !== 'astera') return null
  if (![n.job, n.task, n.session, n.model, n.account].every(str)) return null
  if (!(AGENTS as readonly unknown[]).includes(n.agent) || !(ROLES as readonly unknown[]).includes(n.role)) return null
  if (n.human !== undefined && n.human !== true) return null
  if (n.unknown !== undefined && n.unknown !== true) return null
  if (n.lines !== undefined && pathLines(n.lines) === null) return null
  if (n.mixed !== undefined && pathLines(n.mixed) === null) return null
  return n as unknown as AttributionNote
}

const opts = (cwd: string) => ({ cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS })

/** Every noted commit in the repository: commit sha → note blob sha. Empty when there are no notes; null when git
 *  could not say. One call, so blame and stats do not spawn git once per commit only to learn there is no note. */
export async function notesIndex(cwd: string, run: GitRun = realGit): Promise<Map<string, string> | null> {
  const r = await run(['notes', '--ref', NOTES_REF, 'list'], opts(cwd))
  if (!r.ok) return null
  const out = new Map<string, string>()
  for (const line of r.stdout.split('\n')) {
    const [blob, commit] = line.trim().split(/\s+/)
    if (blob && commit) out.set(commit, blob)
  }
  return out
}

/** The note on `sha` (a full commit sha). Never throws: a note that is bad, foreign or unreadable is `'unknown'`. */
export async function readNote(cwd: string, sha: string, run: GitRun = realGit, index?: Map<string, string> | null): Promise<NoteRead> {
  try {
    const idx = index !== undefined ? index : await notesIndex(cwd, run)
    if (idx === null) return 'unknown'
    const blob = idx.get(sha)
    if (blob === undefined) return null
    const r = await run(['cat-file', 'blob', blob], opts(cwd))
    return r.ok ? (parseNote(r.stdout) ?? 'unknown') : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Writes (or replaces) the note on `sha`. `-m` rather than `-F -`: the runner has no stdin, and the JSON is one line. */
export async function writeNote(cwd: string, sha: string, note: AttributionNote, run: GitRun = realGit): Promise<boolean> {
  const r = await run(['notes', '--ref', NOTES_REF, 'add', '-f', '-m', JSON.stringify(note), sha], opts(cwd))
  return r.ok
}

/** Copies notes from old commits to their rewritten copies (a cherry-pick, a rebase merge on GitHub): git copies notes
 *  on amend and rebase through the repository config, never on a cherry-pick. A source with no note is skipped.
 *  Answers how many were copied. */
export async function copyNotes(cwd: string, pairs: readonly (readonly [string, string])[], run: GitRun = realGit): Promise<number> {
  let n = 0
  for (const [from, to] of pairs)
    if ((await run(['notes', '--ref', NOTES_REF, 'copy', '-f', from, to], opts(cwd))).ok) n++
  return n
}

/** The repository config that makes git itself carry the notes through amend and rebase (PLAN "Wave 8 contracts"). */
export const NOTES_CONFIG: readonly (readonly [string, string])[] = [
  ['notes.rewriteRef', NOTES_REF],
  ['notes.rewrite.amend', 'true'],
  ['notes.rewrite.rebase', 'true']
]

/** Repositories whose config is known to be set, by their common git dir, so each is asked once per process. */
const configured = new Set<string>()

/**
 * Sets `NOTES_CONFIG` and origin's notes fetch refspec in the repository holding `cwd`, once per repository and only
 * where a value is missing: a person's own `notes.rewriteRef` lines are added to, never replaced. Never throws.
 */
export async function ensureNotesConfig(cwd: string, run: GitRun = realGit): Promise<boolean> {
  try {
    const common = await run(['rev-parse', '--path-format=absolute', '--git-common-dir'], opts(cwd))
    if (!common.ok) return false
    if (configured.has(common.stdout)) return true
    const all = async (key: string): Promise<string[]> => {
      const r = await run(['config', '--get-all', key], opts(cwd))
      return r.ok ? r.stdout.split('\n').map((l) => l.trim()) : []
    }
    for (const [key, value] of NOTES_CONFIG) {
      if ((await all(key)).includes(value)) continue
      const set = key === 'notes.rewriteRef' ? ['config', '--add', key, value] : ['config', key, value]
      if (!(await run(set, opts(cwd))).ok) return false
    }
    if ((await run(['remote', 'get-url', 'origin'], opts(cwd))).ok && !(await all('remote.origin.fetch')).includes(NOTES_FETCH_REFSPEC))
      if (!(await run(['config', '--add', 'remote.origin.fetch', NOTES_FETCH_REFSPEC], opts(cwd))).ok) return false
    configured.add(common.stdout)
    return true
  } catch {
    return false
  }
}

/** Test seam: forget which repositories were configured. */
export const forgetNotesConfig = (): void => configured.clear()

/** Astera's own name on the notes ref's merge commits: the notes history is Astera's, not the owner's. */
const NOTES_IDENTITY = ['-c', 'user.name=Astera', '-c', 'user.email=astera@localhost']

const hasRef = async (cwd: string, ref: string, run: GitRun): Promise<boolean> =>
  (await run(['show-ref', '--verify', '--quiet', ref], opts(cwd))).ok

/** Folds origin's fetched notes into the local ref; on a commit both noted, the local note wins. */
export async function syncNotes(cwd: string, run: GitRun = realGit): Promise<boolean> {
  if (!(await hasRef(cwd, NOTES_REMOTE_REF, run))) return true
  if (!(await hasRef(cwd, NOTES_REF, run))) return (await run(['update-ref', NOTES_REF, NOTES_REMOTE_REF], opts(cwd))).ok
  return (await run([...NOTES_IDENTITY, 'notes', '--ref', NOTES_REF, 'merge', '-s', 'ours', NOTES_REMOTE_REF], opts(cwd))).ok
}

/**
 * Pushes the notes ref to origin, as part of a delivery only (W6-H: push and PR modes). Never forced: a rejection
 * fetches origin's notes, merges them in and pushes once more. `'none'`: there are no notes to push.
 */
export async function pushNotes(cwd: string, run: GitRun = realGit): Promise<'pushed' | 'none' | 'rejected'> {
  if (!(await hasRef(cwd, NOTES_REF, run))) return 'none'
  const push = (): ReturnType<GitRun> => run(['push', 'origin', `${NOTES_REF}:${NOTES_REF}`], opts(cwd))
  if ((await push()).ok) return 'pushed'
  if (!(await run(['fetch', 'origin', NOTES_FETCH_REFSPEC], opts(cwd))).ok) return 'rejected'
  if (!(await syncNotes(cwd, run))) return 'rejected'
  return (await push()).ok ? 'pushed' : 'rejected'
}

/** The trailers of a commit Astera writes itself (PLAN "Wave 8 contracts"). Trailers survive a squash; notes do not. */
export const trailersOf = (n: Pick<AttributionNote, 'job' | 'task' | 'agent' | 'model'>): string[] => [
  `Astera-Job: ${n.job}`,
  `Astera-Task: ${n.task}`,
  `AI-Agent: ${n.agent}/${n.model}`
]

/** The trailers for merging `ref`: from the note on its newest own commit (first parent, merges skipped). None when
 *  that commit is not an AI commit Astera noted. */
export async function trailersOfRef(cwd: string, ref: string, run: GitRun = realGit): Promise<string[]> {
  const tip = await run(['rev-list', '--first-parent', '--no-merges', '--max-count=1', ref], opts(cwd))
  if (!tip.ok || tip.stdout === '') return []
  const note = await readNote(cwd, tip.stdout.trim(), run)
  return note !== null && kindOf(note) === 'ai' && note !== 'unknown' ? trailersOf(note) : []
}

/** `message` with `trailers` as its last paragraph. */
export const withTrailers = (message: string, trailers: readonly string[]): string =>
  trailers.length === 0 ? message : `${message.trimEnd()}\n\n${trailers.join('\n')}`
