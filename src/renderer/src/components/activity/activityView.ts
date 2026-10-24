// W3-A activity feed: the words and the list the panel draws. Pure, so the node-only test suite reaches it; the lines
// themselves are the Host's (core/orchestration/activity.ts).
import type { ActivityEvent, ActivityItem, ActivitySummary } from '../../../../core/orchestration/activity'
import { resetClock } from '../../../../core/orchestration/activity'
import type { TaskBlockedReason } from '../../../../core/types'
import { t, type Lang, type MessageKey } from '../../../../core/i18n'

/** Lines the panel holds; older ones fall off (the Host keeps more, and `activity-summary` reads those). */
export const FEED_MAX = 300

export type Tone = 'ok' | 'bad' | 'warn' | 'info'

/** The held lines with a new page after them, each id once, the newest FEED_MAX. */
export function mergePage(held: readonly ActivityEvent[], page: readonly ActivityEvent[], max = FEED_MAX): ActivityEvent[] {
  const seen = new Set(held.map((e) => e.id))
  const out = [...held, ...page.filter((e) => !seen.has(e.id))]
  return out.length > max ? out.slice(out.length - max) : out
}

/** One plan's lines, or every line. W6-G: an account's usage pause holds every plan's new workers, so it is in each. */
export const feedOf = (events: readonly ActivityEvent[], jobId: string | null): ActivityEvent[] =>
  jobId === null ? [...events] : events.filter((e) => e.jobId === jobId || e.type === 'usage.paused' || e.type === 'usage.resumed' || e.type === 'account.switched')

const CATEGORY_WORD: Record<string, [MessageKey, Tone]> = {
  done: ['activity.cat.done', 'ok'],
  failed: ['activity.cat.failed', 'bad'],
  cancelled: ['activity.cat.cancelled', 'warn'],
  'awaiting-review': ['activity.cat.review', 'warn'],
  running: ['activity.cat.running', 'info'],
  queued: ['activity.cat.queued', 'info']
}

/** What a line says and its colour. `accountLabel` turns an account id into the name the person gave it. `lang`: the
 *  app's language; every word of a line is in the catalogs (inbox area, `activity.*`). */
export function lineOf(e: ActivityEvent, accountLabel: (id: string) => string, lang: Lang = 'en'): { text: string; tone: Tone } {
  const p = e.payload
  const m = (key: MessageKey, params?: Record<string, string | number>): string => t(lang, key, { title: p.title, ...params })
  switch (e.type) {
    case 'task.status': {
      const [key, tone] = CATEGORY_WORD[p.category ?? ''] ?? [undefined, 'info' as Tone]
      // A bucket is the news; the status says more only where the bucket alone does not (validating is running)
      const word = key ? m(key) : (p.status ?? m('activity.cat.moved'))
      const note = p.status === 'validating' ? m('activity.note.checks') : p.status === 'merging' ? m('activity.note.merging') : ''
      return { text: m('activity.line.status', { word, note }), tone }
    }
    case 'dispatch.started':
      return { text: m('activity.line.started', { what: m(p.review ? 'activity.what.review' : 'activity.what.agent') }), tone: 'info' }
    case 'dispatch.exited': {
      const how = p.closedBy === 'stop' || p.closedBy === 'abandon' ? 'stopped' : p.outcome === 'failed' || p.workerState === 'failed' ? 'failed' : 'exited'
      const what = m(p.review ? 'activity.what.review' : 'activity.what.agent')
      return { text: m('activity.line.exited', { what, how: m(`activity.how.${how}` as MessageKey) }), tone: how === 'failed' ? 'bad' : 'info' }
    }
    case 'dispatch.rolled':
      return {
        text: m('activity.line.rolled', { account: accountLabel(p.accountId ?? ''), then: m(p.rollReason === 'switching' ? 'activity.then.switching' : 'activity.then.waiting') }),
        tone: 'warn'
      }
    case 'dispatch.resumed':
      return p.toAccountId && p.toAccountId !== p.accountId
        ? { text: m('activity.line.resumedOn', { account: accountLabel(p.toAccountId) }), tone: 'info' }
        : { text: m('activity.line.resumed'), tone: 'info' }
    case 'gate.opened':
      return { text: m('activity.line.gateOpened', { question: p.question ?? '' }), tone: 'warn' }
    case 'gate.resolved':
      return { text: p.resolution ? m('activity.line.gateResolvedWith', { resolution: p.resolution }) : m('activity.line.gateResolved'), tone: 'info' }
    case 'task.links': {
      const l = p.links
      const parts = [
        l?.issue && m('activity.links.issue', { n: l.issue.number }),
        l?.branch && m('activity.links.branch', { name: l.branch }),
        l?.prs?.length && m('activity.links.pr', { n: l.prs.at(-1)!.number })
      ].filter(Boolean)
      return { text: m('activity.line.linked', { parts: parts.join(', ') || m('activity.links.nothing') }), tone: 'info' }
    }
    case 'run.pr':
      return p.pr?.error
        ? { text: m('activity.line.prFailed', { error: p.pr.error }), tone: 'bad' }
        : p.pr?.note // W7-E (#80): no remote, no failure
          ? { text: m('activity.line.titled', { reason: p.pr.note }), tone: 'info' }
          : { text: p.pr?.number !== undefined ? m('activity.line.prOpenedNum', { n: p.pr.number }) : m('activity.line.prOpened'), tone: 'ok' }
    case 'plan.awaiting-approval':
      // W7-A: round > 0 is a plan the planner revised after the owner's feedback
      return p.round !== undefined && p.round > 0
        ? { text: p.changes?.length ? m('activity.line.planRevisedChanges', { changes: p.changes.join('; ') }) : m('activity.line.planRevised'), tone: 'warn' }
        : { text: m('activity.line.planAwaiting'), tone: 'warn' }
    // W8-F (#94)
    case 'plan.incomplete':
      return { text: m('activity.line.planIncomplete', { problems: (p.problems ?? []).join('; ') }), tone: 'bad' }
    // W7-A
    case 'plan.auto-started':
      return { text: m('activity.line.planAutoStarted', { n: p.tasks ?? 0 }), tone: 'info' }
    // W6-A
    case 'plan.nothing-to-do':
      return { text: p.summary ? m('activity.line.planNothingWith', { summary: p.summary.split('\n')[0] }) : m('activity.line.planNothing'), tone: 'ok' }
    // #111
    case 'plan.chat-approved':
      return { text: m('activity.line.planChatApproved', { reason: p.reason ?? '' }), tone: 'ok' }
    case 'plan.rejected':
      return { text: p.reason ? m('activity.line.planRejectedWith', { reason: p.reason }) : m('activity.line.planRejected'), tone: 'bad' }
    case 'task.waiting':
      return { text: m(p.waitingFor === 'question' ? 'activity.line.waitingQuestion' : 'activity.line.waitingPermission'), tone: 'warn' }
    // W6-B; T21's own answers (exec/autoAnswer.ts) carry their line in `reason`
    case 'question.auto-answered':
      if (p.reason !== undefined) return { text: m('activity.line.titled', { reason: p.reason }), tone: 'info' }
      return { text: m(p.answeredBy === 'owner' ? 'activity.line.answeredByYou' : 'activity.line.answeredByLead', { question: p.question ?? '', answer: p.answer ?? '' }), tone: 'info' }
    case 'task.escalated':
      return { text: m('activity.line.escalated', { reason: p.reason ?? '' }), tone: 'bad' }
    // W6-G
    case 'usage.paused': {
      const weekly = p.usageWindow === 'seven_day'
      const resumes = p.resetsAt ? m('activity.line.usageResumes', { when: resetClock(p.resetsAt, weekly) }) : ''
      return {
        text: m('activity.line.usagePaused', { title: accountLabel(p.title), percent: p.percent ?? 0, window: m(weekly ? 'activity.window.week' : 'activity.window.fiveHour'), resumes }),
        tone: 'warn'
      }
    }
    case 'usage.resumed':
      return { text: m('activity.line.usageResumed', { title: accountLabel(p.title) }), tone: 'info' }
    // T5b
    case 'account.switched':
      return { text: m('activity.line.accountSwitched', { title: accountLabel(p.title), from: accountLabel(p.fromAccountId ?? ''), reason: p.reason ?? '' }), tone: 'info' }
    case 'plan.done':
      if (p.runOutcome === 'failed') return { text: m('activity.line.planFailed'), tone: 'bad' }
      if (p.runOutcome === 'blocked') return { text: m('activity.line.planBlocked', { n: p.blockedTasks?.length ?? 0, tasks: (p.blockedTasks ?? []).join('; ') }), tone: 'warn' }
      return { text: m('activity.line.planDone'), tone: 'ok' }
    // W6-D
    case 'plan.replanning':
      return { text: p.replanMode === 'completion' ? m('activity.line.replanFinal') : m('activity.line.replanStep', { n: (p.wave ?? 0) + 1 }), tone: 'info' }
    case 'plan.replanned':
      return { text: m(p.replanMode === 'completion' ? 'activity.line.replannedFinal' : 'activity.line.replanned', { summary: p.summary ?? '' }), tone: 'info' }
    // W6-H
    case 'plan.delivered':
      return { text: m('activity.line.delivered', { branch: p.branch ?? m('activity.line.itsBranch'), sha: (p.sha ?? '').slice(0, 7) }), tone: 'ok' }
    // W8-D
    case 'plan.overlap':
      return { text: m('activity.line.overlap', { list: (p.overlaps ?? []).join('; ') }), tone: 'warn' }
    // Coordinator rotation
    case 'coordinator.refreshed':
      return { text: m('activity.line.leadRefreshed', { reason: p.reason ?? m('activity.line.onRequest') }), tone: 'info' }
    // Stall watchdog
    case 'watchdog': {
      // T32: a delivery that fell back is no stuck plan: say how it landed and why, in the owner's words
      const fell = p.deliveryFallback
      if (fell) {
        const why = t(lang, `delivery.off.${fell.reason}`)
        return fell.mode === 'merge'
          ? { text: m('activity.line.fellToMerge', { branch: fell.branch ?? m('activity.line.itsBranch'), why }), tone: 'info' }
          : { text: m('activity.line.fellToReview', { why }), tone: 'info' }
      }
      return { text: m('activity.line.watchdog', { reason: p.reason ?? '' }), tone: 'warn' }
    }
    case 'plan.deliveryDismissed':
      return { text: t(lang, 'activity.deliveryDismissed', { title: p.title }), tone: 'warn' }
    // T23 (exec/crashResume.ts)
    case 'host.recovered':
      return { text: p.reason ?? '', tone: 'info' }
    // #117: "Decided for you: …" / "Refused: …" (activity.ts decisionLine)
    case 'plan.decided':
      return { text: m('activity.line.titled', { reason: p.reason ?? '' }), tone: 'info' }
    case 'plan.refused':
      return { text: m('activity.line.titled', { reason: p.reason ?? '' }), tone: 'warn' }
    // T7: the field names are the flags' (--deps, --spec, --basis, --evidence), so they stay as they are
    case 'task.edited':
      return { text: t(lang, 'activity.taskEdited', { title: p.title, fields: (p.edited ?? []).join(', ') }), tone: 'info' }
  }
}

/** Who did it: the model and the account, as the line's second row. */
export const whoOf = (e: ActivityEvent, accountLabel: (id: string) => string, lang: Lang = 'en'): string =>
  [
    e.payload.plan !== e.payload.title ? e.payload.plan : undefined,
    e.payload.model,
    e.payload.accountId && accountLabel(e.payload.accountId),
    // W5-D (#44): a paired Runtime's line says where it ran
    e.runtimeId && t(lang, 'activity.line.onRuntime', { runtime: e.runtimeId })
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

/** The lines whose text, plan, Task or actor contain `query` (case-insensitive); a blank query keeps all. */
export function filterLines<L extends { text: string; plan?: string; task?: string; who?: string }>(lines: readonly L[], query: string): L[] {
  const q = query.trim().toLowerCase()
  return q === '' ? [...lines] : lines.filter((l) => [l.text, l.plan, l.task, l.who].some((f) => f?.toLowerCase().includes(q)))
}
