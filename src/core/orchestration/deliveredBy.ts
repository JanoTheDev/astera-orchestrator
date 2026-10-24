// A plan whose branch reached main inside a later plan's delivery (Job.deliveredBy). Pure: the git question is the
// caller's `isAncestor`, so the Host asks git and the tests ask a fake.
import { projectOfJob } from './projects'
import { outcomeOf, runDelivered } from './running'
import type { OrchState } from './state'
import type { Job, JobRun } from './types'

/** Only plans made this recently are looked at: older ones have lost their branches, and the check is a git call each. */
export const DELIVERED_BY_WINDOW_MS = 30 * 86_400_000

type Marks = { jobId: string; deliveredBy: NonNullable<Job['deliveredBy']> }[]

/** The plan's newest Run, the one its row reads. */
const latestRunOf = (s: OrchState, jobId: string): JobRun | undefined =>
  s.runs.filter((r) => r.jobId === jobId).reduce<JobRun | undefined>((best, r) => (best === undefined || r.ordinal > best.ordinal ? r : best), undefined)

/** The Run's work reached its base: pushed, a PR opened, or the owner pushed it (running.ts runDelivered, DeliveryProgress). */
const landed = (run: JobRun): boolean =>
  runDelivered(run) || run.deliveryState?.state === 'delivered' || run.deliveryState?.state === 'delivered-by-owner'

const recent = (job: Job, atMs: number): boolean => atMs - Date.parse(job.createdAt) <= DELIVERED_BY_WINDOW_MS

/** The plans delivered in the last 30 days: the Host-start sweep asks `deliveredByLaterPlan` for each. */
export function deliveredJobIds(s: OrchState, at: string): string[] {
  const atMs = Date.parse(at)
  return s.jobs.filter((j) => recent(j, atMs) && latestRunOf(s, j.id) !== undefined && landed(latestRunOf(s, j.id)!)).map((j) => j.id)
}

/** The plans one commit delivered: a Run `landed` in `next` that did not in `prev`. */
export function newlyDelivered(prev: OrchState, next: OrchState): string[] {
  const before = new Set(prev.runs.filter(landed).map((r) => r.id))
  return [...new Set(next.runs.filter((r) => landed(r) && !before.has(r.id)).map((r) => r.jobId))]
}

/**
 * One mark per earlier plan. Several later deliveries can each carry the same branch (it is an ancestor of all of them);
 * the one whose delivering plan was created first is the delivery that carried it, so that one wins.
 */
export function keepEarliestDelivery(s: OrchState, marks: Marks): Marks {
  const createdAt = (jobId: string): string => s.jobs.find((j) => j.id === jobId)?.createdAt ?? ''
  const best = new Map<string, Marks[number]>()
  for (const m of marks) {
    const kept = best.get(m.jobId)
    if (kept === undefined || createdAt(m.deliveredBy.jobId) < createdAt(kept.deliveredBy.jobId)) best.set(m.jobId, m)
  }
  return [...best.values()]
}

/**
 * The earlier plans `deliveredJobId`'s delivery carried to the base: plans of its project, made before it and within 30
 * days, that did not land themselves (failed, finished undelivered, or delivery dismissed), whose Run branch `isAncestor`
 * says is inside the delivering Run's commit. `isAncestor` may throw: that plan is simply not marked. Each mark is the
 * `Job.deliveredBy` to record; the plan's own outcome is left as it was.
 */
export async function deliveredByLaterPlan(
  s: OrchState,
  deliveredJobId: string,
  isAncestor: (earlier: JobRun, later: JobRun) => Promise<boolean>,
  at: string
): Promise<Marks> {
  const delivered = s.jobs.find((j) => j.id === deliveredJobId)
  const later = delivered && latestRunOf(s, delivered.id)
  if (!delivered || !later || !landed(later)) return []
  const atMs = Date.parse(at)
  const projectKey = (j: Job): string => projectOfJob(s, j)?.id ?? j.cwd
  const key = projectKey(delivered)
  const marks: Marks = []
  for (const job of s.jobs) {
    if (job.id === delivered.id || job.deliveredBy !== undefined || job.archivedAt !== undefined || job.schedule !== undefined) continue
    if (job.createdAt >= delivered.createdAt || !recent(job, atMs) || projectKey(job) !== key) continue
    const earlier = latestRunOf(s, job.id)
    if (!earlier?.worktree || landed(earlier)) continue
    const outcome = outcomeOf(s, earlier.id)
    if (outcome !== 'failed' && outcome !== 'completed') continue
    // A plan that produced nothing has a branch at its fork point, which is inside every later commit
    if (!s.tasks.some((t) => t.runId === earlier.id && t.status === 'completed')) continue
    const inside = await isAncestor(earlier, later).catch(() => false)
    if (inside) marks.push({ jobId: job.id, deliveredBy: { jobId: delivered.id, at, ...(later.delivery?.sha !== undefined ? { commit: later.delivery.sha } : {}) } })
  }
  return marks
}
