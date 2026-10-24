// A plan's status word, last activity and its running workers' lines (the Plans tree, the Main plan, JobsView). Pure, so
// the node-only test suite reaches it.
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { JobRow, JobTask, Provider } from '../../../../core/types'
import { formatElapsed, formatRemaining } from '../../../../core/orchestration/elapsed'
import type { ConvergenceChip } from '../../../../core/orchestration/nodeMeta'
import type { ChipTone } from '../ui/Chip'
import { approveSlot } from './planTalk'

type T = (key: MessageKey, params?: MessageParams) => string

export interface PlanStatus {
  key: MessageKey
  tone: ChipTone
  /** Why a failed plan's delivery failed (the Run's deliveryError) */
  reason?: string
  /** The key's placeholders (T36: the failed Task's title) */
  params?: MessageParams
  /** Delivered through another plan (JobRow.deliveredBy): that plan, for the chip's link */
  deliveredBy?: string
}

/** A plan nothing works on and nothing will move (JobRow.stuck): its row offers Archive and Resume. */
const STALLED_KEY = 'pages.plans.status.stalled'
export const isStalledPlan = (row: JobRow): boolean => {
  const key = planStatusOf(row).key
  return key === STALLED_KEY || key === 'plan.outcome.stalledOnFailed'
}

/** What Resume does on a stalled plan: put a lead back on it (run-start, which needs a coordinator account), else retry the
 *  failed Task it waits on (task-failed-resolve). Neither: nothing can resume it, so the row offers Archive alone. */
export type ResumeAction = { kind: 'restart-lead' } | { kind: 'retry'; taskId: string }
export function resumeActionOf(row: JobRow): ResumeAction | undefined {
  if (!isStalledPlan(row)) return undefined
  if (row.coordinatorMissing) return { kind: 'restart-lead' }
  const failed = row.stalledOn?.taskId ?? row.tasks.find((t) => t.status === 'failed')?.id
  return failed !== undefined ? { kind: 'retry', taskId: failed } : undefined
}

/** The one word a plan row's status chip says. A person's part first (approve, a gate), then what holds it, then how it runs. */
export function planStatusOf(row: JobRow): PlanStatus {
  if (row.archivedAt !== undefined) return { key: 'jobs.lifecycle.archived', tone: 'neutral' }
  // A schedule template never runs itself (outcomeOf calls it running for ever): it is scheduled or paused
  if (row.schedule) return row.paused ? { key: 'jobs.run.paused', tone: 'warn' } : { key: 'jobs.run.scheduled', tone: 'info' }
  // A later plan's delivery carried this plan's work to main: it reads Delivered whatever its own outcome recorded
  if (row.deliveredBy && (row.outcome === 'failed' || row.outcome === 'completed'))
    return { key: 'pages.plans.status.deliveredBy', tone: 'ok', params: { plan: row.deliveredBy.title }, deliveredBy: row.deliveredBy.jobId }
  const slot = approveSlot(row)
  if (slot === 'approve') return { key: 'pages.plans.status.approve', tone: 'warn' }
  if (slot === 'planning') return { key: 'jobs.run.planning', tone: 'info' }
  if (slot === 'auto') return { key: 'jobs.run.startsByItself', tone: 'info' }
  if (row.pendingStart) return row.after !== undefined ? { key: 'pages.plans.status.queued', tone: 'neutral' } : { key: 'jobs.run.notStarted', tone: 'neutral' }
  if (row.paused) return { key: 'jobs.run.roundStopped', tone: 'neutral' }
  // T36: waits on a failed Task, never read as paused or running (stallOf is already undefined for a paused Run)
  if (row.stalledOn) return { key: 'plan.outcome.stalledOnFailed', tone: 'danger', params: { task: row.stalledOn.title } }
  // Item 2: everything else ended, and the Tasks held for the owner are left
  if (row.outcome === 'blocked') return { key: 'pages.plans.status.blocked', tone: 'warn' }
  // T8: nothing can move until the owner answers (JobRow.stuck)
  if (row.stuck === 'needs-you') return { key: 'plan.outcome.needsYou', tone: 'warn' }
  if (row.tasks.some((t) => t.status === 'blocked')) return { key: 'pages.plans.status.needsYou', tone: 'warn' }
  if (row.dispatchHold) return { key: 'jobs.hold.held', tone: 'warn' }
  // T8: reads running, and nothing works on it or retries it (`runs doctor`)
  if (row.stuck === 'stalled') return { key: STALLED_KEY, tone: 'danger' }
  if (row.outcome === 'running') return { key: 'pages.plans.status.working', tone: 'info' }
  // Item 8: every Task completed, the final check has not settled: not done yet
  if (row.outcome === 'checking') return { key: 'pages.plans.status.checking', tone: 'info' }
  if (row.outcome === 'failed') return { key: 'pages.plans.status.failed', tone: 'danger', ...(row.deliveryError !== undefined ? { reason: row.deliveryError } : {}) }
  // The owner dismissed a failed delivery: the Tasks are done but the work never landed
  if (row.deliveryDismissed) return { key: 'pages.plans.status.deliveryDismissed', tone: 'warn' }
  return { key: 'pages.plans.status.done', tone: 'ok' }
}

/** The latest time the snapshot knows something happened to the plan (made, started, a worker started, its PR, a delivery attempt, archived),
 *  as epoch ms. Undefined: no time at all (a snapshot from an older Runtime). */
export function lastActivityOf(row: JobRow): number | undefined {
  const times = [row.createdAt, row.autoStartedAt, row.archivedAt, row.pr?.at, row.delivery?.lastAttemptAt, ...row.tasks.map((t) => t.startedAt)]
    .map((iso) => (iso === undefined ? NaN : Date.parse(iso)))
    .filter((ms) => !Number.isNaN(ms))
  return times.length > 0 ? Math.max(...times) : undefined
}

/** A Task with an open Dispatch: view.ts' jobTaskOf sets both fields only then. */
export type RunningTask = JobTask & { provider: Provider; startedAt: string }
export const isRunningTask = (t: JobTask): t is RunningTask => t.provider !== undefined && t.startedAt !== undefined

/** What follows the provider on a running worker's line: the time until a usage reset it waits for, else its elapsed
 *  time, and how often it was resumed. A switch of account is not drawn as a wait (it has no reset time). */
export function taskMeta(task: RunningTask, nowMs: number, t: T): string {
  const wait = task.waiting?.reason === 'waiting' ? task.waiting : undefined
  const left = wait?.resetsAt !== undefined ? formatRemaining(wait.resetsAt, nowMs) : undefined
  const base = wait ? (left !== undefined ? t('jobs.task.waitingReset', { left }) : t('jobs.task.waitingNoTime')) : formatElapsed(task.startedAt, nowMs)
  return task.resumes ? `${base} · ${t('jobs.task.resumedCount', { n: task.resumes })}` : base
}

/** The auto-fix chip's sentence (what to draw is core's convergenceChipOf). */
export function convergenceText(chip: ConvergenceChip, t: T): string {
  switch (chip.kind) {
    case 'repairing':
      return t('jobs.convergence.chip.repairing', { repairs: chip.repairs, max: chip.max })
    case 'reviewing':
      return t('jobs.convergence.chip.reviewing', { round: chip.round, max: chip.max })
    case 'stopped':
      return t('jobs.convergence.chip.stopped')
    default:
      return t('jobs.convergence.chip.exhausted')
  }
}

/** A plan that ended: done, or archived. */
export const isEndedPlan = (row: JobRow): boolean => row.archivedAt !== undefined || planStatusOf(row).key === 'pages.plans.status.done'

/** When an ended plan finished, as epoch ms: JobRow.finishedAt, else the last activity the snapshot knows (an older Runtime). */
export function finishedAtMs(row: JobRow): number | undefined {
  const ms = row.finishedAt !== undefined ? Date.parse(row.finishedAt) : NaN
  return Number.isNaN(ms) ? lastActivityOf(row) : ms
}

/** The Plans side bar's two panes: the plans not ended (in the snapshot's order) on top, the ended ones newest-finished
 *  first below. Archived plans are in `finished` only with `showArchived`. A plan with no known finish time sorts last. */
export function splitPlans(rows: readonly JobRow[], showArchived: boolean): { running: JobRow[]; finished: JobRow[] } {
  const finished = rows
    .filter((r) => isEndedPlan(r) && (showArchived || r.archivedAt === undefined))
    .map((row) => ({ row, at: finishedAtMs(row) ?? -Infinity }))
    .sort((a, b) => b.at - a.at)
    .map((x) => x.row)
  return { running: rows.filter((r) => !isEndedPlan(r)), finished }
}

/** Plans finished longer ago than this are what "Clear finished" offers by default. */
export const OLD_FINISHED_DAYS = 7

/** The finished plans Clear finished would archive: never an archived one; `all`, or only those finished more than
 *  OLD_FINISHED_DAYS before `nowMs` (a plan with no known finish time is not old). */
export const clearableOf = (rows: readonly JobRow[], all: boolean, nowMs: number): JobRow[] =>
  rows.filter((r) => {
    if (!isEndedPlan(r) || r.archivedAt !== undefined) return false
    const at = finishedAtMs(r)
    return all || (at !== undefined && at < nowMs - OLD_FINISHED_DAYS * 86_400_000)
  })
