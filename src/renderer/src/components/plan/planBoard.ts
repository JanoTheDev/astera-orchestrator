// W2-C plan board: the counts and words the overview and the board draw. Pure, so the node-only test suite reaches it;
// the reasons themselves are core's (core/orchestration/blocked.ts), folded into the snapshot.
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { JobEvent, JobTask, SessionInfo, TaskBlockedReason, TaskCategory } from '../../../../core/types'
import { formatElapsed, formatRemaining } from '../../../../core/orchestration/elapsed'
import { pickTaskProvider, resolveWorkerModel, type RoleModelSettings } from '../../../../core/orchestration/roleModels'
import type { Account } from '../../../../core/types'
import { resetClock } from '../../../../core/orchestration/activity'

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
      // W8-C plan after plan
      if (reason.after) return { key: reason.after.stopped ? 'plan.reason.afterStopped' : 'plan.reason.queuedAfter', params: { plan: reason.after.title } }
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
    // W6-G: "Paused: Max at 93% of its 5-hour limit, resumes ~14:20"
    case 'usage-paused': {
      const account = accountLabel(reason.accountId)
      const weekly = reason.window === 'seven_day'
      if (reason.resetsAt === null) return { key: 'plan.reason.usagePausedNoTime', params: { account, percent: reason.percent } }
      return {
        key: weekly ? 'plan.reason.usagePaused7d' : 'plan.reason.usagePaused5h',
        params: { account, percent: reason.percent, time: resetClock(reason.resetsAt, weekly) }
      }
    }
  }
}

/** The badge tone: something only a person can clear, a fault, or plain waiting. */
export function reasonTone(reason: TaskBlockedReason): 'action' | 'fault' | 'wait' {
  // W8-C plan after plan: queued after a plan still on its way starts by itself
  if (reason.kind === 'pending-start' && reason.after && !reason.after.stopped) return 'wait'
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

// ── W6-E progress view ───────────────────────────────────────────────────────────────────────────────────────────────

/** One wave of the plan: the Tasks at one dependency depth (Wave 6 contract: 0 with no deps, else 1 + the deepest dep). */
export interface PlanWave {
  index: number
  tasks: JobTask[]
  done: number
}

/** The plan's waves, from the depth layers core already computes for the graph (RunDetail `layers`, graph.ts
 *  `layersOf`): the same depth as the contract's `waveOf`, so no second copy of the rule lives here. A Task the layers
 *  do not place (a dependency cycle, or a detail that has not caught up with the snapshot) goes in one wave after them. */
export function wavesOf(tasks: readonly JobTask[], layers: readonly string[][]): PlanWave[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const placed = new Set<string>()
  const groups = layers.map((ids) =>
    ids.flatMap((id) => {
      const t = byId.get(id)
      if (!t) return []
      placed.add(id)
      return [t]
    })
  )
  groups.push(tasks.filter((t) => !placed.has(t.id)))
  return groups
    .filter((g) => g.length > 0)
    .map((g, index) => ({ index, tasks: g, done: g.filter((t) => categoryOf(t) === 'done').length }))
}

/** The wave being worked on: the first one not all done. -1 when every wave is done. */
export const currentWaveOf = (waves: readonly PlanWave[]): number => waves.find((w) => w.done < w.tasks.length)?.index ?? -1

/** Whether this plan's planner is adjusting the rest of the plan right now (W6-D's `plan.replanning`, not yet followed
 *  by its `plan.replanned`). `planId` is matched against a line's run and its Job, as a plan's own Run shares its id. */
export function replanningOf(events: readonly ActivityEvent[], planId: string): boolean {
  let on = false
  for (const e of events) {
    if (e.runId !== planId && e.jobId !== planId) continue
    // W6-D's kinds; compared as text until its ActivityKind union lands on main
    const kind = e.type as string
    if (kind === 'plan.replanning') on = true
    else if (kind === 'plan.replanned') on = false
  }
  return on
}

/** The coordinator's answers to one Task's questions (W6-B's `question.auto-answered`), oldest first. */
export function autoAnswersOf(events: readonly ActivityEvent[], taskId: string): { question: string; answer: string; at: string }[] {
  return events
    .filter((e) => (e.type as string) === 'question.auto-answered' && e.taskId === taskId)
    .map((e) => {
      const p = e.payload as typeof e.payload & { answer?: string }
      return { question: p.question ?? p.title, answer: p.answer ?? p.resolution ?? '', at: e.occurredAt }
    })
}

/** An open ask or escalation row of `questions-list` (command.ts messageQuestionOf); the renderer does not import command.ts. */
export interface OpenQuestion {
  id: string
  source: 'ask' | 'escalation'
  taskId: string
  question: string
  options?: string[]
  /** W8-F (#97): false for a Gate that takes only its options (no text box). Absent: free text is taken. */
  freeText?: false
}

/** The open asks/escalations of one Task, oldest first as the list holds them. Gates (no `source`) are not these. With
 *  an escalation open, only the escalations: answering one also answers the worker's ask (state.ts answerEscalation),
 *  so a second box for the same question would be one too many. */
export function questionsOfTask(rows: readonly OpenQuestion[], taskId: string): OpenQuestion[] {
  const mine = rows.filter((q) => q.source !== undefined && q.taskId === taskId)
  return mine.some((q) => q.source === 'escalation') ? mine.filter((q) => q.source === 'escalation') : mine
}

/** W8-F (#97): the Task's open Gate (`JobTask.gate`) as an answer box: a coordinator's `gate-create`, the convergence Gate
 *  (`retry-once` / `mark-failed`) or a check that could not be made. The last takes its options only (GateAnswer's rule). */
export function gateQuestionsOfTask(tk: JobTask): OpenQuestion[] {
  const g = tk.gate
  if (!g) return []
  const fixed = g.kind === 'check-unavailable'
  return [{ id: g.id, source: 'ask', taskId: tk.id, question: g.question, ...(g.options?.length ? { options: g.options } : {}), ...(fixed ? { freeText: false as const } : {}) }]
}

/** Every affected path of the plan with the Tasks that touch it, by path. More than one Task is an overlap. */
export function filesOf(tasks: readonly JobTask[]): { path: string; tasks: JobTask[] }[] {
  const byPath = new Map<string, JobTask[]>()
  for (const t of tasks) for (const p of new Set(t.affectedPaths ?? [])) byPath.set(p, [...(byPath.get(p) ?? []), t])
  return [...byPath].sort(([a], [b]) => a.localeCompare(b)).map(([path, ts]) => ({ path, tasks: ts }))
}

/** What the Host says of a worker's session (a `sessions-list` row): what it waits on, and its last tool call. */
export interface LiveSession {
  prompt?: 'permission' | 'question'
  lastAction?: SessionInfo['lastAction']
  // W8-C heavy: its place in line for the heavy-job slot (`astera heavy`), 1-based; absent when not waiting
  heavyWait?: number
}

// W8-C heavy
/** 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st … */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** A running Task's one-line "now", most pressing first: a prompt only a person can answer, a question to the
 *  coordinator still unanswered, then the last tool call. null for a Task that is not running or says nothing yet. */
export function nowOf(
  task: JobTask,
  session: LiveSession | undefined,
  events: readonly JobEvent[],
  nowMs: number
): { key: MessageKey; params?: MessageParams } | null {
  if (categoryOf(task) !== 'running') return null
  if (session?.prompt === 'permission') return { key: 'plan.now.permission' }
  if (session?.prompt === 'question') return { key: 'plan.now.question' }
  const asked = events.filter((e) => e.taskId === task.id && e.kind === 'message' && e.messageType === 'question').at(-1)
  if (asked?.answered === false) return { key: 'plan.now.asked' }
  if (session?.heavyWait) return { key: 'plan.now.heavyWait', params: { place: ordinal(session.heavyWait) } }
  const a = session?.lastAction
  if (!a) return null
  const ago = formatElapsed(new Date(a.at).toISOString(), nowMs)
  const target = a.target ?? ''
  if (EDIT_TOOLS.has(a.tool)) return { key: 'plan.now.editing', params: { target, ago } }
  if (a.tool === 'Bash') return { key: 'plan.now.running', params: { target, ago } }
  if (a.tool === 'Read') return { key: 'plan.now.reading', params: { target, ago } }
  if (a.tool === 'Grep' || a.tool === 'Glob') return { key: 'plan.now.searching', params: { target, ago } }
  return { key: 'plan.now.tool', params: { tool: a.tool, target, ago } }
}

/** The model a card shows. A dispatched Task shows what its attempt used (`model`); one not yet dispatched shows what
 *  resolveWorkerModel will pick (difficulty, Job override, app settings). undefined: the CLI's default. */
export function cardModelOf(tk: JobTask, settings: RoleModelSettings, accounts: readonly Account[]): string | undefined {
  if (tk.model !== undefined || tk.attempts !== undefined || tk.accountId !== undefined) return tk.model
  const { provider } = pickTaskProvider({ accountIds: tk.accountIds }, accounts)
  return resolveWorkerModel({
    settings,
    job: tk.jobModels ? { models: tk.jobModels } : undefined,
    task: { difficulty: tk.difficulty, accountIds: tk.accountIds },
    provider,
    accounts
  }).model
}

/** The i18n key for "N questions answered": singular for 1. */
export const answersKey = (n: number): 'plan.card.answers' | 'plan.card.answers.one' => (n === 1 ? 'plan.card.answers.one' : 'plan.card.answers')
