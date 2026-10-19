// W8-A: attribution stats over commits, from their Wave 8 notes. The field names are git-ai's (PLAN "Wave 8
// contracts"), so tooling can read both: `human_additions`, `mixed_additions`, `ai_additions`, `ai_accepted`,
// `git_diff_added_lines`, `git_diff_deleted_lines`, `tool_model_breakdown` (keyed `<agent>::<model>`).
// `unknown_additions` is Astera's own: lines of commits whose note is bad or says unknown, counted as neither.
import type { GitRun } from '../git/range'
import { git as realGit, GIT_WRITE_TIMEOUT_MS } from '../worktrees/git'
import { kindOf, notesIndex, readNote, type AttributionNote, type LineRange, type NoteRead } from './note'

export interface ModelStats {
  ai_additions: number
  ai_accepted: number
}

export interface AttributionStats {
  human_additions: number
  mixed_additions: number
  ai_additions: number
  /** Committed AI lines. At commit level every committed line was accepted, so this equals `ai_additions`. */
  ai_accepted: number
  unknown_additions: number
  git_diff_added_lines: number
  git_diff_deleted_lines: number
  tool_model_breakdown: Record<string, ModelStats>
}

export const emptyStats = (): AttributionStats => ({
  human_additions: 0,
  mixed_additions: 0,
  ai_additions: 0,
  ai_accepted: 0,
  unknown_additions: 0,
  git_diff_added_lines: 0,
  git_diff_deleted_lines: 0,
  tool_model_breakdown: {}
})

export function addStats(a: AttributionStats, b: AttributionStats): AttributionStats {
  const out: AttributionStats = { ...emptyStats(), tool_model_breakdown: { ...a.tool_model_breakdown } }
  for (const k of ['human_additions', 'mixed_additions', 'ai_additions', 'ai_accepted', 'unknown_additions', 'git_diff_added_lines', 'git_diff_deleted_lines'] as const)
    out[k] = a[k] + b[k]
  for (const [key, m] of Object.entries(b.tool_model_breakdown)) {
    const prev = out.tool_model_breakdown[key] ?? { ai_additions: 0, ai_accepted: 0 }
    out.tool_model_breakdown[key] = { ai_additions: prev.ai_additions + m.ai_additions, ai_accepted: prev.ai_accepted + m.ai_accepted }
  }
  return out
}

export interface FileDiff {
  path: string
  added: number
  deleted: number
}

const o = (cwd: string) => ({ cwd, timeoutMs: GIT_WRITE_TIMEOUT_MS })

/** The lines one commit adds and deletes per path (`git show --numstat`, renames off so each path is one name). A
 *  binary file counts no lines. Null when git cannot read the commit. */
export async function numstatOf(cwd: string, sha: string, run: GitRun = realGit): Promise<FileDiff[] | null> {
  const r = await run(['-c', 'core.quotePath=false', 'show', '--numstat', '--no-renames', '--format=', sha], o(cwd))
  if (!r.ok) return null
  const out: FileDiff[] = []
  for (const line of r.stdout.split('\n')) {
    const [a, d, ...p] = line.split('\t')
    if (p.length === 0 || a === '-' || d === '-') continue
    out.push({ path: p.join('\t'), added: Number(a), deleted: Number(d) })
  }
  return out
}

export const countLines = (ranges: readonly LineRange[] | undefined): number =>
  (ranges ?? []).reduce((n, [s, e]) => n + e - s + 1, 0)

export const modelKey = (n: Pick<AttributionNote, 'agent' | 'model'>): string => `${n.agent}::${n.model}`

/** One commit's stats from its diff and its note. */
export function commitStats(files: readonly FileDiff[], note: NoteRead): AttributionStats {
  const s = emptyStats()
  const kind = kindOf(note)
  for (const f of files) {
    s.git_diff_added_lines += f.added
    s.git_diff_deleted_lines += f.deleted
    if (kind !== 'ai' || note === null || note === 'unknown') {
      s[kind === 'unknown' ? 'unknown_additions' : 'human_additions'] += f.added
      continue
    }
    const ai = note.lines === undefined ? f.added : Math.min(f.added, countLines(note.lines[f.path]))
    const mixed = Math.min(f.added - ai, countLines(note.mixed?.[f.path]))
    s.ai_additions += ai
    s.ai_accepted += ai
    s.mixed_additions += mixed
    s.human_additions += f.added - ai - mixed
    if (ai > 0) {
      const m = (s.tool_model_breakdown[modelKey(note)] ??= { ai_additions: 0, ai_accepted: 0 })
      m.ai_additions += ai
      m.ai_accepted += ai
    }
  }
  return s
}

/** The stats of `shas` together. A commit git cannot read adds nothing. */
export async function statsOf(cwd: string, shas: readonly string[], run: GitRun = realGit): Promise<AttributionStats> {
  const index = await notesIndex(cwd, run)
  let total = emptyStats()
  for (const sha of shas) {
    const files = await numstatOf(cwd, sha, run)
    if (files !== null) total = addStats(total, commitStats(files, await readNote(cwd, sha, run, index)))
  }
  return total
}

/** The non-merge commits of `range` (`git rev-list`), or the last commit when no range is given (git-ai's default). */
export async function rangeShas(cwd: string, range: string | undefined, run: GitRun = realGit): Promise<string[] | null> {
  const r = await run(['rev-list', '--no-merges', ...(range === undefined ? ['--max-count=1', 'HEAD'] : [range])], o(cwd))
  return r.ok ? r.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : null
}

/** One Task as the PR's "AI attribution" block lists it. */
export interface AttributedTask {
  title: string
  commits: readonly string[]
}

/** The "AI attribution" block of a plan's pull request (W6-H PR mode): per Task, its agent and model, its commit
 *  count, `ai_additions` and `human_additions`. Then the Wave 8 trailers as the body's last paragraph, so a GitHub
 *  squash that takes the body keeps them. Empty when no Task has a commit. */
export async function attributionBlock(
  cwd: string,
  job: string,
  tasks: readonly (AttributedTask & { id: string })[],
  run: GitRun = realGit
): Promise<string> {
  const index = await notesIndex(cwd, run)
  const rows: string[] = []
  const taskTrailers: string[] = []
  const agentTrailers = new Set<string>()
  for (const t of tasks) {
    if (t.commits.length === 0) continue
    const s = await statsOf(cwd, t.commits, run)
    const notes = await Promise.all(t.commits.map((c) => readNote(cwd, c, run, index)))
    const ai = notes.find((n): n is AttributionNote => n !== null && n !== 'unknown' && kindOf(n) === 'ai')
    const who = ai ? `${ai.agent}/${ai.model}` : 'human'
    rows.push(`| ${t.title.replace(/\|/g, '\\|')} | ${who} | ${t.commits.length} | ${s.ai_additions} | ${s.human_additions} |`)
    taskTrailers.push(`Astera-Task: ${t.id}`)
    if (ai) agentTrailers.add(`AI-Agent: ${ai.agent}/${ai.model}`)
  }
  if (rows.length === 0) return ''
  return [
    '## AI attribution',
    '',
    '| Task | Agent/model | Commits | ai_additions | human_additions |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `Astera-Job: ${job}`,
    ...taskTrailers,
    ...agentTrailers
  ].join('\n')
}
