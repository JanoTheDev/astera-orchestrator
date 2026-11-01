// T26: a Task's reviews as the detail draws them, and the live "Reviewing" badge. Pure, so the node-only test suite reaches it.
import type { MessageKey } from '../../../../core/i18n'
import { formatElapsed } from '../../../../core/orchestration/elapsed'
import type { ReviewVerdict } from '../../../../core/orchestration/types'

/** One review as `tasks-get` lists it (core/orchestration/taskDetail.ts TaskReview, which the web build does not take in). */
export interface TaskReview {
  id: string
  provider: string
  accountId: string
  model?: string
  effort?: string
  startedAt: string
  endedAt?: string
  verdict?: ReviewVerdict
  issues: { title: string; severity: string; blocking: boolean }[]
  transcript: boolean
}

/** Issues shown before "show all". */
export const ISSUES_SHOWN = 3

export interface ReviewRow {
  id: string
  /** The model it ran with, else its provider. */
  model: string
  startedAt: string
  endedAt?: string
  running: boolean
  /** m:ss from its start to its end, or to `now` while it runs. */
  elapsed: string
  /** Its verdict; `running` while it runs; `stopped` when it ended with none (stopped, lost). */
  state: ReviewVerdict | 'running' | 'stopped'
  label: MessageKey
  issues: TaskReview['issues']
  /** Issues beyond ISSUES_SHOWN, which the row folds. */
  folded: number
  transcript: boolean
}

const LABEL = {
  passed: 'plan.review.verdict.passed',
  rejected: 'plan.review.verdict.rejected',
  'needs-decision': 'plan.review.verdict.needs-decision',
  failed: 'plan.review.verdict.failed',
  running: 'plan.review.running',
  stopped: 'plan.review.stopped'
} as const satisfies Record<ReviewRow['state'], MessageKey>

/** The rows of a Task's reviews, newest first. */
export function reviewRowsOf(reviews: readonly TaskReview[], nowMs: number): ReviewRow[] {
  return [...reviews]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((r): ReviewRow => {
      const running = r.endedAt === undefined
      const state = r.verdict ?? (running ? 'running' : 'stopped')
      return {
        id: r.id,
        model: r.model ?? r.provider,
        startedAt: r.startedAt,
        ...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
        running,
        elapsed: running ? formatElapsed(r.startedAt, nowMs) : formatElapsed(r.startedAt, Date.parse(r.endedAt as string)),
        state,
        label: LABEL[state],
        issues: r.issues,
        folded: Math.max(0, r.issues.length - ISSUES_SHOWN),
        transcript: r.transcript
      }
    })
}

/** The live badge's elapsed text for a review that started at `startedAt`: 125 s in reads `2:05`. */
export const reviewingElapsed = (startedAt: string, nowMs: number): string => formatElapsed(startedAt, nowMs)

/** Whether a board card shows the Reviewing badge: it is reviewing, a reviewer is running, and its start is known. */
export const isReviewing = (t: { status: string; startedAt?: string; reviewerEnded?: true }): boolean =>
  t.status === 'reviewing' && t.startedAt !== undefined && t.reviewerEnded !== true
