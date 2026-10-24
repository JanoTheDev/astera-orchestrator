// T2 checks run once, where the code comes together. A push plan does not validate its delivery while a plan of the
// same repository that outranks it (`planOutranks`) and meets it (an entry of its `Job.overlaps`) is landing: once that
// one delivered or stopped, this one merges origin once and validates once. Without the wait both validate, the later
// push is rejected, and the catch-up of `deliverByPush` validates again, once for every plan that landed meanwhile.
//
// Pure: no clock and no files.
import { afterStandOf } from '../after'
import { deliveryLandingOf } from '../delivery'
import { jobNameOf } from '../jobName'
import { outcomeOfTasks } from '../running'
import { planOutranks, projectKeyOf } from '../schedule'
import { jobOf, type OrchState } from '../state'
import { newId, type DeliveryProgress, type Job } from '../types'

/** How long a delivery waits for another plan before the owner is told, once (it keeps waiting). */
export const DELIVERY_WAIT_ESCALATE_MS = 30 * 60_000

/** Landing: a push plan whose latest Run's Tasks all completed and whose delivery has neither landed nor stopped. */
function landing(s: OrchState, job: Job): boolean {
  const mode = deliveryLandingOf(s, job).mode
  if ((mode !== 'push' && mode !== 'merge') || afterStandOf(s, job.id) !== 'waiting') return false
  const run = s.runs.filter((r) => r.jobId === job.id).sort((a, b) => a.ordinal - b.ordinal).at(-1)
  return run !== undefined && outcomeOfTasks(s.tasks.filter((t) => t.runId === run.id)) === 'completed'
}

/** The plan `job`'s delivery waits for before it validates, or null: one of the same project that outranks it, meets it
 *  (`job.overlaps`) and is landing. A plan that delivers by PR lands nothing on the branch, so it is waited for by none. */
export function deliveryWaitFor(s: OrchState, job: Job): Job | null {
  const key = projectKeyOf(s, job)
  for (const id of new Set((job.overlaps ?? []).map((o) => o.jobId))) {
    const other = s.jobs.find((j) => j.id === id)
    if (other && other.id !== job.id && projectKeyOf(s, other) === key && planOutranks(other, job) && landing(s, other)) return other
  }
  return null
}

/** One look at Run `runId`'s delivery: the plan it waits for (null: none, it validates now) and the state with the wait
 *  recorded on the Run (`deliveryState.waitingFor`, its `since` kept while it is the same plan) or cleared. After
 *  `DELIVERY_WAIT_ESCALATE_MS` the owner is told once by an escalation from the Run, as a stopped delivery is
 *  (recordDelivery). The state is `s` itself when nothing changed. */
export function deliveryWaitStep(s: OrchState, runId: string, at: string): { state: OrchState; waitingFor: Job | null } {
  const run = s.runs.find((r) => r.id === runId)
  const job = run && jobOf(s, run)
  if (!run || !job) return { state: s, waitingFor: null }
  const p = run.deliveryState
  const other = deliveryWaitFor(s, job)
  const put = (next: DeliveryProgress): OrchState => ({ ...s, runs: s.runs.map((r) => (r.id === runId ? { ...r, deliveryState: next } : r)) })
  if (!other) {
    if (p?.waitingFor === undefined) return { state: s, waitingFor: null }
    const { waitingFor: _done, ...rest } = p
    return { state: put(rest), waitingFor: null }
  }
  const prev = p?.waitingFor?.jobId === other.id ? p.waitingFor : undefined
  const since = prev?.since ?? at
  const due = prev?.escalated === undefined && Date.parse(at) - Date.parse(since) >= DELIVERY_WAIT_ESCALATE_MS
  const waitingFor = { jobId: other.id, since, ...(prev?.escalated !== undefined ? { escalated: prev.escalated } : due ? { escalated: at } : {}) }
  if (prev && !due) return { state: s, waitingFor: other }
  const next = put({ ...(p ?? { state: 'pending', attempts: 0 }), waitingFor })
  if (!due) return { state: next, waitingFor: other }
  const plan = jobNameOf(job)
  const first = jobNameOf(other)
  const message = {
    id: newId('msg'),
    runId,
    type: 'escalation' as const,
    subject: `Delivery of ${plan} has waited 30 minutes for ${first} to land`.slice(0, 500),
    body:
      `${plan} is done and delivers after ${first}, which goes first and changes the same files. ${first} has neither ` +
      `delivered nor stopped since ${since}. ${plan} keeps waiting and validates once ${first} lands or stops.`,
    answered: false,
    createdAt: at
  }
  return { state: { ...next, messages: [...next.messages, message] }, waitingFor: other }
}
