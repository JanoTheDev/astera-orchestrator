// W2-C plan board: the counts and words the overview and the board draw. Pure, so the node-only test suite reaches it;
// the reasons themselves are core's (core/orchestration/blocked.ts), folded into the snapshot.
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { JobEvent, JobRow, JobTask, SessionInfo, TaskBlockedReason, TaskCategory } from '../../../../core/types'
import { formatElapsed, formatRemaining } from '../../../../core/orchestration/elapsed'
import { pickTaskProvider, resolveWorkerEffort, resolveWorkerModel, type Effort, type RoleModelSettings } from '../../../../core/orchestration/roleModels'
import type { Account } from '../../../../core/types'
import { TASK_KINDS, type TaskKind } from '../../../../core/orchestration/types'
import type { IconName } from '../ui'
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
    case 'merging':
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

/** A reason as a catalog key and its params. `accountLabel` turns an account id into the name the person gave it.
 *  W12: the shown words say lead agent / agent, never coordinator / worker (the plan.steps.reason.* keys). */
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
      return { key: 'plan.steps.reason.definition' }
    case 'gate':
      return { key: 'plan.reason.gate', params: { question: reason.question } }
    case 'failure-limit':
      return { key: 'plan.reason.failureLimit', params: { failures: reason.failures } }
    case 'failed-retry':
      return {
        key: reason.noCoordinator ? 'plan.steps.reason.failedRetryByYou' : 'plan.steps.reason.failedRetry',
        params: { failures: reason.failures, limit: reason.limit }
      }
    case 'awaiting-review':
      return { key: 'plan.reason.awaitingReview' }
    case 'stopped':
      return { key: 'plan.steps.reason.stopped' }
    case 'deps':
      return { key: 'plan.reason.deps', params: { tasks: reason.waitingOn.map((d) => d.title).join(', ') } }
    case 'no-account':
      return { key: 'plan.reason.noAccount' }
    case 'coordinator':
      return { key: 'plan.steps.reason.lead' }
    case 'plan-cap':
      return { key: 'plan.steps.reason.planCap', params: { used: reason.used, limit: reason.limit } }
    case 'global-cap':
      return { key: 'plan.steps.reason.globalCap', params: { used: reason.used, limit: reason.limit, priority: reason.priority } }
    // W6-C
    case 'same-files':
      // W8-D: "Waits for Auth rework · T6 (same files: src/api/routes.ts)" when it is another plan's
      // T9: "Waits for Auth rework to deliver src/api/routes.ts" when the Task is done and its plan not delivered
      if (reason.plan && reason.delivery) return { key: 'plan.reason.leasePlan', params: { plan: reason.plan.title, path: reason.path } }
      return reason.plan
        ? { key: 'plan.reason.sameFilesPlan', params: { plan: reason.plan.title, task: reason.waitingOn.title, path: reason.path } }
        : { key: 'plan.reason.sameFiles', params: { task: reason.waitingOn.title, path: reason.path } }
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

/** Where one step stands. `waiting` names the earlier step (1-based) it waits on and how many of its Tasks are left. */
export type StepState =
  | { state: 'done' | 'running' | 'ready' | 'blocked' | 'failed' | 'replanning' }
  | { state: 'waiting'; on: number; left: number }

/** A step's state word. Order matters: a finished step is done whatever else is said; a replan only marks the step being
 *  worked on; a failure shows when nothing else in the step still runs; a Task that needs the owner (a gate) beats running
 *  so the step does not look healthy; a step that is not running waits while any earlier step is open, else it is ready. */
export function stepStateOf(wave: PlanWave, waves: readonly PlanWave[], replanning: boolean): StepState {
  if (wave.done === wave.tasks.length) return { state: 'done' }
  if (replanning && wave.index === currentWaveOf(waves)) return { state: 'replanning' }
  const cats = wave.tasks.map(categoryOf)
  const running = cats.some((c) => c === 'running')
  if (cats.includes('failed') && !running) return { state: 'failed' }
  if (wave.tasks.some((t) => t.openGates > 0 || t.board?.reason?.kind === 'gate')) return { state: 'blocked' }
  if (running) return { state: 'running' }
  const before = waves.find((w) => w.index < wave.index && w.done < w.tasks.length)
  return before ? { state: 'waiting', on: before.index + 1, left: before.tasks.length - before.done } : { state: 'ready' }
}

/** T4: the waves that fold to one line — every finished wave (all its Tasks done). The current wave and later ones stay
 *  open, so old done Tasks are out of the way when more are added to the plan. */
export const collapsedWavesOf = (waves: readonly PlanWave[]): ReadonlySet<number> =>
  new Set(waves.filter((w) => w.done === w.tasks.length).map((w) => w.index))

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

/** Coordinator rotation: why this plan's coordinator was last refreshed ("wave 3", "context 72%"), or null for never. */
export function coordinatorRefreshOf(events: readonly ActivityEvent[], planId: string): string | null {
  let reason: string | null = null
  for (const e of events)
    if ((e.runId === planId || e.jobId === planId) && (e.type as string) === 'coordinator.refreshed') reason = e.payload.reason ?? null
  return reason
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

/** T8 "Needs you": every open question and Gate of the plan with its Task, in the plan's Task order: what the owner
 *  answers at the top of the plan tab, instead of on each Task's card. */
export function needsYouOf(tasks: readonly JobTask[], questions: readonly OpenQuestion[]): { task: JobTask; q: OpenQuestion }[] {
  return tasks.flatMap((task) => [...questionsOfTask(questions, task.id), ...gateQuestionsOfTask(task)].map((q) => ({ task, q })))
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

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

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
  if (asked?.answered === false) return { key: 'plan.steps.now.asked' }
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

/** The effort a card shows, like cardModelOf: a dispatched Task shows what its attempt was started with (undefined: no flag),
 *  one not yet dispatched shows what resolveWorkerEffort will pick. */
export function cardEffortOf(tk: JobTask, settings: RoleModelSettings, accounts: readonly Account[]): Effort | undefined {
  if (tk.attempts !== undefined || tk.accountId !== undefined) return tk.effort
  const { provider } = pickTaskProvider({ accountIds: tk.accountIds }, accounts)
  return resolveWorkerEffort({ settings, task: { difficulty: tk.difficulty, effort: tk.effort }, job: { effort: tk.jobEffort }, provider })
}

/** The i18n key for "N questions answered": singular for 1. */
export const answersKey = (n: number): 'plan.card.answers' | 'plan.card.answers.one' => (n === 1 ? 'plan.card.answers.one' : 'plan.card.answers')

// ── W9-C Tasks page, Plans page, plan page ──────────────────────────────────────────────────────────────────────────────

/** The Tasks page's five columns, in the order they stand (DESIGN.md §2 "Tasks"). */
export const TASK_COLUMNS = ['planned', 'working', 'needs-you', 'review', 'done'] as const
export type TaskColumn = (typeof TASK_COLUMNS)[number]

/** Reasons only the owner can clear. A plan waiting for approval is not here: its Tasks are planned, and the approval
 *  itself is the Inbox's card (W9-D). */
const NEEDS_YOU_REASONS: ReadonlySet<TaskBlockedReason['kind']> = new Set(['gate', 'no-account', 'stopped', 'failure-limit', 'failed-retry'])

/** The column of one Task. `session` is the Host's word on its worker (a permission or question prompt needs the owner);
 *  `asked` says an ask or escalation of it waits on the owner (questions-list). */
export function taskColumnOf(task: JobTask, session?: LiveSession, asked = false): TaskColumn {
  const c = categoryOf(task)
  if (c === 'done' || c === 'cancelled') return 'done'
  if (c === 'failed' || asked || session?.prompt !== undefined || task.gate !== undefined) return 'needs-you'
  if (task.board?.reason && NEEDS_YOU_REASONS.has(task.board.reason.kind)) return 'needs-you'
  if (c === 'awaiting-review') return 'review'
  if (c === 'running') return 'working'
  return 'planned'
}

/** The plan page's sections (DESIGN.md §2 "Plan page"). T8: the page is one document; a section, or an anchor on it
 *  (`settings`, `task-<id>`), says where it scrolls to (planPage.ts planAnchorOf). */
export const PLAN_SECTIONS = ['overview', 'waves', 'files', 'changes', 'journal'] as const
export type PlanSection = (typeof PLAN_SECTIONS)[number] | 'settings' | `task-${string}`

/** The Plans page's modes; the one last used is remembered (PlanList). */
export type PlansView = 'area' | 'overlap' | 'main'

export function plansViewOf(v: unknown): PlansView {
  return v === 'overlap' || v === 'main' ? v : 'area'
}

/** A section named by `openPlan(jobId, section?)` or read back from storage; anything else is the default. Old names
 *  from before W9-C (the RunDetail views and the navigation test's `tasks`) map onto their new home. */
export function planSectionOf(v: unknown): PlanSection {
  if (typeof v !== 'string') return 'overview'
  if ((PLAN_SECTIONS as readonly string[]).includes(v)) return v as PlanSection
  // T8 anchors, with or without the `#` of a tab arg
  const anchor = v.startsWith('#') ? v.slice(1) : v
  if (anchor === 'settings') return 'settings'
  if (anchor.startsWith('task-') && anchor.length > 'task-'.length) return anchor as `task-${string}`
  if (v === 'board' || v === 'graph' || v === 'tasks') return 'waves'
  return 'overview'
}

/** Where a Task card goes on a click (DESIGN.md §2 "Tasks"). */
export type TaskClick =
  | { kind: 'console'; sessionId: string }
  | { kind: 'inbox'; filter: string }
  | { kind: 'plan'; jobId: string; section: PlanSection }

/** Working or in review → its console; needs you → its Inbox card; planned → its plan's Waves; done → its summary.
 *  A Task whose console is gone falls back to its plan's Waves, where the card still is. */
export function taskClickOf(column: TaskColumn, task: JobTask, jobId: string, canOpenSession: (id: string) => boolean): TaskClick {
  if ((column === 'working' || column === 'review') && task.sessionId && canOpenSession(task.sessionId))
    return { kind: 'console', sessionId: task.sessionId }
  if (column === 'needs-you') return { kind: 'inbox', filter: task.id }
  // done: the summary cards' place is the plan Overview's "What happened so far" (W9-I PlanSummaryRollup)
  return { kind: 'plan', jobId, section: column === 'done' ? 'overview' : 'waves' }
}

/** Done keeps the last this-many per plan on the Tasks page; older ones are under the plan's page. */
export const DONE_PER_PLAN = 20

/** A plan's place in the Plans list (DESIGN.md §2): running, awaiting approval, queued, then delivered and archived. */
export function planRankOf(row: JobRow): number {
  if (row.archivedAt !== undefined) return 4
  if (row.pendingStart) return row.after !== undefined ? 2 : 1
  // A plan in its final check is still at work; one finished with blocked Tasks waits on the owner
  return row.outcome === 'running' || row.outcome === 'checking' || row.outcome === 'blocked' ? 0 : 3
}

/** The Plans list in that order; within a rank the snapshot's own order (newest first) stays (stable sort). */
export const planListOrder = (rows: readonly JobRow[]): JobRow[] => [...rows].sort((a, b) => planRankOf(a) - planRankOf(b))

/** A path's top folder for the area heads and the Overlap table: its first two segments (`src/api`), or the file. */
export function topFolderOf(path: string): string {
  const parts = path.replace(/^\.?\//, '').split('/').filter(Boolean)
  return parts.length <= 2 ? parts.slice(0, -1).join('/') || parts.join('/') : parts.slice(0, 2).join('/')
}

const foldersOf = (row: JobRow): string[] =>
  [...new Set(row.tasks.flatMap((t) => (t.affectedPaths ?? []).map(topFolderOf)))].sort((a, b) => a.localeCompare(b))

/** "By area": plans grouped under their first area (Job.areas), each group with its folders. A plan in two areas is listed
 *  once (its row shows every area as a chip); one with none is in the `''` group, last. Groups are sorted by name and keep the list order inside. */
export function areaGroupsOf(rows: readonly JobRow[]): { area: string; folders: string[]; rows: JobRow[] }[] {
  const by = new Map<string, JobRow[]>()
  for (const r of planListOrder(rows)) { const a = r.areas?.[0] ?? ''; by.set(a, [...(by.get(a) ?? []), r]) }
  return [...by]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([area, rs]) => ({ area, folders: [...new Set(rs.flatMap(foldersOf))].sort((a, b) => a.localeCompare(b)), rows: rs }))
}

/** One cell of the Overlap table: what the plan does in that folder. */
export type OverlapCell = { kind: 'editing'; task: string } | { kind: 'planned' } | { kind: 'done' } | null

/** "Overlap": plans × top folders. A cell is the plan's busiest state there: a Task working ("T6 editing"), else one
 *  still to come, else done. `shared` are the folders two or more plans still have work in. Archived plans are left
 *  out; folders are the `maxFolders` most touched. */
export function overlapTableOf(
  rows: readonly JobRow[],
  maxFolders = 12
): { folders: string[]; shared: Set<string>; rows: { row: JobRow; cells: OverlapCell[] }[] } {
  const live = planListOrder(rows).filter((r) => r.archivedAt === undefined)
  const touch = new Map<string, number>()
  for (const r of live) for (const f of foldersOf(r)) touch.set(f, (touch.get(f) ?? 0) + 1)
  const folders = [...touch].sort(([a, n], [b, m]) => m - n || a.localeCompare(b)).slice(0, maxFolders).map(([f]) => f).sort((a, b) => a.localeCompare(b))
  const cellOf = (r: JobRow, folder: string): OverlapCell => {
    const here = r.tasks.filter((t) => (t.affectedPaths ?? []).some((p) => topFolderOf(p) === folder))
    if (here.length === 0) return null
    const working = here.find((t) => categoryOf(t) === 'running')
    if (working) return { kind: 'editing', task: working.title }
    return here.every((t) => categoryOf(t) === 'done' || categoryOf(t) === 'cancelled') ? { kind: 'done' } : { kind: 'planned' }
  }
  const table = live.map((row) => ({ row, cells: folders.map((f) => cellOf(row, f)) }))
  const shared = new Set(folders.filter((_, i) => table.filter((t) => t.cells[i] !== null && t.cells[i]?.kind !== 'done').length >= 2))
  return { folders, shared, rows: table }
}

/** A plan row's age, short: "<1m", "5m", "3h", "4d". */
export function ageOf(fromIso: string, nowMs: number): string {
  const min = Math.floor(Math.max(0, nowMs - Date.parse(fromIso)) / 60_000)
  if (Number.isNaN(min) || min < 1) return '<1m'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

// T4 task types: the kind badge of a card, the board's kind filter and the worktree a Task continues in.

/** One registry icon per kind; the label is `plan.kind.<kind>` and the colour `.plan-kind--<kind>` (planBoard.css). */
export const KIND_ICON: Record<TaskKind, IconName> = {
  bugfix: 'warning',
  feature: 'add',
  refactor: 'repeat',
  ui: 'screen',
  audit: 'search',
  docs: 'file',
  test: 'check',
  ops: 'settings'
}

/** The board's kind filter: every Task, or one kind. */
export type KindFilter = 'all' | TaskKind

/** The kinds the Tasks carry, in the catalog's order with their counts: what the filter offers. A Task without a kind
 *  (an older Runtime's snapshot) counts for none. */
export function kindsOf(tasks: readonly JobTask[]): { kind: TaskKind; count: number }[] {
  return TASK_KINDS.map((kind) => ({ kind, count: tasks.filter((t) => t.kind === kind).length })).filter((k) => k.count > 0)
}

/** The Tasks the filter lets through. `all` is the Tasks as they are (a Task with no kind shows only there). */
export const filterByKind = (tasks: readonly JobTask[], kind: KindFilter): readonly JobTask[] =>
  kind === 'all' ? tasks : tasks.filter((t) => t.kind === kind)

/** The Task whose worktree this one continues in (`worktree: 'reuse'`: its one dep's), named by its title. `null`: it
 *  starts in a worktree of its own. `title` is absent when the dep is not on the board (a runtime without `deps`). */
export function reuseOf(task: JobTask, tasks: readonly JobTask[], deps: Readonly<Record<string, readonly string[]>> | undefined): { title?: string } | null {
  if (task.worktree !== 'reuse') return null
  const dep = deps?.[task.id]?.length === 1 ? tasks.find((t) => t.id === deps[task.id][0]) : undefined
  return dep ? { title: dep.title } : {}
}
