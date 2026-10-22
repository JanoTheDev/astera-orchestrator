// W9-D: what the Inbox page lists (DESIGN.md §2 "Inbox"). Pure, so the node-only suite reaches it.
// "Needs you" is every open question (ask, escalation, Gate), plan approval and permission wait, oldest first;
// "Handled for you" is the W3-A feed. The data is the Host's: `questions-list`, Job.overlaps, sessionIndex.needsInput.
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { InboxItem } from '../../../../core/orchestration/sessionIndex'
import type { Job, PlanOverlap } from '../../../../core/orchestration/types'
import { feedOf, lineOf, whoOf, type Tone } from '../activity/activityView'
import type { OpenQuestion } from '../plan/planBoard'
import type { Lang, Message, MessageKey } from '../../../../core/i18n'
import type { Translate } from '../checkText'

/** An open row of `questions-list`: an ask or escalation (`source`), or a Gate (none). */
export type QuestionRow = Omit<OpenQuestion, 'source'> & { source?: OpenQuestion['source']; runId: string; createdAt: string }

export type NeedKind = 'approval' | 'question' | 'escalation' | 'gate' | 'permission' | 'waiting'

/** What `openInbox(filter)` can ask for. `plan:<jobId>` keeps one plan's cards. */
export type InboxGroup = 'all' | 'approvals' | 'questions' | 'permissions' | 'handled'
export interface InboxFilter {
  group: InboxGroup
  planId?: string
}

const GROUP_KINDS: Record<Exclude<InboxGroup, 'all' | 'handled'>, readonly NeedKind[]> = {
  approvals: ['approval'],
  questions: ['question', 'escalation', 'gate'],
  permissions: ['permission', 'waiting']
}

/** The filter a navigation string names; anything unknown shows everything. */
export function parseFilter(raw: string | undefined): InboxFilter {
  if (raw === undefined) return { group: 'all' }
  if (raw.startsWith('plan:') && raw.length > 5) return { group: 'all', planId: raw.slice(5) }
  return raw === 'approvals' || raw === 'questions' || raw === 'permissions' || raw === 'handled' ? { group: raw } : { group: 'all' }
}

/** The chip a card leads with: its kind as a word, and the word's tone. */
export const NEED_WORD: Record<NeedKind, [MessageKey, 'info' | 'warn' | 'danger']> = {
  approval: ['inbox.kind.approval', 'info'],
  question: ['inbox.kind.question', 'warn'],
  gate: ['inbox.kind.question', 'warn'],
  escalation: ['inbox.kind.decision', 'danger'],
  permission: ['inbox.kind.permission', 'warn'],
  waiting: ['inbox.kind.waiting', 'warn']
}

/** One thing Astera cannot go on without. */
export interface NeedCard {
  key: string
  kind: NeedKind
  /** When it began to wait, ISO; null when nothing says (such a card sorts last). */
  at: string | null
  jobId: string
  projectName: string
  planName: string
  taskId?: string
  taskTitle?: string
  sessionId?: string
  /** question / escalation / gate: the answer box's row. */
  q?: QuestionRow
  /** approval: where this plan meets another (W8-D). */
  overlaps?: OverlapView[]
  /** approval: the plan this one is already queued after (`Job.after`), so Approve reads "(X waits)". */
  waitsOn?: string
}

/** One Task of this plan meeting one Task of another plan. */
export interface OverlapView {
  taskId: string
  taskTitle: string
  otherJobId: string
  otherPlanName: string
  otherTaskTitle: string
  /** "L4 and Auth rework's T6 both edit src/api/routes.ts" */
  line: Message
}

export interface PlanName {
  projectName: string
  planName: string
}

export interface InboxInput {
  /** needsInput(): its `session` rows (permission or question waits) and `approval` rows are read; Gates and
   *  escalations arrive through `questions`, which also carries asks. */
  items: readonly InboxItem[]
  questions: readonly QuestionRow[]
  jobs: readonly Job[]
  /** Plan and project names by Job id. */
  plans: ReadonlyMap<string, PlanName>
  /** Job id by Run id, and Task title by Task id. */
  jobOfRun: ReadonlyMap<string, string>
  taskTitles: ReadonlyMap<string, string>
  /** The Task a session works on, by session id: tells which waits an open question already covers. */
  taskOfSession?: ReadonlyMap<string, string>
  events: readonly ActivityEvent[]
}

/** When each plan's approval and each session's wait began: the newest such line of the feed. */
export function sinceOf(events: readonly ActivityEvent[]): { approvals: Map<string, string>; waits: Map<string, string> } {
  const approvals = new Map<string, string>()
  const waits = new Map<string, string>()
  for (const e of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (e.type === 'plan.awaiting-approval' && e.jobId) approvals.set(e.jobId, e.occurredAt)
    if (e.type === 'task.waiting' && e.sessionId) waits.set(e.sessionId, e.occurredAt)
  }
  return { approvals, waits }
}

const overlapLine = (o: PlanOverlap, mine: string, plan: string, theirs: string): Message =>
  o.by === 'issue'
    ? { key: 'inbox.overlap.issue', params: { mine, plan, theirs, issue: String(o.issue) } }
    : { key: 'inbox.overlap.edit', params: { mine, plan, theirs, path: String(o.path) } }

function overlapsOf(job: Job, input: InboxInput): OverlapView[] {
  return (job.overlaps ?? []).map((o) => {
    const taskTitle = input.taskTitles.get(o.taskId) ?? o.taskId
    const otherTaskTitle = input.taskTitles.get(o.otherTaskId) ?? o.otherTaskId
    const otherPlanName = input.plans.get(o.jobId)?.planName ?? o.jobId
    return { taskId: o.taskId, taskTitle, otherJobId: o.jobId, otherPlanName, otherTaskTitle, line: overlapLine(o, taskTitle, otherPlanName, otherTaskTitle) }
  })
}

/** Oldest first; a card with no time sorts last, and equal times keep the order they came in. */
export function orderNeeds(cards: readonly NeedCard[]): NeedCard[] {
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.at === b.c.at ? 0 : a.c.at === null ? 1 : b.c.at === null ? -1 : a.c.at.localeCompare(b.c.at)) || a.i - b.i)
    .map((x) => x.c)
}

/** Every card that needs the person, oldest first. */
export function needsOf(input: InboxInput): NeedCard[] {
  const { approvals, waits } = sinceOf(input.events)
  const cards: NeedCard[] = []

  for (const q of input.questions) {
    const jobId = input.jobOfRun.get(q.runId)
    const at = jobId === undefined ? undefined : input.plans.get(jobId)
    if (jobId === undefined || at === undefined) continue
    const taskTitle = input.taskTitles.get(q.taskId)
    cards.push({
      key: `q:${q.id}`,
      kind: q.source === 'escalation' ? 'escalation' : q.source === 'ask' ? 'question' : 'gate',
      at: q.createdAt,
      jobId,
      ...at,
      taskId: q.taskId,
      ...(taskTitle !== undefined ? { taskTitle } : {}),
      q
    })
  }
  // An escalation also answers the worker's ask (state.ts answerEscalation): one card per Task, the escalation's
  const escalated = new Set(cards.filter((c) => c.kind === 'escalation').map((c) => c.taskId))
  const shown = cards.filter((c) => c.kind !== 'question' || !escalated.has(c.taskId))
  const asking = new Set(shown.map((c) => c.taskId))

  const jobById = new Map(input.jobs.map((j) => [j.id, j]))
  for (const item of input.items) {
    if (item.kind === 'approval') {
      const job = jobById.get(item.jobId)
      const after = job?.after === undefined ? undefined : input.plans.get(job.after)?.planName
      shown.push({
        key: `a:${item.jobId}`,
        kind: 'approval',
        at: approvals.get(item.jobId) ?? job?.createdAt ?? null,
        jobId: item.jobId,
        projectName: item.projectName,
        planName: item.planName,
        ...(item.sessionId !== undefined ? { sessionId: item.sessionId } : {}),
        ...(job ? { overlaps: overlapsOf(job, input) } : {}),
        ...(after !== undefined ? { waitsOn: after } : {})
      })
    } else if (item.kind === 'session') {
      const s = item.session
      // A question wait is the open ask's card already
      if (s.waitingFor === 'question' && s.taskId !== undefined && asking.has(s.taskId)) continue
      shown.push({
        key: `s:${s.sessionId}`,
        kind: s.waitingFor === 'permission' ? 'permission' : 'waiting',
        at: waits.get(s.sessionId) ?? null,
        jobId: s.jobId,
        projectName: s.projectName,
        planName: s.planName,
        sessionId: s.sessionId,
        ...(s.taskId !== undefined ? { taskId: s.taskId } : {}),
        ...(s.taskTitle !== undefined ? { taskTitle: s.taskTitle } : {})
      })
    }
  }
  return orderNeeds(shown)
}

/** The cards a filter keeps. `handled` keeps none: it asks for the feed alone. */
export function filterNeeds(cards: readonly NeedCard[], f: InboxFilter): NeedCard[] {
  const kinds = f.group === 'all' ? null : f.group === 'handled' ? [] : GROUP_KINDS[f.group]
  return cards.filter((c) => (kinds === null || kinds.includes(c.kind)) && (f.planId === undefined || c.jobId === f.planId))
}

export interface HandledLine {
  id: string
  at: string
  text: string
  who: string
  tone: Tone
  /** The plan the line belongs to; the Task's title when the line is about a Task (W11 Inbox). */
  plan?: string
  task?: string
  sessionId?: string
  jobId?: string
}

/** The feed as "Handled for you": newest first, at most `max`. A plan filter keeps that plan's lines. */
export function handledOf(events: readonly ActivityEvent[], f: InboxFilter, accountLabel: (id: string) => string, max = 100, lang: Lang = 'en'): HandledLine[] {
  return feedOf(events, f.planId ?? null)
    .reverse()
    .slice(0, max)
    .map((e) => {
      const { text, tone } = lineOf(e, accountLabel, lang)
      return {
        id: e.id,
        at: e.occurredAt,
        text,
        who: whoOf(e, accountLabel, lang),
        tone,
        ...(e.payload.plan !== undefined ? { plan: e.payload.plan } : {}),
        ...(e.taskId !== undefined && e.payload.title !== e.payload.plan ? { task: e.payload.title } : {}),
        ...(e.sessionId !== undefined && e.jobId !== undefined ? { sessionId: e.sessionId, jobId: e.jobId } : {})
      }
    })
}

/** W11: the handled lines by local day, newest day first, each labelled today / yesterday / the date. */
export function byDay<L extends { at: string }>(lines: readonly L[], nowMs: number, t: Translate, locale?: string): Array<{ day: string; label: string; lines: L[] }> {
  const dayOf = (ms: number): string => new Date(ms).toDateString()
  const today = dayOf(nowMs)
  const yesterday = dayOf(nowMs - 86_400_000)
  const out: Array<{ day: string; label: string; lines: L[] }> = []
  for (const l of lines) {
    const ms = Date.parse(l.at)
    const day = dayOf(ms)
    let g = out.find((x) => x.day === day)
    if (!g) {
      const label = day === today ? t('inbox.day.today') : day === yesterday ? t('inbox.day.yesterday') : new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
      g = { day, label, lines: [] }
      out.push(g)
    }
    g.lines.push(l)
  }
  return out
}

/** The Inbox's own count: what the nav badge and the status bar show. */
export const needCount = (cards: readonly NeedCard[]): number => cards.length

/** "just now", "12 min", "3 h", "2 d": how long a card has waited. */
export function ageOf(at: string | null, nowMs: number, t: Translate): string {
  if (at === null) return ''
  const min = Math.max(0, Math.floor((nowMs - Date.parse(at)) / 60_000))
  return min < 1 ? t('inbox.age.now') : min < 60 ? t('inbox.age.min', { n: min }) : min < 48 * 60 ? t('inbox.age.h', { n: Math.floor(min / 60) }) : t('inbox.age.d', { n: Math.floor(min / 1440) })
}

/** "project › plan · task", the place line every card and search result shows. */
export const whereOf = (project: string, plan: string, task?: string): string => `${project} › ${plan}${task ? ` · ${task}` : ''}`
