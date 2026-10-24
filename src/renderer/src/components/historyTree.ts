// The Sessions tree's rows (DESIGN-W13 §4): Project › session. Projects with a live session first, then newest first;
// in a project its live sessions first, then the finished ones newest first, of which only the FINISHED_SHOWN most
// recent show until the project's "older" row is opened. Pure, so the grouping is testable without a renderer;
// HistoryBrowser keeps the fetching and maps these rows onto Tree items.
import type { Dispatch, Job, JobRun, Task } from '../../../core/orchestration/types'
import { jobNameOf } from '../../../core/orchestration/jobName'
import type { Attention, HistoryEntry, ProjectSummary, SessionInfo } from '../../../core/types'

export type SessionRow =
  | { kind: 'project'; id: string; project: ProjectSummary; expanded: boolean; live: number }
  | { kind: 'session'; id: string; entry: HistoryEntry; status: HistoryStatus }
  /** the finished sessions past the most recent FINISHED_SHOWN: folded (`count` of them, loaded or not), or `open` to fold
   *  them back */
  | { kind: 'older'; id: string; projectPath: string; count: number; open?: true }
  /** a project whose first session page has not arrived: a placeholder, so "not loaded" never reads as "none" */
  | { kind: 'loading'; id: string }
  | { kind: 'empty'; id: string }
  /** the next page of a project's sessions (`projectPath` set) or of the projects themselves (unset) */
  | { kind: 'more'; id: string; projectPath?: string }

/** The row id of a project; sessions use their entry id, which cannot collide with a path. */
export const projectRowId = (projectPath: string): string => `project:${projectPath}`

const newestFirst = <T>(items: readonly T[], at: (x: T) => string): T[] => [...items].sort((a, b) => at(b).localeCompare(at(a)))

/** The projects the top switcher's pick shows: those whose folder `ownerOf` resolves to the scope id; null scope is
 *  "All projects" and keeps every one. */
export const scopeProjects = (projects: readonly ProjectSummary[], scopeId: string | null, ownerOf: (projectPath: string) => string | null): ProjectSummary[] =>
  scopeId === null ? [...projects] : projects.filter((p) => ownerOf(p.projectPath) === scopeId)

export type SessionPage = { entries: readonly HistoryEntry[]; total: number }

/** How many finished sessions of a project show before the rest fold behind its "older" row. */
export const FINISHED_SHOWN = 5

export type TreeOptions = {
  /** How many sessions of a project's folder run right now; a project with any comes first. */
  liveIn?: (projectPath: string) => number
  statusOf?: (entry: HistoryEntry) => HistoryStatus
  /** The projects whose older finished sessions are unfolded. */
  showOlder?: ReadonlySet<string>
}

/** Projects with a live session first, then newest first; each followed by its sessions when expanded (the order and
 *  fold of the file comment). `sessionsOf` returns undefined while a project's first page is in flight. A trailing
 *  `more` row stands for each page not yet fetched, once the older sessions are unfolded. */
export function sessionTreeRows(
  projects: readonly ProjectSummary[],
  expanded: ReadonlySet<string>,
  sessionsOf: (projectPath: string) => SessionPage | undefined,
  moreProjects = false,
  { liveIn = () => 0, statusOf = () => 'finished', showOlder = new Set() }: TreeOptions = {}
): SessionRow[] {
  const rows: SessionRow[] = []
  const live = new Map(projects.map((p) => [p.projectPath, liveIn(p.projectPath)]))
  const ordered = newestFirst(projects, (p) => p.updatedAt).sort((a, b) => Number(live.get(b.projectPath)! > 0) - Number(live.get(a.projectPath)! > 0))
  for (const project of ordered) {
    const path = project.projectPath
    const open = expanded.has(path)
    rows.push({ kind: 'project', id: projectRowId(path), project, expanded: open, live: live.get(path)! })
    if (!open) continue
    const page = sessionsOf(path)
    if (!page) rows.push({ kind: 'loading', id: `loading:${path}` })
    else if (page.entries.length === 0) rows.push({ kind: 'empty', id: `empty:${path}` })
    else {
      const sessions = newestFirst(page.entries, (e) => e.updatedAt).map((entry) => ({ kind: 'session' as const, id: entry.id, entry, status: statusOf(entry) }))
      const running = sessions.filter((r) => isLive(r.status))
      const finished = sessions.filter((r) => !isLive(r.status))
      const unfolded = showOlder.has(path)
      rows.push(...running, ...(unfolded ? finished : finished.slice(0, FINISHED_SHOWN)))
      // the page's total counts every session, live ones too; what is not on screen yet is the rest
      const hidden = page.total - running.length - Math.min(finished.length, FINISHED_SHOWN)
      if (!unfolded && hidden > 0) rows.push({ kind: 'older', id: `older:${path}`, projectPath: path, count: hidden })
      if (unfolded && page.entries.length < page.total) rows.push({ kind: 'more', id: `more:${path}`, projectPath: path })
      if (unfolded && page.total - running.length > FINISHED_SHOWN) rows.push({ kind: 'older', id: `older:${path}`, projectPath: path, count: 0, open: true })
    }
  }
  if (moreProjects) rows.push({ kind: 'more', id: 'more:' })
  return rows
}

/** A history row's state, for its status dot: a running session's attention, or how a finished one ended. */
export type HistoryStatus = 'working' | 'needs' | 'idle' | 'failed' | 'finished'
export const isLive = (s: HistoryStatus): boolean => s === 'working' || s === 'needs' || s === 'idle'

export type SessionFacts = { status: HistoryStatus; planName?: string; jobId?: string }

/** What the app knows of a transcript's session beyond the file: whether it runs now and its state, and the plan it
 *  worked for. The transcript id meets the app through a worker's Dispatch (`nativeSessionId`) or a resumed session
 *  (`resumeSessionId`, a chat's `threadId`); a session started otherwise is not matched and reads finished.
 *  shortcut: a Claude resume writes a new transcript, so the resumed session shows live only once a Dispatch names it. */
export function sessionFactsOf(input: {
  sessions: readonly Pick<SessionInfo, 'id' | 'status' | 'resumeSessionId' | 'threadId'>[]
  attention: Readonly<Record<string, Attention>>
  dispatches: readonly Dispatch[]
  tasks: readonly Task[]
  runs: readonly JobRun[]
  jobs: readonly Job[]
}): (transcriptId: string) => SessionFacts {
  const dispatchOf = new Map<string, Dispatch>()
  for (const d of [...input.dispatches].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) if (d.nativeSessionId) dispatchOf.set(d.nativeSessionId, d)
  const taskOf = new Map(input.tasks.map((t) => [t.id, t]))
  const runOf = new Map(input.runs.map((r) => [r.id, r]))
  const jobOf = new Map(input.jobs.map((j) => [j.id, j]))
  const running = new Map(input.sessions.filter((s) => s.status === 'running').map((s) => [s.id, s]))
  const resumed = new Map<string, string>()
  for (const s of running.values()) for (const id of [s.resumeSessionId, s.threadId]) if (id) resumed.set(id, s.id)
  return (transcriptId) => {
    const d = dispatchOf.get(transcriptId)
    const task = d ? taskOf.get(d.taskId) : undefined
    const jobId = task?.jobId ?? (task?.runId ? runOf.get(task.runId)?.jobId : undefined)
    const job = jobId ? jobOf.get(jobId) : undefined
    const appId = d && running.has(d.sessionId) ? d.sessionId : resumed.get(transcriptId)
    const attention = appId ? input.attention[appId] : undefined
    const status: HistoryStatus = appId
      ? attention === 'working' ? 'working' : attention === 'waiting' ? 'needs' : 'idle'
      : d?.outcome === 'failed' ? 'failed' : 'finished'
    return { status, ...(job ? { planName: jobNameOf(job), jobId: job.id } : {}) }
  }
}

/** A Claude model id as its family ("claude-opus-5-5" → "opus"); other ids as they are. The row's right side is never
 *  cut, so it stays short; the full id is in the row's tooltip. */
export const shortModel = (model?: string): string | undefined => model?.match(/^claude-([a-z]+)-/)?.[1] ?? model

/** An account's chip text: an email's name part ("work@example.com" → "work"), the full label in the chip's tooltip. */
export const accountChipText = (label: string): string => (label.includes('@') ? label.slice(0, label.indexOf('@')) || label : label)
