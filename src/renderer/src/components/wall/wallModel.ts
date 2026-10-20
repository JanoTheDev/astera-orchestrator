// W9-H Agents page: which consoles the wall shows, in which order, and what each tile, pill and details panel says
// (DESIGN.md §2 "Agents"). Pure, so the node-only suite reaches it. Every fact is one the app already has: the
// sessions, the workspace tree (W2-B), attention (useAttention), the Host's session rows (usePlanLive: prompt,
// lastAction) and the Jobs fold (JobRow / JobTask with taskBoardsOf's `board`). Nothing here re-derives a state.
import type { MessageKey } from '../../../../core/i18n'
import type { Attention, JobRow, JobTask, SessionInfo, TaskCategory } from '../../../../core/types'
import type { Dispatch, Task } from '../../../../core/orchestration/types'
import { categoryOf, planProgressOf, type LiveSession, type PlanProgress } from '../plan/planBoard'
import { approveSlot } from '../plan/planTalk'
import { planSessions, projectOfCwd, type WorkspaceData, type WorkspacePlan, type WorkspaceProject, type WorkspaceSession } from '../../state/workspaceTree'

export type ConsoleRole = 'coordinator' | 'planner' | 'worker' | 'reviewer' | 'console'
/** A tile's state. It shows on the tile; it never moves the tile. Finished consoles go to their own row. */
export type TileState = 'needs' | 'working' | 'idle' | 'finished'
const ROLE_ORDER: Record<ConsoleRole, number> = { coordinator: 0, planner: 1, worker: 2, reviewer: 2, console: 3 }

export interface WallConsole {
  sessionId: string
  /** Without the plan's name: "Worker 2", "Coordinator", "Planner"; a plain console's own title. */
  label: string
  role: ConsoleRole
  state: TileState
  /** The border of a needs-you tile: a permission prompt or a failed Task is danger, a question or a Gate warn. */
  tone?: 'warn' | 'danger'
  /** What it waits on, for the chip. */
  needs?: 'permission' | 'question' | 'gate'
  projectId: string | null
  jobId?: string
  planName?: string
  /** The plan's place in the tree (project order, then plan order); plain consoles sort after every plan. */
  planOrder: number
  taskId?: string
  taskTitle?: string
  model?: string
  accountId?: string
  cwd: string
  /** A chat session (assistant-ui): it has no xterm, so its tile cannot show the console. */
  chat: boolean
}

export interface WallInput {
  sessions: readonly SessionInfo[]
  tree: readonly WorkspaceProject[]
  data: Pick<WorkspaceData, 'dispatches' | 'worktrees'> | null
  attention: Readonly<Record<string, Attention>>
  live: Readonly<Record<string, LiveSession>>
  /** The Jobs fold, keyed by indexJobRows (every id a plan looks its row up by). */
  rows: Readonly<Record<string, JobRow>>
}

const shortLabel = (s: WorkspaceSession): string =>
  s.label.startsWith(`${s.planName} `) ? s.label.slice(s.planName.length + 1) : s.label

/**
 * The jobs-view rows keyed by every id a plan looks its row up by: the plan's `runId` or `jobId`. A folded Job
 * row (one Run) is keyed by its Job id and by `foldedRunId`; a nested Job's Runs are keyed by their own ids
 * (`children`). Pure, so the node-only suite reaches it.
 */
export function indexJobRows(rows: readonly JobRow[]): Record<string, JobRow> {
  const out: Record<string, JobRow> = {}
  for (const row of rows) {
    out[row.id] = row
    if (row.foldedRunId) out[row.foldedRunId] = row
    for (const child of row.children ?? []) out[child.id] = child
  }
  return out
}

/** The JobTask of a plan session's Task, if the fold has it. */
function jobTaskOf(rows: WallInput['rows'], runId: string | undefined, taskId: string | undefined): JobTask | undefined {
  if (!runId || !taskId) return undefined
  return rows[runId]?.tasks.find((t) => t.id === taskId)
}

/** Every local console the app holds, with its role, plan and state. Order is the sessions' own; `orderWall` sorts. */
export function consolesOf(input: WallInput): WallConsole[] {
  const byId = new Map<string, { s: WorkspaceSession; plan: WorkspacePlan; order: number }>()
  let order = 0
  for (const p of input.tree)
    for (const plan of p.plans) {
      for (const s of planSessions(plan)) if (!byId.has(s.sessionId)) byId.set(s.sessionId, { s, plan, order })
      order++
    }
  const reviewing = new Set((input.data?.dispatches ?? []).filter((d: Dispatch) => d.review === true).map((d) => d.sessionId))
  return input.sessions.map((session) => {
    const hit = byId.get(session.id)
    const ws = hit?.s
    const role: ConsoleRole = !ws ? 'console' : ws.role === 'worker' && reviewing.has(session.id) ? 'reviewer' : ws.role
    const tk = jobTaskOf(input.rows, hit?.plan.runId, ws?.taskId)
    const att = input.attention[session.id]
    const prompt = input.live[session.id]?.prompt
    let state: TileState = 'idle'
    let needs: WallConsole['needs']
    let tone: WallConsole['tone']
    if (session.status === 'exited') state = 'finished'
    else if (att === 'waiting' || prompt) {
      state = 'needs'
      needs = prompt ?? 'question'
      tone = needs === 'permission' ? 'danger' : 'warn'
    } else if (tk?.gate) {
      state = 'needs'
      needs = 'gate'
      tone = tk.board?.category === 'failed' ? 'danger' : 'warn'
    } else if (att === 'working') state = 'working'
    const projectId = hit?.plan.projectId ?? projectOfCwd(session.cwd, input.tree, input.data?.worktrees ?? [])
    return {
      sessionId: session.id,
      label: ws ? shortLabel(ws) : session.title,
      role,
      state,
      ...(tone ? { tone } : {}),
      ...(needs ? { needs } : {}),
      projectId,
      ...(hit ? { jobId: hit.plan.jobId, planName: hit.plan.name } : {}),
      planOrder: hit ? hit.order : Number.MAX_SAFE_INTEGER,
      ...(ws?.taskId ? { taskId: ws.taskId } : {}),
      ...(ws?.taskTitle ? { taskTitle: ws.taskTitle } : {}),
      ...((ws?.model ?? session.model) ? { model: ws?.model ?? session.model } : {}),
      accountId: ws?.accountId ?? session.accountId,
      cwd: session.cwd,
      chat: session.kind === 'chat'
    }
  })
}

/** `'all'`, `'none'` (consoles of no plan) or a plan's Job id. */
export type PlanFilter = string
export const ALL_PLANS = 'all'
export const NO_PLAN = 'none'
export type StateFilter = 'all' | 'needs' | 'working' | 'finished'
/** this plan / the open project / every project. */
export type Scope = 'plan' | 'project' | 'all'

export interface WallFilter {
  plan: PlanFilter
  state: StateFilter
  scope: Scope
  /** The open project's id (scope `project`); null when the app has none open. */
  projectId: string | null
}

/** The consoles a filter keeps. `scope: 'plan'` without a plan picked is the project scope. */
export function filterConsoles(cs: readonly WallConsole[], f: WallFilter): WallConsole[] {
  return cs.filter((c) => {
    if (f.plan === NO_PLAN ? c.jobId !== undefined : f.plan !== ALL_PLANS && c.jobId !== f.plan) return false
    if (f.scope !== 'all' && f.projectId !== null && !(f.scope === 'plan' && f.plan !== ALL_PLANS && f.plan !== NO_PLAN) && c.projectId !== f.projectId)
      return false
    if (f.state === 'all') return true
    return c.state === f.state
  })
}

export interface WallLayout {
  /** The pinned coordinators, plan order; with one plan picked, its coordinator is `main` (double height). */
  pinned: WallConsole[]
  /** The rest of the live tiles by fixed place, never by state: plan order, then planner, workers by label number, plain consoles. */
  tiles: WallConsole[]
  /** Ended consoles, for the Finished row (or the grid, under the Finished filter). */
  finished: WallConsole[]
  /** The pinned coordinator drawn twice as tall, labelled "main"; set only when one plan is picked. */
  mainId: string | null
}

const byLabel = (a: WallConsole, b: WallConsole): number => a.planOrder - b.planOrder || a.label.localeCompare(b.label, undefined, { numeric: true })

/** The wall's order (DESIGN §2): per plan the coordinator first, then the planner, then workers by label number, then plain consoles; live state never reorders. */
export function orderWall(cs: readonly WallConsole[], plan: PlanFilter): WallLayout {
  const live = cs.filter((c) => c.state !== 'finished')
  const pinned = live.filter((c) => c.role === 'coordinator').sort(byLabel)
  const tiles = live
    .filter((c) => c.role !== 'coordinator')
    .sort((a, b) => a.planOrder - b.planOrder || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || byLabel(a, b))
  const finished = cs.filter((c) => c.state === 'finished').sort(byLabel)
  const one = plan !== ALL_PLANS && plan !== NO_PLAN
  return { pinned, tiles, finished, mainId: one ? (pinned[0]?.sessionId ?? null) : null }
}

/** The wall's role sections, in this order; a reviewer sits with the workers. */
export type SectionKey = 'coordinators' | 'planners' | 'workers' | 'consoles'
const SECTION_OF: Record<ConsoleRole, SectionKey> = { coordinator: 'coordinators', planner: 'planners', worker: 'workers', reviewer: 'workers', console: 'consoles' }
const SECTION_KEYS: readonly SectionKey[] = ['coordinators', 'planners', 'workers', 'consoles']

/** One role's block on the wall: its live tiles, then its finished consoles (summary cards). */
export interface WallSection {
  key: SectionKey
  live: WallConsole[]
  done: WallConsole[]
}

/** The wall split by role, in fixed order, empty sections left out. Each section keeps the order given (orderWall decides it). */
export function roleSections(live: readonly WallConsole[], done: readonly WallConsole[]): WallSection[] {
  return SECTION_KEYS.map((key) => ({
    key,
    live: live.filter((c) => SECTION_OF[c.role] === key),
    done: done.filter((c) => SECTION_OF[c.role] === key)
  })).filter((g) => g.live.length + g.done.length > 0)
}

/** The auto grid: 1–4 consoles → 2 columns, 5–9 → 3, 10+ → 4. */
export function gridColumns(count: number): 2 | 3 | 4 {
  return count >= 10 ? 4 : count >= 5 ? 3 : 2
}

/** One plan pill of the toolbar. */
export interface PlanPill {
  jobId: string
  name: string
  projectId: string
  projectName: string
  progress: PlanProgress
  done: number
  total: number
  /** Its Tasks with an open Gate plus its consoles waiting on the owner. */
  needs: number
  /** Planned and waiting for the owner's approval. */
  approve: boolean
}

/** The pills: every active or queued plan of the projects in scope, in tree order. Archived plans are left out. */
export function planPills(tree: readonly WorkspaceProject[], rows: WallInput['rows'], cs: readonly WallConsole[], projectId: string | null, scope: Scope): PlanPill[] {
  const out: PlanPill[] = []
  for (const p of tree) {
    if (scope !== 'all' && projectId !== null && p.id !== projectId) continue
    for (const plan of p.plans) {
      if (plan.archived) continue
      const row = plan.runId ? rows[plan.runId] : rows[plan.jobId]
      const tasks = row?.tasks ?? []
      const waiting = cs.filter((c) => c.jobId === plan.jobId && c.state === 'needs' && c.needs !== 'gate').length
      out.push({
        jobId: plan.jobId,
        name: plan.name,
        projectId: p.id,
        projectName: p.name,
        progress: planProgressOf(tasks),
        done: row?.done ?? 0,
        total: row?.total ?? tasks.length,
        needs: tasks.filter((t) => t.gate !== undefined).length + waiting,
        // #116: only once the planner is done, never while it plans or for a plan that starts by itself
        approve: row?.planned === true && approveSlot(row) === 'approve'
      })
    }
  }
  return out
}

/** The pill's short count: "approve", "4/9 · 2 need you", "4/9". The words come from the caller's catalog. */
export function pillCount(p: PlanPill, words: { approve: string; need(n: number): string }): string {
  if (p.approve) return words.approve
  const base = `${p.done}/${p.total}`
  return p.needs > 0 ? `${base} · ${words.need(p.needs)}` : base
}

/** The stacked bar's segments, done first, as fractions of the whole. */
export function progressSegments(p: PlanProgress): { category: TaskCategory; share: number }[] {
  if (p.total === 0) return []
  return (['done', 'running', 'awaiting-review', 'queued', 'failed', 'cancelled'] as const)
    .filter((c) => p.counts[c] > 0)
    .map((c) => ({ category: c, share: p.counts[c] / p.total }))
}

/** The strip's entry for a console: "Coordinator (main)" for the main tile, "Worker 2 · <Task>" for a worker. */
export function stripLabel(c: WallConsole, mainId: string | null): string {
  if (c.sessionId === mainId) return `${c.label} (main)`
  return c.taskTitle && (c.role === 'worker' || c.role === 'reviewer') ? `${c.label} · ${c.taskTitle}` : c.label
}

// ---- The details panel (DESIGN §2 "One console full size"), from Host data only ----

export interface TaskLine {
  id: string
  title: string
  category: TaskCategory
  /** Who is on it: a console's label and what it waits on, or nothing. */
  who?: string
  /** The console to jump to, if it is open. */
  sessionId?: string
}

export interface ConsoleDetails {
  role: ConsoleRole
  /** The console's own Task (worker, reviewer). */
  task?: { title: string; brief?: string; criteria: { text: string; met: boolean }[]; startedAt?: string; branch?: string; files: string[]; gate?: string; openGates: number }
  /** The plan's progress and its Tasks (worker, coordinator, planner). */
  plan?: { jobId: string; name: string; done: number; total: number; tasks: TaskLine[] }
  /** Coordinator: questions it answered for the plan's workers, and escalations it raised to the owner. */
  answered?: number
  escalated?: number
  /** Reviewer: round N of M. */
  review?: { round: number; max: number }
  model?: string
  accountId?: string
  cwd: string
}

export interface DetailsInput {
  console: WallConsole
  consoles: readonly WallConsole[]
  rows: WallInput['rows']
  tree: readonly WorkspaceProject[]
  /** tasks-list rows, for a Task's brief and acceptance criteria. */
  tasks: readonly Pick<Task, 'id' | 'spec' | 'acceptanceCriteria'>[]
  /** Answered questions per plan (the activity feed's `question.auto-answered`), and open escalations per plan. */
  answeredOf(jobId: string): number
  escalatedOf(jobId: string): number
}

/** A Task's brief: its prompt as `tasks list --brief` cuts it (one line), without a leading heading mark. */
const briefOf = (spec: string | undefined): string | undefined => spec?.replace(/^\s*#+\s*/, '').trim() || undefined

export function detailsOf(d: DetailsInput): ConsoleDetails {
  const c = d.console
  const plan = c.jobId ? d.tree.flatMap((p) => p.plans).find((x) => x.jobId === c.jobId) : undefined
  const row = plan ? (plan.runId ? d.rows[plan.runId] : d.rows[plan.jobId]) : undefined
  const base: ConsoleDetails = { role: c.role, cwd: c.cwd, ...(c.model ? { model: c.model } : {}), ...(c.accountId ? { accountId: c.accountId } : {}) }
  if (!plan) return base
  const onTask = new Map<string, WallConsole>()
  for (const x of d.consoles) if (x.taskId && x.jobId === plan.jobId && x.state !== 'finished') onTask.set(x.taskId, x)
  const lines: TaskLine[] = (row?.tasks ?? []).map((t) => {
    const who = onTask.get(t.id)
    return {
      id: t.id,
      title: t.title,
      category: categoryOf(t),
      ...(who ? { who: who.needs ? `${who.label} · ${who.needs}` : who.label, sessionId: who.sessionId } : {})
    }
  })
  const planPart = { jobId: plan.jobId, name: plan.name, done: row?.done ?? 0, total: row?.total ?? lines.length, tasks: lines }
  if (c.role === 'coordinator') return { ...base, plan: planPart, answered: d.answeredOf(plan.jobId), escalated: d.escalatedOf(plan.jobId) }
  if (c.role === 'planner') return { ...base, plan: planPart }
  const tk = row?.tasks.find((t) => t.id === c.taskId)
  const src = d.tasks.find((t) => t.id === c.taskId)
  // shortcut: no per-criterion verdict exists in the Host's data; every criterion reads met once the Task is done.
  // Upgrade when the reviewer records a verdict per criterion.
  const met = tk ? categoryOf(tk) === 'done' : false
  const task = {
    title: c.taskTitle ?? tk?.title ?? '',
    ...(briefOf(src?.spec) ? { brief: briefOf(src?.spec) } : {}),
    criteria: (src?.acceptanceCriteria ?? []).map((text) => ({ text, met })),
    ...(tk?.startedAt ? { startedAt: tk.startedAt } : {}),
    ...(tk?.branch ? { branch: tk.branch } : {}),
    files: tk?.affectedPaths ?? [],
    ...(tk?.gate ? { gate: tk.gate.question } : {}),
    openGates: tk?.openGates ?? 0
  }
  const review = c.role === 'reviewer' && tk?.convergence ? { review: { round: tk.convergence.reviewRound, max: tk.convergence.maxReviewRounds } } : {}
  return { ...base, task, plan: planPart, ...review }
}

/** The tile's detail line, per role: a worker's time running and files; the coordinator's answered and escalated
 *  counts; the reviewer's round. Keys and params for the caller's catalog. */
export function detailLineOf(d: ConsoleDetails, nowMs: number, elapsed: (iso: string, now: number) => string): { key: MessageKey; params: Record<string, string | number> } | null {
  if (d.role === 'coordinator') return { key: 'wall.detail.coordinator', params: { answered: d.answered ?? 0, escalated: d.escalated ?? 0 } }
  if (d.role === 'reviewer' && d.review) return { key: 'wall.detail.reviewer', params: { round: d.review.round, max: d.review.max } }
  if (d.role === 'worker' && d.task) {
    const running = d.task.startedAt ? elapsed(d.task.startedAt, nowMs) : '—'
    return { key: 'wall.detail.worker', params: { running, files: d.task.files.length } }
  }
  if (d.role === 'planner' && d.plan) return { key: 'wall.detail.planner', params: { tasks: d.plan.total } }
  return null
}
