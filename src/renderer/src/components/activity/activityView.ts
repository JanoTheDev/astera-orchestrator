// W3-A activity feed: the words and the list the panel draws. Pure, so the node-only test suite reaches it; the lines
// themselves are the Host's (core/orchestration/activity.ts).
import type { ActivityEvent, ActivityItem, ActivitySummary } from '../../../../core/orchestration/activity'
import type { TaskBlockedReason } from '../../../../core/types'

/** Lines the panel holds; older ones fall off (the Host keeps more, and `activity-summary` reads those). */
export const FEED_MAX = 300

export type Tone = 'ok' | 'bad' | 'warn' | 'info'

/** The held lines with a new page after them, each id once, the newest FEED_MAX. */
export function mergePage(held: readonly ActivityEvent[], page: readonly ActivityEvent[], max = FEED_MAX): ActivityEvent[] {
  const seen = new Set(held.map((e) => e.id))
  const out = [...held, ...page.filter((e) => !seen.has(e.id))]
  return out.length > max ? out.slice(out.length - max) : out
}

/** One plan's lines, or every line. */
export const feedOf = (events: readonly ActivityEvent[], jobId: string | null): ActivityEvent[] =>
  jobId === null ? [...events] : events.filter((e) => e.jobId === jobId)

const CATEGORY_WORD: Record<string, [string, Tone]> = {
  done: ['completed', 'ok'],
  failed: ['failed', 'bad'],
  cancelled: ['cancelled', 'warn'],
  'awaiting-review': ['awaiting review', 'warn'],
  running: ['running', 'info'],
  queued: ['queued', 'info']
}

/** What a line says and its colour. `accountLabel` turns an account id into the name the person gave it. */
export function lineOf(e: ActivityEvent, accountLabel: (id: string) => string): { text: string; tone: Tone } {
  const p = e.payload
  switch (e.type) {
    case 'task.status': {
      const [word, tone] = CATEGORY_WORD[p.category ?? ''] ?? [p.status ?? 'moved', 'info']
      // A bucket is the news; the status says more only where the bucket alone does not (validating is running)
      return { text: `${p.title}: ${word}${p.status === 'validating' ? ' (checks)' : ''}`, tone }
    }
    case 'dispatch.started':
      return { text: `${p.title}: ${p.review ? 'review' : 'worker'} started`, tone: 'info' }
    case 'dispatch.exited': {
      const how = p.closedBy === 'stop' || p.closedBy === 'abandon' ? `stopped by you` : p.outcome === 'failed' || p.workerState === 'failed' ? 'failed' : 'exited'
      return { text: `${p.title}: ${p.review ? 'review' : 'worker'} ${how}`, tone: how === 'failed' ? 'bad' : 'info' }
    }
    case 'dispatch.rolled':
      return {
        text: `${p.title}: hit a limit on ${accountLabel(p.accountId ?? '')}, ${p.rollReason === 'switching' ? 'moving to another account' : 'waiting for the reset'}`,
        tone: 'warn'
      }
    case 'dispatch.resumed':
      return { text: `${p.title}: resumed${p.toAccountId && p.toAccountId !== p.accountId ? ` on ${accountLabel(p.toAccountId)}` : ''}`, tone: 'info' }
    case 'gate.opened':
      return { text: `${p.title}: needs your answer: ${p.question ?? ''}`, tone: 'warn' }
    case 'gate.resolved':
      return { text: `${p.title}: answered${p.resolution ? `: ${p.resolution}` : ''}`, tone: 'info' }
    case 'task.links': {
      const l = p.links
      const parts = [l?.issue && `issue #${l.issue.number}`, l?.branch && `branch ${l.branch}`, l?.prs?.length && `PR #${l.prs.at(-1)!.number}`].filter(Boolean)
      return { text: `${p.title}: linked ${parts.join(', ') || 'nothing'}`, tone: 'info' }
    }
    case 'run.pr':
      return p.pr?.error
        ? { text: `${p.title}: PR failed: ${p.pr.error}`, tone: 'bad' }
        : { text: `${p.title}: PR ${p.pr?.number !== undefined ? `#${p.pr.number} ` : ''}opened`, tone: 'ok' }
    case 'plan.awaiting-approval':
      return { text: `${p.title}: plan ready for your approval`, tone: 'warn' }
    case 'task.waiting':
      return { text: `${p.title}: waiting for ${p.waitingFor === 'question' ? 'your answer to a question' : 'your permission'}`, tone: 'warn' }
    // W6-B
    case 'question.auto-answered':
      return { text: `${p.title}: coordinator answered "${p.question ?? ''}": ${p.answer ?? ''}`, tone: 'info' }
    case 'task.escalated':
      return { text: `${p.title}: needs your decision: ${p.reason ?? ''}`, tone: 'bad' }
    case 'plan.done':
      return p.runOutcome === 'failed' ? { text: `${p.title}: plan finished with failures`, tone: 'bad' } : { text: `${p.title}: plan done`, tone: 'ok' }
    // W6-D
    case 'plan.replanning':
      return { text: `${p.title}: ${p.replanMode === 'completion' ? 'final check against the objective' : `replanning before wave ${(p.wave ?? 0) + 1}`}`, tone: 'info' }
    case 'plan.replanned':
      return { text: `${p.title}: ${p.replanMode === 'completion' ? 'final check' : 'replanned'}: ${p.summary ?? ''}`, tone: 'info' }
  }
}

/** Who did it: the model and the account, as the line's second row. */
export const whoOf = (e: ActivityEvent, accountLabel: (id: string) => string): string =>
  [
    e.payload.plan !== e.payload.title ? e.payload.plan : undefined,
    e.payload.model,
    e.payload.accountId && accountLabel(e.payload.accountId),
    // W5-D (#44): a paired Runtime's line says where it ran
    e.runtimeId && `on ${e.runtimeId}`
  ]
    .filter(Boolean)
    .join(' · ')

/** The summary's buckets for one plan, or all of them. */
export function summaryOf(
  s: ActivitySummary,
  jobId: string | null
): Array<{ label: string; items: Array<ActivityItem & { reason?: TaskBlockedReason }>; tone: Tone }> {
  const only = <T extends ActivityItem>(xs: T[]): T[] => (jobId === null ? xs : xs.filter((x) => x.jobId === jobId))
  return [
    { label: 'completed', items: only(s.completed), tone: 'ok' as const },
    { label: 'failed', items: only(s.failed), tone: 'bad' as const },
    { label: 'cancelled', items: only(s.cancelled), tone: 'warn' as const },
    { label: 'awaiting review', items: only(s.awaitingReview), tone: 'warn' as const },
    { label: 'blocked', items: only(s.blocked), tone: 'info' as const }
  ].filter((b) => b.items.length > 0)
}
