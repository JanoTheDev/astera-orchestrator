// W8-C plan after plan (`Job.after`): a queued plan stays `pendingStart` until the plan it names is delivered; the Host's
// loop then starts its planner (exec/dispatchLoop.ts). A plan that stops on the way leaves the queued one waiting, and
// the Host escalates that once (`afterSweep`, `Job.afterStopNotified`, activity.ts turns it into `task.escalated`).
//
// Pure, and web-safe (the Home tree reads it): only types, `isJobActive` and `outcomeOfTasks`.
import type { Job, JobRun } from './types'
import type { OrchState } from './state'
import { isJobActive } from './lifecycle'
import { outcomeOfTasks } from './running'
import { jobNameOf } from './jobName'

type AfterState = Pick<OrchState, 'jobs' | 'runs' | 'tasks'>

/** Where the Job a queued plan waits on stands. */
export type AfterStand = 'delivered' | 'stopped' | 'waiting'

// The same pick as publicViews.ts latestRunOf, which this web-safe file cannot import.
const latestRunOf = (s: AfterState, jobId: string): JobRun | undefined =>
  s.runs.filter((r) => r.jobId === jobId).sort((a, b) => a.ordinal - b.ordinal).at(-1)

/** Delivered: its latest Run pushed (a sha, no error), opened its pull request (a url, not a draft, no error) or left
 *  its work on a branch with no remote (`pr.note`, W7-E); or the plan ended with nothing to do. Stopped: archived
 *  (rejected too) or gone, or its latest Run gave up (failed) or its delivery stopped. Else waiting. */
export function afterStandOf(s: AfterState, jobId: string): AfterStand {
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job) return 'stopped'
  if (job.nothingToDo !== undefined) return 'delivered'
  const run = latestRunOf(s, jobId)
  const pr = run?.pr
  if (run?.delivery?.sha !== undefined && run.delivery.error === undefined) return 'delivered'
  if (pr && pr.error === undefined && pr.draft === undefined && (pr.url !== undefined || pr.note !== undefined)) return 'delivered'
  if (!isJobActive(job)) return 'stopped'
  if (run?.delivery?.error !== undefined || pr?.error !== undefined) return 'stopped'
  if (run && outcomeOfTasks(s.tasks.filter((t) => t.runId === run.id)) === 'failed') return 'stopped'
  return 'waiting'
}

export const jobDelivered = (s: AfterState, jobId: string): boolean => afterStandOf(s, jobId) === 'delivered'

/** Still queued: it names a Job to wait for, has not started, has no planner yet and is not archived. */
export const afterQueued = (job: Job): boolean =>
  job.after !== undefined && job.pendingStart === true && job.plannerSessionIds === undefined && isJobActive(job)

/** The name of the Job `id` names, or the id itself when it is gone. */
export const afterNameOf = (s: Pick<OrchState, 'jobs'>, id: string): string => {
  const job = s.jobs.find((j) => j.id === id)
  return job ? jobNameOf(job) : id
}

/** Why `jobId` may not wait on `target`, or null: unknown (`missing`), itself, or a chain that comes back to it. */
export function afterRefusal(s: Pick<OrchState, 'jobs'>, jobId: string, target: string): { error: string; missing?: true } | null {
  if (target === jobId) return { error: `job ${jobId} cannot wait on itself` }
  if (!s.jobs.some((j) => j.id === target)) return { error: `unknown job: ${target}`, missing: true }
  const seen = new Set<string>()
  for (let at: string | undefined = target; at !== undefined && !seen.has(at); at = s.jobs.find((j) => j.id === at)?.after) {
    if (at === jobId) return { error: `job ${target} already waits on job ${jobId}: the chain would wait on itself` }
    seen.add(at)
  }
  return null
}

/** The queued Jobs whose predecessor is delivered: the Host starts each one's planner. */
export const afterStartsDue = (s: AfterState): Job[] =>
  s.jobs.filter((j) => afterQueued(j) && jobDelivered(s, j.after!))

/** The escalation's text for a queued Job whose predecessor stopped. */
export const afterStoppedText = (s: Pick<OrchState, 'jobs'>, job: Job): string => `Waiting on ${afterNameOf(s, job.after!)}, which stopped`

/** Marks each queued Job whose predecessor stopped (`afterStopNotified`, the escalation's once-marker), and clears the
 *  mark of one whose predecessor no longer is (unarchived, delivered), so a later stop escalates again. The same state
 *  back when nothing changes. */
export function afterSweep<S extends AfterState>(s: S, now: string): S {
  let changed = false
  const jobs = s.jobs.map((j) => {
    const stopped = afterQueued(j) && afterStandOf(s, j.after!) === 'stopped'
    if (stopped === (j.afterStopNotified !== undefined)) return j
    changed = true
    if (stopped) return { ...j, afterStopNotified: now }
    const { afterStopNotified: _mark, ...rest } = j
    return rest
  })
  return changed ? { ...s, jobs } : s
}
