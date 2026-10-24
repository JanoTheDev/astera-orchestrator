// T8 Plan settings: the form's pure parts. Which setting can change and why is core's (editableSettingsOf); this turns
// the replies the renderer can get into its input, clamps what the owner typed, and says what `jobs-set` is sent.
import type { MessageKey } from '../../../../core/i18n'
import type { RunOutcome } from '../../../../core/types'
import { editableSettingsOf, type PlanSetting, type PlanSettingKey, type PlanSettingReason, type PlanSettings } from '../../../../core/orchestration/planSettings'
import type { ApprovalMode } from '../../../../core/settings/approvalDefault'
import { emptyState } from '../../../../core/orchestration/state'
import { DEFAULT_CONCURRENCY, MAX_CONCURRENT_WORKERS, MAX_REVIEW_ROUNDS, type DeliveryMode, type Job, type JobRun, type Project } from '../../../../core/orchestration/types'

/** What the form shows: every value set, the plan's own, else its project's, else the default. */
export interface PlanSettingsValues {
  concurrency: number
  priority: number
  reviewRounds: number
  replan: boolean
  autoApprove: boolean
  handsOff: boolean
  delivery: DeliveryMode
}

/** The approval setting's words, shared with Settings > Agents. */
export const APPROVAL_LABEL = { ask: 'plan.approval.ask', start: 'plan.approval.start', 'hands-off': 'plan.approval.handsOff' } as const satisfies Record<ApprovalMode, MessageKey>

/** The one approval setting the two stored flags make. */
export const approvalOf = (v: Pick<PlanSettingsValues, 'autoApprove' | 'handsOff'>): ApprovalMode => (v.handsOff ? 'hands-off' : v.autoApprove ? 'start' : 'ask')

export type PlanSettingsForm = { values: PlanSettingsValues; fields: Record<PlanSettingKey, Omit<PlanSetting<unknown>, 'value'>> }

/** The form for one plan from `jobs-get` (the Job, its latest Run under `run`) and `projects-get`. The renderer has no
 *  OrchState, so editableSettingsOf reads a state of just these; the snapshot row's `outcome` stands in for the Tasks
 *  that state leaves out (a plan whose Run no longer reads running is finished, as settingRefusalOf says). */
export function planSettingsFormOf(job: Job, run: JobRun | undefined, project: Project | undefined, outcome: RunOutcome | undefined, globalDefault?: ApprovalMode): PlanSettingsForm {
  const state = { ...emptyState(), jobs: [job], runs: run ? [run] : [], projects: project ? [project] : [] }
  const s = editableSettingsOf(state, job.id, globalDefault) as PlanSettings
  const finished = outcome !== undefined && outcome !== 'running'
  const field = (f: PlanSetting<unknown>): Omit<PlanSetting<unknown>, 'value'> =>
    finished ? { editable: false, reason: 'finished' } : f.reason === undefined ? { editable: f.editable } : { editable: f.editable, reason: f.reason }
  return {
    values: {
      concurrency: s.concurrency.value ?? DEFAULT_CONCURRENCY,
      priority: s.priority.value,
      reviewRounds: s.reviewRounds.value,
      replan: s.replan.value === 'waves',
      autoApprove: s.autoApprove.value,
      handsOff: s.handsOff.value,
      delivery: s.delivery.value
    },
    fields: {
      concurrency: field(s.concurrency),
      priority: field(s.priority),
      reviewRounds: field(s.reviewRounds),
      replan: field(s.replan),
      autoApprove: field(s.autoApprove),
      handsOff: field(s.handsOff),
      delivery: field(s.delivery)
    }
  }
}

/** A whole number typed into a stepper, held to [min, max]; null for nothing or not a number (the field reverts). */
const clampOf = (min: number, max: number) => (raw: string): number | null => {
  const n = Math.round(Number(raw))
  return raw.trim() === '' || !Number.isFinite(n) ? null : Math.min(max, Math.max(min, n))
}
export const clampWorkers = clampOf(1, MAX_CONCURRENT_WORKERS)
/** `jobs-set` refuses 0 rounds (--review-rounds >= 1). */
export const clampReviewRounds = clampOf(1, MAX_REVIEW_ROUNDS)

/** The `jobs-set` arguments for what changed between `before` and `after`, in the backend's names and words; null when
 *  nothing did. */
export function settingsDiff(before: PlanSettingsValues, after: PlanSettingsValues): Record<string, unknown> | null {
  const args: Record<string, unknown> = {}
  if (after.concurrency !== before.concurrency) args.concurrency = after.concurrency
  if (after.priority !== before.priority) args.priority = after.priority
  if (after.reviewRounds !== before.reviewRounds) args.reviewRounds = after.reviewRounds
  if (after.replan !== before.replan) args.replan = after.replan ? 'waves' : 'off'
  if (after.autoApprove !== before.autoApprove) args.autoApprove = after.autoApprove ? 'on' : 'off'
  if (after.handsOff !== before.handsOff) args.handsOff = after.handsOff ? 'on' : 'off'
  if (after.delivery !== before.delivery) args.delivery = after.delivery
  return Object.keys(args).length === 0 ? null : args
}

/** What the form shows once a save answered: the new values, or the old ones when it failed (the field reverts). */
export const settledValues = (before: PlanSettingsValues, after: PlanSettingsValues, ok: boolean): PlanSettingsValues => (ok ? after : before)

/** The sentence under a read-only field. */
export const SETTING_REASON_KEY: Record<PlanSettingReason, MessageKey> = {
  finished: 'plan.settings.reason.finished',
  deliveryStarted: 'plan.settings.reason.deliveryStarted'
}

/** The priority Select's choices: low, normal and high, and the plan's own number when it is none of those (set at
 *  the CLI), highest first. */
export function priorityChoicesOf(current: number): { value: number; key?: MessageKey }[] {
  const named: { value: number; key: MessageKey }[] = [
    { value: 1, key: 'plan.settings.priority.high' },
    { value: 0, key: 'plan.settings.priority.normal' },
    { value: -1, key: 'plan.settings.priority.low' }
  ]
  return named.some((c) => c.value === current) ? named : [...named, { value: current }].sort((a, b) => b.value - a.value)
}
