import { useEffect, useState } from 'react'
import type { Dispatch, Gate, Job, JobRun, Message, Project, Task } from '../../../core/orchestration/types'
import { groupJobsByProject, type WorkspaceData } from './workspaceTree'

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
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let running = false // a slow Host must not stack reads up behind each other
    const tick = async (): Promise<void> => {
      if (running) return
      running = true
      try {
        await refresh()
      } finally {
        running = false
      }
    }
    const refresh = async (): Promise<void> => {
      // W7-F (#78): with no open project or session there is no anchor, which left the tree empty ("No projects yet")
      // although projects are registered. The home folder is a path the app may name, so it opens the same door.
      const anchor = anchorProp ?? (await window.api.system.homeDir().catch(() => null))
      if (!anchor) return
      const projects = await read<Project[]>(anchor, 'projects-list')
      if (!projects || !alive) return
      // T6: one read, grouped by Job.projectId (groupJobsByProject): a per-path read cannot tell sub-projects apart
      const [allJobs, runs, tasks, dispatches, gates, escalations, worktrees] = await Promise.all([
        read<Job[]>(anchor, 'jobs-list', { archived: true }),
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
      if (!allJobs || !runs || !tasks || !dispatches || !gates || !alive) return
      const jobsByProject = groupJobsByProject(projects, allJobs, worktrees)
      setData({ projects, jobsByProject, runs, tasks, dispatches, gates, worktrees, ...(escalations ? { escalations } : {}) })
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [anchorProp, enabled, refreshKey])
  return data
}
