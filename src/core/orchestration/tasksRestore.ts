// `tasks restore`: bring back Tasks and Dispatches a backup holds and the live store lost (the 2026-10-22 wipe).
// Pure: the command reads the backup file, calls this, and commits the state it returns through the store.
import type { OrchState } from './state'
import type { Dispatch, Task, TaskStatus } from './types'

/** Statuses that mean a worker is (or was) mid-flight on the Task. With no live Dispatch the worker is gone. */
const IN_FLIGHT: ReadonlySet<TaskStatus> = new Set(['dispatched', 'validating', 'reviewing', 'merging'])

export interface RestoreScope {
  job?: string
  run?: string
}

export interface RestoredTask {
  id: string
  title: string
  status: TaskStatus
  /** The status it comes back with: `ready` for a Task that was in flight. */
  restoredAs: TaskStatus
  runId?: string
  jobId?: string
}

export interface RestorePlan {
  tasks: RestoredTask[]
  dispatches: string[]
  /** The live state with the missing entries added; the same object when there is nothing to restore. */
  state: OrchState
}

/** Whether the backup's Task belongs to the chosen scope. A run scope is that run's Tasks. A Job scope is the Tasks of
 *  its runs and the Job's own definition Tasks (`jobId`, no `runId`: the template the plan view and `jobs run` read). */
function inScope(t: Task, scope: RestoreScope, backup: OrchState): boolean {
  if (scope.run !== undefined) return t.runId === scope.run
  if (t.runId === undefined) return t.jobId === scope.job
  return backup.runs.some((r) => r.id === t.runId && r.jobId === scope.job)
}

/**
 * What restoring `scope` from `backup` into `live` adds: the Tasks (by id) the backup has and `live` lacks, with the
 * Dispatches of those Tasks that ended. Never touches an id `live` has and never reads another Job's entries. A Task
 * whose Run (or, for a definition Task, Job) is gone from `live` is left out, since inserting it would leave a dangling reference.
 *
 * **An open Dispatch is not brought back**: its session died with the wipe, and a live-looking Dispatch for a worker
 * that is not there stalls the Task for good. A Task that was in flight comes back `ready`, to be dispatched afresh.
 */
export function planTasksRestore(live: OrchState, backup: OrchState, scope: RestoreScope): RestorePlan {
  if ((scope.job === undefined) === (scope.run === undefined)) throw new Error('give exactly one of job or run')
  const haveTask = new Set(live.tasks.map((t) => t.id))
  const haveDispatch = new Set(live.dispatches.map((d) => d.id))
  const runs = new Set(live.runs.map((r) => r.id))
  const jobs = new Set(live.jobs.map((j) => j.id))
  const missing = backup.tasks.filter(
    (t) =>
      !haveTask.has(t.id) &&
      inScope(t, scope, backup) &&
      (t.runId !== undefined ? runs.has(t.runId) : t.jobId !== undefined && jobs.has(t.jobId))
  )
  const ids = new Set(missing.map((t) => t.id))
  const closed: Dispatch[] = backup.dispatches.filter((d) => ids.has(d.taskId) && !haveDispatch.has(d.id) && d.endedAt)
  const revived = (t: Task): Task => (IN_FLIGHT.has(t.status) ? { ...t, status: 'ready' } : t)
  const tasks = missing.map(revived)
  return {
    tasks: tasks.map((t, i) => ({
      id: t.id,
      title: t.title,
      status: missing[i].status,
      restoredAs: t.status,
      runId: t.runId,
      jobId: t.jobId
    })),
    dispatches: closed.map((d) => d.id),
    state: missing.length === 0 ? live : { ...live, tasks: [...live.tasks, ...tasks], dispatches: [...live.dispatches, ...closed] }
  }
}
