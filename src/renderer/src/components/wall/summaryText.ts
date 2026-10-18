// W9-I: the words of a summary card (DESIGN §4), pure so they can be tested without a DOM. The card, the board row,
// the History row and the plan roll-up all read these.
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { SessionSummary, SummaryOutcome } from '../../../../core/sessions/summary'
import type { ChipTone } from '../ui/Chip'

type T = (key: MessageKey, params?: MessageParams) => string

export function outcomeTone(o: SummaryOutcome): ChipTone {
  return o === 'merged' ? 'ok' : o === 'gave-up' ? 'danger' : o === 'stopped' ? 'warn' : 'neutral'
}

/** `outcomeLabel` (core/sessions/summary.ts) in the app's language: "Merged · 2 rounds". */
export function outcomeText(s: Pick<SessionSummary, 'outcome' | 'facts'>, t: T): string {
  const rounds = s.facts.review.rounds
  if (s.outcome === 'merged') return rounds > 1 ? t('summary.outcome.mergedRounds', { n: rounds }) : t('summary.outcome.merged')
  return t(s.outcome === 'gave-up' ? 'summary.outcome.gaveUp' : s.outcome === 'stopped' ? 'summary.outcome.stopped' : 'summary.outcome.done')
}

/** "1h 5m", "12m", "40s"; nothing for 0 (the duration was not known). */
export function durationText(ms: number, t: T): string {
  const sec = Math.round(ms / 1000)
  if (sec <= 0) return ''
  if (sec < 60) return t('summary.duration.s', { s: sec })
  const min = Math.round(sec / 60)
  if (min < 60) return t('summary.duration.m', { m: min })
  return t('summary.duration.hm', { h: Math.floor(min / 60), m: min % 60 })
}

/** The facts as one line: "files: 3 +40 −12 · checks 2/2 · review rounds: 2, approved · questions: 1 (coordinator 1, owner 0) · commits: 2". */
export function summaryFactsLine(s: Pick<SessionSummary, 'facts'>, t: T): string {
  const f = s.facts
  const bits: string[] = []
  // added/removed may be absent: a Task's filesModified carries paths only
  if (f.files.length > 0) {
    const added = f.files.reduce((n, x) => n + (x.added ?? 0), 0)
    const removed = f.files.reduce((n, x) => n + (x.removed ?? 0), 0)
    bits.push(t('summary.facts.files', { n: f.files.length, added, removed }))
  }
  if (f.checks.length > 0)
    bits.push(t('summary.facts.checks', { passed: f.checks.filter((c) => c.status === 'passed').length, total: f.checks.length }))
  if (f.review.rounds > 0) {
    const verdict = f.review.verdict === 'approved' ? t('summary.verdict.approved') : f.review.verdict === 'changes-requested' ? t('summary.verdict.changes') : ''
    bits.push(t(verdict ? 'summary.facts.reviewVerdict' : 'summary.facts.review', { n: f.review.rounds, verdict }))
  }
  const asked = f.questions.coordinator + f.questions.owner
  if (asked > 0) bits.push(t('summary.facts.questions', { n: asked, coordinator: f.questions.coordinator, owner: f.questions.owner }))
  if (f.commits.length > 0) bits.push(t('summary.facts.commits', { n: f.commits.length }))
  return bits.join(' · ')
}

/** The one line a board card or History row shows: the prose's first sentence, else the facts. */
export function summaryOneLine(s: Pick<SessionSummary, 'facts' | 'text'>, t: T): string {
  const first = /^.*?[.!?。](?=\s|$)/s.exec(s.text.trim())?.[0] ?? s.text.trim()
  return first.replace(/\s+/g, ' ') || summaryFactsLine(s, t)
}

/** The cards by Task (newest wins: the list comes newest first) and by session. */
export function indexSummaries(list: readonly SessionSummary[]): { byTask: Map<string, SessionSummary>; bySession: Map<string, SessionSummary> } {
  const byTask = new Map<string, SessionSummary>()
  const bySession = new Map<string, SessionSummary>()
  for (const s of list) {
    if (s.taskId !== undefined && !byTask.has(s.taskId)) byTask.set(s.taskId, s)
    if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, s)
    // History rows carry the CLI's own session id
    if (s.agentSessionId !== undefined && !bySession.has(s.agentSessionId)) bySession.set(s.agentSessionId, s)
  }
  return { byTask, bySession }
}
