// T3 plan page summary card: what a plan's page shows at a glance (Task counts, progress, time, step, delivery and its
// PR or branch, areas), derived from the JobRow already on the page. Pure, so the node-only test suite reaches it.
import type { JobRow } from '../../../../core/types'
import { planProgressOf } from './planBoard'

/** The card's four (five with cancelled) Task counts, in the order it lists them. Each is drawn with an icon and a word. */
export const SUMMARY_STATES = ['done', 'running', 'waiting', 'failed', 'cancelled'] as const
export type SummaryState = (typeof SUMMARY_STATES)[number]

/** The plan's PR or the branch its work sits on (W7-E: a project with no remote), when there is one. */
export type SummaryLink = { kind: 'pr'; url: string; number?: number; draft: boolean } | { kind: 'branch'; branch: string } | { kind: 'prFailed'; error?: string }

/** Where the plan's work stands on its way to the base branch, as a word to draw. */
export type SummaryDelivery =
  | { kind: 'delivering' | 'retrying' | 'failed' | 'needs-owner'; reason?: string }
  | { kind: 'review' }
  | { kind: 'dismissed' }
  | { kind: 'deliveredBy'; title: string }

export interface PlanSummary {
  total: number
  /** Done over total, rounded down (planProgressOf). */
  percent: number
  /** Non-zero counts, except the first four, which always show (a zero reads as "none yet"). */
  counts: { state: SummaryState; n: number }[]
  wave?: { at: number; of: number }
  /** `running`: since it started, up to now. `finished`: from its start to its finish. Absent before it starts, or when
   *  a finished plan has no finish time (an older snapshot). */
  time?: { kind: 'running' | 'finished'; ms: number; finishedAt?: string }
  link?: SummaryLink
  delivery?: SummaryDelivery
  areas: string[]
}

export type SummaryRow = Pick<
  JobRow,
  'tasks' | 'pr' | 'delivery' | 'wave' | 'createdAt' | 'autoStartedAt' | 'areas' | 'outcome' | 'pendingStart' | 'awaitingReview' | 'deliveryDismissed' | 'deliveredBy'
> & {
  // Another Task adds `finishedAt` to JobRow; read it when it is there
  finishedAt?: string
}

/** A plan that will not move any more by itself: its Tasks are done or failed for good. */
export const isFinishedOutcome = (outcome: JobRow['outcome']): boolean => outcome === 'completed' || outcome === 'failed'

const msOf = (iso: string | undefined): number | undefined => {
  if (iso === undefined) return undefined
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? undefined : ms
}

export function planSummaryOf(row: SummaryRow, nowMs: number): PlanSummary {
  const prog = planProgressOf(row.tasks)
  const c = prog.counts
  const all: Record<SummaryState, number> = {
    done: c.done,
    running: c.running + c['awaiting-review'],
    waiting: c.queued,
    failed: c.failed,
    cancelled: c.cancelled
  }
  const counts = SUMMARY_STATES.filter((s) => s !== 'cancelled' || all[s] > 0).map((state) => ({ state, n: all[state] }))

  const startMs = row.pendingStart ? undefined : (msOf(row.autoStartedAt) ?? msOf(row.createdAt))
  const endMs = msOf(row.finishedAt ?? undefined)
  const finished = isFinishedOutcome(row.outcome)
  const time: PlanSummary['time'] =
    startMs === undefined
      ? undefined
      : finished
        ? endMs !== undefined
          ? { kind: 'finished', ms: Math.max(0, endMs - startMs), finishedAt: row.finishedAt }
          : undefined
        : { kind: 'running', ms: Math.max(0, nowMs - startMs) }

  const pr = row.pr
  const link: SummaryLink | undefined = !pr
    ? undefined
    : pr.url
      ? { kind: 'pr', url: pr.url, ...(pr.number !== undefined ? { number: pr.number } : {}), draft: pr.draft === true }
      : pr.branch !== undefined || pr.note !== undefined
        ? { kind: 'branch', branch: pr.branch ?? pr.note! }
        : { kind: 'prFailed', ...(pr.error !== undefined ? { error: pr.error } : {}) }

  // a row that only carries the wait for another plan (state 'pending') says nothing about the delivery yet
  const d = row.delivery?.state === 'pending' ? undefined : row.delivery
  const delivery: SummaryDelivery | undefined = d
    ? { kind: d.state as Exclude<typeof d.state, 'pending'>, ...(d.reason !== undefined ? { reason: d.reason } : {}) }
    : row.deliveredBy
      ? { kind: 'deliveredBy', title: row.deliveredBy.title }
      : row.awaitingReview
        ? { kind: 'review' }
        : row.deliveryDismissed
          ? { kind: 'dismissed' }
          : undefined

  return {
    total: prog.total,
    percent: prog.percent,
    counts,
    ...(row.wave ? { wave: row.wave } : {}),
    ...(time ? { time } : {}),
    ...(link ? { link } : {}),
    ...(delivery ? { delivery } : {}),
    areas: row.areas ?? []
  }
}

/** A duration, short and coarse: "<1m", "42m", "3h 5m", "2d 4h". */
export function durationText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return '<1m'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return min % 60 === 0 ? `${h}h` : `${h}h ${min % 60}m`
  const d = Math.floor(h / 24)
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`
}
