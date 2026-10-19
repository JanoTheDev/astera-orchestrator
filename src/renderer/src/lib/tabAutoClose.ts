// W7-F (#84): which ended session tabs close on their own. Pure, so vitest's node environment tests it.
//
// **Only an ended session's tab, and only a plan's.** A plain session (no plan holds it) keeps its struck-through tab
// until the person closes it, as before. A plan's ended tabs close once the plan itself has ended (archived, or its
// latest Run finished), and a planner's ended tab closes as soon as the plan has moved past it: a newer planner exists,
// or the plan is no longer waiting on it (approved, not replanning with it). Closing a tab ends nothing and forgets
// nothing: the session had already exited, and its scrollback and transcript stay where they were.
//
// **A running plan closes what it is done with too** (the owner's decision of 2026-10-18): a worker's tab once its Task
// is completed (merged or not), a reviewer's once its verdict is recorded (`sessionsDoneWith`, the rule
// the driving loop ends those sessions by), a replan's planner once the replan ended, and a coordinator a fresh one
// replaced. A failed Task's, an open Gate's, and a session that has not exited keep theirs.
import type { Dispatch, Gate, Job, JobRun, Task } from '../../../core/orchestration/types'
import { isJobActive } from '../../../core/orchestration/lifecycle'
import { outcomeOfTasks } from '../../../core/orchestration/running'
import { sessionsDoneWith } from '../../../core/orchestration/finishedSessions'

export interface TabAutoCloseInput {
  sessions: readonly { id: string; status: string }[]
  jobs: readonly Job[]
  runs: readonly JobRun[]
  tasks: readonly Pick<Task, 'id' | 'runId' | 'status' | 'consecutiveFailures'>[]
  dispatches: readonly Pick<Dispatch, 'taskId' | 'sessionId'>[]
  /** The open Gates (`questions-list --status open`). Absent: none known, so no running plan's tab closes early. */
  gates?: readonly Gate[]
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
  // Only with the full rows: the rule reads deps, cwd and outcome, which the slim test rows leave out
  const doneWith = input.gates
    ? sessionsDoneWith({
        runs: input.runs as JobRun[],
        jobs: input.jobs as Job[],
        tasks: input.tasks as Task[],
        dispatches: input.dispatches as Dispatch[],
        gates: input.gates as Gate[]
      })
    : []
  const out = new Set<string>()
  for (const d of doneWith) if (closable(d.sessionId)) out.add(d.sessionId)
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
    // Still running: what it is done with (see the head), and its planners. Every planner but the latest is stale; the
    // latest is kept while the plan waits on it (awaiting approval, or this replan's own session).
    for (const r of input.runs) if (r.jobId === job.id) for (const x of r.coordinatorRefreshes ?? []) if (closable(x.from)) out.add(x.from)
    planners.forEach((id, i) => {
      const latest = i === planners.length - 1
      const waitedOn = latest && (job.pendingStart === true || job.replanning?.sessionId === id)
      if (!waitedOn && closable(id)) out.add(id)
    })
  }
  return [...out]
}
