// Which settings of a running or queued plan can still change, for the Plan settings tab to grey out the rest, and
// for `jobs-set` to refuse the same. Renderer-safe on purpose: no `node:` import, and every import is in tsconfig.web.json.
import { isJobActive } from './lifecycle'
import { outcomeOf } from './running'
import type { OrchState } from './state'
import { MAX_REVIEW_ROUNDS, type DeliveryMode, type Job, type JobRun } from './types'

export type PlanSettingKey = 'concurrency' | 'priority' | 'reviewRounds' | 'replan' | 'autoApprove' | 'handsOff' | 'delivery'

/** Why a setting cannot change now. The UI maps it to a sentence; `jobs-set` answers 409 with its own. */
export type PlanSettingReason = 'finished' | 'deliveryStarted'

export interface PlanSetting<T> {
  value: T
  editable: boolean
  reason?: PlanSettingReason
}

export interface PlanSettings {
  concurrency: PlanSetting<number | undefined>
  priority: PlanSetting<number>
  reviewRounds: PlanSetting<number>
  replan: PlanSetting<'waves' | 'off'>
  autoApprove: PlanSetting<boolean>
  handsOff: PlanSetting<boolean>
  delivery: PlanSetting<DeliveryMode>
}

const latestRun = (s: OrchState, job: Job): JobRun | undefined =>
  s.runs.filter((r) => r.jobId === job.id).sort((a, b) => a.ordinal - b.ordinal).at(-1)

/** Why `key` cannot change on this plan now, or undefined when it can. A plan is open until its latest Run stops running
 *  or it is archived; a plan's delivery is fixed once its end delivery has started or finished. */
export function settingRefusalOf(s: OrchState, job: Job, key: PlanSettingKey): PlanSettingReason | undefined {
  const run = latestRun(s, job)
  if (!isJobActive(job) || (run !== undefined && outcomeOf(s, run.id) !== 'running')) return 'finished'
  if (key === 'delivery' && run !== undefined && (run.deliveryState !== undefined || run.delivery !== undefined)) return 'deliveryStarted'
  return undefined
}

/** The current value of each editable setting of a plan and whether it can change now. The value is the plan's own,
 *  else its project's, else the default. Undefined for an unknown plan. */
export function editableSettingsOf(s: OrchState, jobId: string): PlanSettings | undefined {
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job) return undefined
  const project = job.projectId === undefined ? undefined : s.projects.find((p) => p.id === job.projectId)
  const field = <T>(key: PlanSettingKey, value: T): PlanSetting<T> => {
    const reason = settingRefusalOf(s, job, key)
    return reason === undefined ? { value, editable: true } : { value, editable: false, reason }
  }
  return {
    concurrency: field('concurrency', job.concurrency ?? project?.concurrency),
    priority: field('priority', job.priority ?? 0),
    reviewRounds: field('reviewRounds', job.convergence?.maxReviewRounds ?? project?.reviewRounds ?? MAX_REVIEW_ROUNDS),
    replan: field('replan', job.replan ?? project?.replan ?? 'waves'),
    autoApprove: field('autoApprove', job.autoApprove ?? project?.autoApprove ?? false),
    handsOff: field('handsOff', job.handsOff ?? project?.handsOff ?? false),
    delivery: field('delivery', job.delivery ?? project?.delivery ?? 'pr')
  }
}
