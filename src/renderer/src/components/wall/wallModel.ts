// W9-H Agents page: which consoles exist, in which order, and what each row and console header says
// (DESIGN.md §2 "Agents"). Pure, so the node-only suite reaches it. Every fact is one the app already has: the
// sessions, the workspace tree (W2-B), attention (useAttention), the Host's session rows (usePlanLive: prompt,
// lastAction) and the Jobs fold (JobRow / JobTask with taskBoardsOf's `board`). Nothing here re-derives a state.
import type { Attention, JobRow, JobTask, SessionInfo } from '../../../../core/types'
import type { Dispatch, Task } from '../../../../core/orchestration/types'
import type { LiveSession } from '../plan/planBoard'
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
  /** The project's name in the workspace tree, for the row's "project › plan". */
  projectName?: string
  jobId?: string
  planName?: string
  /** The plan's place in the tree (project order, then plan order); plain consoles sort after every plan. */
  planOrder: number
  taskId?: string
  taskTitle?: string
  model?: string
  /** The reasoning effort the session was started with (SessionInfo.effort). */
  effort?: string
  /** Epoch ms its Dispatch started; known only for a plan's session. */
  startedAt?: number
  /** Epoch ms of the last sign of life: its last tool call, else its Dispatch's end. */
  lastActiveAt?: number
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

const msOf = (iso: string | undefined): number | undefined => {
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isNaN(ms) ? undefined : ms
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
  // each session's latest Dispatch: its start and end are the row's times
  const dispatchOf = new Map<string, Dispatch>()
  for (const d of input.data?.dispatches ?? []) {
    const had = dispatchOf.get(d.sessionId)
    if (!had || had.startedAt < d.startedAt) dispatchOf.set(d.sessionId, d)
  }
  const projectName = new Map(input.tree.map((p) => [p.id, p.name]))
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
    const dispatch = dispatchOf.get(session.id)
    const startedAt = msOf(dispatch?.startedAt) ?? session.startedAt
    const acts = [session.lastAction?.at, input.live[session.id]?.lastAction?.at].filter((x): x is number => x !== undefined)
    const lastActiveAt = acts.length > 0 ? Math.max(...acts) : msOf(dispatch?.endedAt)
    return {
      sessionId: session.id,
      label: ws ? shortLabel(ws) : session.title,
      role,
      state,
      ...(tone ? { tone } : {}),
      ...(needs ? { needs } : {}),
      projectId,
      ...(projectId && projectName.has(projectId) ? { projectName: projectName.get(projectId) } : {}),
      ...(hit ? { jobId: hit.plan.jobId, planName: hit.plan.name } : {}),
      planOrder: hit ? hit.order : Number.MAX_SAFE_INTEGER,
      ...(ws?.taskId ? { taskId: ws.taskId } : {}),
      ...(ws?.taskTitle ? { taskTitle: ws.taskTitle } : {}),
      ...((ws?.model ?? session.model) ? { model: ws?.model ?? session.model } : {}),
      ...(session.effort ? { effort: session.effort } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(lastActiveAt !== undefined ? { lastActiveAt } : {}),
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

// ---- The Agents view's rows and the console tab's header (DESIGN-W13 §4, §12) ----

/** The title of a console's row, card and tab: its Task, else the agent's own name. */
export const consoleTitle = (c: WallConsole): string => c.taskTitle ?? c.label

/** The dim line after the title, "project › plan": where the session belongs. The account, model and time sit on the
 *  row's right (sessionRow.ts); a console of no plan names its project alone. */
export function consoleDescription(c: WallConsole): string {
  return [c.projectName, c.planName].filter(Boolean).join(' › ')
}

/** The Agents view's four panes: each state's consoles, keeping the wall's order (plan order, then role). */
export function agentPanes(cs: readonly WallConsole[]): Record<TileState, WallConsole[]> {
  const out: Record<TileState, WallConsole[]> = { needs: [], working: [], idle: [], finished: [] }
  for (const c of [...cs].sort((a, b) => a.planOrder - b.planOrder || ROLE_ORDER[a.role] - ROLE_ORDER[b.role])) out[c.state].push(c)
  return out
}

/** The plans the view's filter offers: those the consoles belong to, in plan order. */
export function plansOf(cs: readonly WallConsole[]): { jobId: string; name: string }[] {
  const seen = new Map<string, { jobId: string; name: string; order: number }>()
  for (const c of cs) if (c.jobId && !seen.has(c.jobId)) seen.set(c.jobId, { jobId: c.jobId, name: c.planName ?? c.jobId, order: c.planOrder })
  return [...seen.values()].sort((a, b) => a.order - b.order).map(({ jobId, name }) => ({ jobId, name }))
}

/** What the console tab's header says: a planned console links its plan and Task; any other shows its folder. */
export interface ConsoleHeaderText {
  plan?: { jobId: string; name: string }
  task?: string
  /** Only for a console of no plan. */
  cwd?: string
  account?: string
}
export function consoleHeaderOf(c: WallConsole, account?: string): ConsoleHeaderText {
  return {
    ...(c.jobId ? { plan: { jobId: c.jobId, name: c.planName ?? c.jobId }, task: consoleTitle(c) } : { cwd: c.cwd }),
    ...(account ? { account } : {})
  }
}
