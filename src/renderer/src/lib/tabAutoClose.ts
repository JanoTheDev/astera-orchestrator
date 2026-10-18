// W7-F (#84): which ended session tabs close on their own. Pure, so vitest's node environment tests it.
//
// **Only an ended session's tab, and only a plan's.** A plain session (no plan holds it) keeps its struck-through tab
// until the person closes it, as before. A plan's ended tabs close once the plan itself has ended (archived, or its
// latest Run finished), and a planner's ended tab closes as soon as the plan has moved past it: a newer planner exists,
// or the plan is no longer waiting on it (approved, not replanning with it). Closing a tab ends nothing and forgets
// nothing: the session had already exited, and its scrollback and transcript stay where they were.
import type { Dispatch, Job, JobRun, Task } from '../../../core/orchestration/types'
import { isJobActive } from '../../../core/orchestration/lifecycle'
import { outcomeOfTasks } from '../../../core/orchestration/running'

export interface TabAutoCloseInput {
  sessions: readonly { id: string; status: string }[]
  jobs: readonly Job[]
  runs: readonly JobRun[]
  tasks: readonly Pick<Task, 'id' | 'runId' | 'status' | 'consecutiveFailures'>[]
  dispatches: readonly Pick<Dispatch, 'taskId' | 'sessionId'>[]
  openTabSessionIds: Iterable<string>
  /** The app setting `autoCloseEndedPlanTabs`. */
  enabled: boolean
}

/** A plan has ended: archived, or its latest Run's Tasks all stopped moving. A replan in flight is not an end. */
function planEnded(job: Job, runs: readonly JobRun[], tasks: TabAutoCloseInput['tasks']): boolean {
  if (!isJobActive(job)) return true
  if (job.replanning) return false
  const latest = runs.filter((r) => r.jobId === job.id).sort((a, b) => a.ordinal - b.ordinal).at(-1)
  if (!latest) return false
  return outcomeOfTasks(tasks.filter((t) => t.runId === latest.id) as Task[]) !== 'running'
}

/** The session ids whose tabs should close now: open, exited, and of a plan that is done with them. */
export function tabsToAutoClose(input: TabAutoCloseInput): string[] {
  if (!input.enabled) return []
  const open = new Set(input.openTabSessionIds)
  const exited = new Set(input.sessions.filter((s) => s.status === 'exited').map((s) => s.id))
  const closable = (id: string | undefined): id is string => id !== undefined && open.has(id) && exited.has(id)
  const runOfTask = new Map(input.tasks.map((t) => [t.id, t.runId]))
  const out = new Set<string>()
  const seen = new Set<string>()
  for (const job of input.jobs) {
    if (seen.has(job.id)) continue // a Job can be listed under more than one project's read
    seen.add(job.id)
    const planners = job.plannerSessionIds ?? []
    if (planEnded(job, input.runs, input.tasks)) {
      const runs = input.runs.filter((r) => r.jobId === job.id)
      const runIds = new Set(runs.map((r) => r.id))
      const ids = [
        ...planners,
        ...runs.flatMap((r) => [r.coordinatorSessionId, r.externalCoordinatorSessionId]),
        ...input.dispatches.filter((d) => runIds.has(runOfTask.get(d.taskId) ?? '')).map((d) => d.sessionId)
      ]
      for (const id of ids) if (closable(id)) out.add(id)
      continue
    }
    // Still running: only its planners. Every one but the latest is stale; the latest is kept while the plan waits on
    // it (awaiting approval, or this replan's own session).
    planners.forEach((id, i) => {
      const latest = i === planners.length - 1
      const waitedOn = latest && (job.pendingStart === true || job.replanning?.sessionId === id)
      if (!waitedOn && closable(id)) out.add(id)
    })
  }
  return [...out]
}
