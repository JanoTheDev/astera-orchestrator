import { useEffect, useState } from 'react'
import type { Dispatch, Gate, Job, JobRun, Message, Project, Task } from '../../../core/orchestration/types'
import { sameOrNext } from '../lib/remoteSessions'
import { createSharedPoll } from './sharedPoll'
import { workspacesOf, type WorkspaceData } from './workspaceTree'

/** How often the tree is read again while it is wanted. No push carries every project's state: `orch:state` is the
 *  Jobs view's subscription to one project. */
const POLL_MS = 5000

const read = async <T>(projectPath: string, cmd: string, args: Record<string, unknown> = {}): Promise<T | null> => {
  try {
    const r = await window.api.orch.command(projectPath, cmd, args)
    return r.status === 200 ? (r.body as T) : null
  } catch {
    return null
  }
}

/** The new read with every part that did not change replaced by the one already held, and `prev` itself when none
 *  changed: a tick that finds nothing new renders nothing, and the memos derived from one list keep their inputs. */
export function keepUnchanged(prev: WorkspaceData | undefined, next: WorkspaceData): WorkspaceData {
  if (!prev) return next
  const p = prev as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  const keys = Object.keys(next)
  let same = keys.length === Object.keys(prev).length
  for (const k of keys) {
    const n = (next as unknown as Record<string, unknown>)[k]
    let v: unknown
    if (k === 'jobsByProject') {
      const old = prev.jobsByProject
      const lists: Record<string, Job[]> = {}
      for (const [id, jobs] of Object.entries(next.jobsByProject)) lists[id] = sameOrNext(old[id] ?? null, jobs)
      v = Object.keys(lists).length === Object.keys(old).length && Object.entries(lists).every(([id, l]) => l === old[id]) ? old : lists
    } else {
      v = sameOrNext(p[k] ?? null, n)
    }
    out[k] = v
    if (v !== p[k]) same = false
  }
  return same ? prev : (out as unknown as WorkspaceData)
}

/** One poll per anchor for the whole window: the top bar and the Agents page read the same tree. */
const workspacePoll = createSharedPoll<WorkspaceData>(POLL_MS)

const readWorkspace = async (anchorProp: string | null): Promise<WorkspaceData | undefined> => {
  // W7-F (#78): with no open project or session there is no anchor, which left the tree empty ("No projects yet")
  // although projects are registered. The home folder is a path the app may name, so it opens the same door.
  const anchor = anchorProp ?? (await window.api.system.homeDir().catch(() => null))
  if (!anchor) return undefined
  const listed = await read<Project[]>(anchor, 'projects-list')
  if (!listed) return undefined
  const projects = workspacesOf(listed)
  const [jobLists, runs, tasks, dispatches, gates, escalations, worktrees] = await Promise.all([
    Promise.all(projects.map((p) => read<Job[]>(anchor, 'jobs-list', { project: p.path, archived: true }))),
    read<JobRun[]>(anchor, 'runs-list'),
    read<Task[]>(anchor, 'tasks-list', { brief: true }),
    read<Dispatch[]>(anchor, 'dispatches-list'),
    read<Gate[]>(anchor, 'questions-list', { status: 'open' }),
    read<Message[]>(anchor, 'inbox', { type: 'escalation', limit: 500 }), // W6-B
    // W6-F: where each worktree is and which repo it came from; without them a worktree's tabs are "Other"
    window.api.worktrees.list().then(
      (ws) => ws.map((w) => ({ path: w.path, repoPath: w.repoPath })),
      () => []
    )
  ])
  if (!runs || !tasks || !dispatches || !gates) return undefined
  const jobsByProject: Record<string, Job[]> = {}
  projects.forEach((p, i) => {
    jobsByProject[p.id] = jobLists[i] ?? []
  })
  return { projects, jobsByProject, runs, tasks, dispatches, gates, worktrees, ...(escalations ? { escalations } : {}) }
}

/**
 * Every project's plans, runs, tasks, dispatches and open Gates, through the same door the CLI uses (`orch.command`)
 * — read only. `anchor` is any path the app may name (a session's cwd or the open project), which these unscoped
 * reads need as their door argument.
 *
 * W3-C: Dispatches come from one unscoped `dispatches-list`, so every project's sessions refresh on every tick. (W2-B
 * read them per Task with `dispatch-show`, which is owner checked against the project the Jobs view watches, so other
 * projects' sessions went stale.) An account roll rekeys a Dispatch to its new session without moving the Task, and
 * this read sees that too.
 */
export function useWorkspaceData(anchorProp: string | null, enabled: boolean, refreshKey = 0): WorkspaceData | null {
  const [data, setData] = useState<WorkspaceData | null>(null)
  const key = anchorProp ?? ''
  useEffect(() => {
    if (!enabled) return
    return workspacePoll.subscribe(key, { read: () => readWorkspace(anchorProp), merge: keepUnchanged }, setData)
    // `key` stands for the anchor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  useEffect(() => {
    if (refreshKey > 0) workspacePoll.reload(key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])
  return data
}
