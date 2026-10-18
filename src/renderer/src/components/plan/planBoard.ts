// W2-C plan board: the counts and words the overview and the board draw. Pure, so the node-only test suite reaches it;
// the reasons themselves are core's (core/orchestration/blocked.ts), folded into the snapshot.
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { JobTask, TaskBlockedReason, TaskCategory } from '../../../../core/types'
import { formatRemaining } from '../../../../core/orchestration/elapsed'

/** The overview's buckets, in the order it lists them. */
export const CATEGORIES: readonly TaskCategory[] = ['done', 'running', 'awaiting-review', 'queued', 'failed', 'cancelled']

/** A Task's bucket: the snapshot's, else one read off the status alone (a snapshot from an older Runtime has no board).
 *  The fallback cannot tell a stopped worker from a lost one, so it never says cancelled. */
export function categoryOf(task: JobTask): TaskCategory {
  if (task.board) return task.board.category
  switch (task.status) {
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'reviewing':
      return 'awaiting-review'
    case 'validating':
      return 'running'
    case 'dispatched':
      return task.startedAt !== undefined ? 'running' : 'queued'
    default:
      return 'queued'
  }
}

export interface PlanProgress {
  total: number
  /** Done over total, rounded down: 99% until the last one is done. 0 for a plan with no Tasks. */
  percent: number
  counts: Record<TaskCategory, number>
}

export function planProgressOf(tasks: readonly JobTask[]): PlanProgress {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<TaskCategory, number>
  for (const task of tasks) counts[categoryOf(task)]++
  const total = tasks.length
  return { total, percent: total === 0 ? 0 : Math.floor((counts.done * 100) / total), counts }
}

/** A reason as a catalog key and its params. `accountLabel` turns an account id into the name the person gave it. */
export function reasonText(
  reason: TaskBlockedReason,
  nowMs: number,
  accountLabel: (id: string) => string
): { key: MessageKey; params?: MessageParams } {
  switch (reason.kind) {
    case 'rate-limited': {
      const account = accountLabel(reason.accountId)
      if (reason.switching) return { key: 'plan.reason.switching', params: { account } }
      // A reset already past reads as no time at all (formatRemaining, as the Jobs sidebar does)
      const left = reason.resetsAt !== undefined ? formatRemaining(reason.resetsAt, nowMs) : undefined
      return left !== undefined
        ? { key: 'plan.reason.rateLimited', params: { account, left } }
        : { key: 'plan.reason.rateLimitedNoTime', params: { account } }
    }
    case 'archived':
      return { key: 'plan.reason.archived' }
    case 'pending-start':
      return { key: 'plan.reason.pendingStart' }
    case 'paused':
      return { key: 'plan.reason.paused' }
    case 'definition':
      return { key: 'plan.reason.definition' }
    case 'gate':
      return { key: 'plan.reason.gate', params: { question: reason.question } }
    case 'failure-limit':
      return { key: 'plan.reason.failureLimit', params: { failures: reason.failures } }
    case 'failed-retry':
      return {
        key: reason.noCoordinator ? 'plan.reason.failedRetryByYou' : 'plan.reason.failedRetry',
        params: { failures: reason.failures, limit: reason.limit }
      }
    case 'awaiting-review':
      return { key: 'plan.reason.awaitingReview' }
    case 'stopped':
      return { key: 'plan.reason.stopped' }
    case 'deps':
      return { key: 'plan.reason.deps', params: { tasks: reason.waitingOn.map((d) => d.title).join(', ') } }
    case 'no-account':
      return { key: 'plan.reason.noAccount' }
    case 'coordinator':
      return { key: 'plan.reason.coordinator' }
    case 'plan-cap':
      return { key: 'plan.reason.planCap', params: { used: reason.used, limit: reason.limit } }
    case 'global-cap':
      return { key: 'plan.reason.globalCap', params: { used: reason.used, limit: reason.limit, priority: reason.priority } }
    // W6-C
    case 'same-files':
      return { key: 'plan.reason.sameFiles', params: { task: reason.waitingOn.title, path: reason.path } }
    case 'next':
      return { key: 'plan.reason.next' }
  }
}

/** The badge tone: something only a person can clear, a fault, or plain waiting. */
export function reasonTone(reason: TaskBlockedReason): 'action' | 'fault' | 'wait' {
  switch (reason.kind) {
    case 'gate':
    case 'no-account':
    case 'pending-start':
    case 'paused':
    case 'archived':
    case 'stopped':
      return 'action'
    case 'failure-limit':
    case 'failed-retry':
    case 'rate-limited':
      return 'fault'
    default:
      return 'wait'
  }
}
