import { useEffect, useState } from 'react'
import type { Dispatch, Job, JobRun, Project, Task } from '../../../../core/orchestration/types'
import type { WorkspaceData } from './workspaceTree'

/** How often the tree is read again while it is wanted. No push carries every project's state: `orch:state` is the
 *  Jobs view's subscription to one project. */
const POLL_MS = 5000

/** A Task whose Dispatch may be live. Its Dispatch can change without the Task moving — an account roll rekeys
 *  the Dispatch to the new session (rollTap's onRolled) — so these are read on every tick. Bounded by concurrency. */
const LIVE = new Set<Task['status']>(['dispatched', 'validating', 'reviewing'])

const read = async <T>(projectPath: string, cmd: string, args: Record<string, unknown> = {}): Promise<T | null> => {
  try {
    const r = await window.api.orch.command(projectPath, cmd, args)
    return r.status === 200 ? (r.body as T) : null
  } catch {
    return null
  }
}

/**
 * Every project's plans, runs, tasks and dispatches, through the same door the CLI uses (`orch.command`) — read
 * only. `anchor` is any path the app may name (a session's cwd or the open project), which these unscoped reads
 * need as their door argument.
 *
 * Dispatches come per Task (`dispatch-show`, the only read that has them), asked with the Task's own project path
 * and only when the Task moved (`updatedAt`) or is live (LIVE): a new or retried Dispatch always moves its Task.
 * That read is owner checked against the project the Jobs view watches, so while it watches another project, a
 * Task of this one keeps the dispatches last read (never cleared on a refusal).
 */
export function useWorkspaceData(anchor: string | null, enabled: boolean): WorkspaceData | null {
  const [data, setData] = useState<WorkspaceData | null>(null)
  useEffect(() => {
    if (!enabled || !anchor) return
    let alive = true
    // taskId → [updatedAt it was read at, its dispatches]
    const cache = new Map<string, [string, Dispatch[]]>()
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
      const projects = await read<Project[]>(anchor, 'projects-list')
      if (!projects || !alive) return
      const [jobLists, runs, tasks] = await Promise.all([
        Promise.all(projects.map((p) => read<Job[]>(anchor, 'jobs-list', { project: p.path, archived: true }))),
        read<JobRun[]>(anchor, 'runs-list'),
        read<Task[]>(anchor, 'tasks-list', { brief: true })
      ])
      if (!runs || !tasks || !alive) return
      const jobsByProject: Record<string, Job[]> = {}
      const projectPathOfJob = new Map<string, string>()
      projects.forEach((p, i) => {
        jobsByProject[p.id] = jobLists[i] ?? []
        for (const j of jobsByProject[p.id]) projectPathOfJob.set(j.id, p.path)
      })
      const jobOfRun = new Map(runs.map((r) => [r.id, r.jobId]))
      // Only each plan's latest Run is listed (workspaceTree), so only its Tasks' dispatches are read
      const latest = new Map<string, JobRun>()
      for (const r of runs) if ((latest.get(r.jobId)?.ordinal ?? -1) < r.ordinal) latest.set(r.jobId, r)
      const shown = new Set([...latest.values()].map((r) => r.id))
      await Promise.all(
        tasks.map(async (t) => {
          if (!shown.has(t.runId ?? '') || t.status === 'pending' || (!LIVE.has(t.status) && cache.get(t.id)?.[0] === t.updatedAt)) return
          const path = projectPathOfJob.get(jobOfRun.get(t.runId ?? '') ?? '')
          if (!path) return
          const ds = await read<Dispatch[]>(path, 'dispatch-show', { task: t.id })
          if (ds) cache.set(t.id, [t.updatedAt, ds])
        })
      )
      if (!alive) return
      setData({ projects, jobsByProject, runs, tasks, dispatches: [...cache.values()].flatMap(([, ds]) => ds) })
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [anchor, enabled])
  return data
}
