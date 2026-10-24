// T7 Plans view (DESIGN-W13 §4 "Plans"): the one tree Plan › Step › Task, grouped by plan, by Task status (the old All
// tasks board) or by area (the old By area list), with the old Overlap tab as a warning on the rows that overlap. Pure,
// so the node-only test suite reaches it; views/PlansView.tsx draws the rows. Also the `#task-<id>` / `#settings`
// anchors that the plan tab scrolls to.
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { JobRow, JobTask } from '../../../../core/types'
import { jobName } from '../../lib/jobName'
import { ageOf, areaGroupsOf, categoryOf, planListOrder, type PlanSection } from './planBoard'
import { finishedAtMs, lastActivityOf } from './planList'

type T = (key: MessageKey, params?: MessageParams) => string

export const GROUP_BYS = ['plans', 'status', 'area'] as const
export type GroupBy = (typeof GROUP_BYS)[number]
export const groupByOf = (v: string | null): GroupBy => (GROUP_BYS as readonly string[]).includes(v ?? '') ? (v as GroupBy) : 'plans'

/** The old All tasks columns, as groups: a person's part first, then what moves, what waits, and how it ended. */
export const STATUS_GROUPS = ['needs', 'running', 'waiting', 'done', 'failed'] as const
export type StatusGroup = (typeof STATUS_GROUPS)[number]

export function statusGroupOf(task: JobTask): StatusGroup {
  if (task.status === 'blocked' || task.gate) return 'needs'
  switch (categoryOf(task)) {
    case 'running':
    case 'awaiting-review':
      return 'running'
    case 'failed':
      return 'failed'
    case 'done':
    case 'cancelled':
      return 'done'
    default:
      return 'waiting'
  }
}

export type PlanNode =
  | { kind: 'group'; key: string }
  | { kind: 'plan'; row: JobRow }
  | { kind: 'step'; row: JobRow; step: number }
  | { kind: 'task'; row: JobRow; task: JobTask }

export interface PlanTreeRow {
  /** Unique in the tree: the path of ids from the root, so a plan under a group has its own id there. */
  id: string
  depth: number
  node: PlanNode
  hasChildren: boolean
  expanded: boolean
}

/** Groups and steps start open, plans closed (a plan's Tasks are one click away, the list stays a list). */
export const openByDefault = (node: PlanNode): boolean => node.kind !== 'plan'

/** A plan's steps (Task.wave), in order. One step or none known (an older Runtime): no step level at all. */
export function stepsOf(row: JobRow): { step: number; tasks: JobTask[] }[] {
  const by = new Map<number, JobTask[]>()
  for (const task of row.tasks) {
    if (task.wave === undefined) return []
    by.set(task.wave, [...(by.get(task.wave) ?? []), task])
  }
  return by.size < 2 ? [] : [...by].sort(([a], [b]) => a - b).map(([step, tasks]) => ({ step, tasks }))
}

export interface TreeQuery {
  rows: readonly JobRow[]
  groupBy: GroupBy
  /** Text the plan name or a Task title must hold (any case); empty: everything. */
  filter: string
  showArchived: boolean
  /** Group by plan only: list the rows in the order given (the Finished pane's newest-first), not by planListOrder. */
  keepOrder?: boolean
  /** Whether the row with this id is open; ignored while a filter forces the matches open. */
  isOpen: (id: string, node: PlanNode) => boolean
}

/** The visible rows, flattened for `Tree`: parents first, closed subtrees left out. */
export function planTreeRows({ rows, groupBy, filter, showArchived, keepOrder = false, isOpen }: TreeQuery): PlanTreeRow[] {
  const q = filter.trim().toLowerCase()
  const has = (text: string): boolean => text.toLowerCase().includes(q)
  const plans = rows.filter((r) => showArchived || r.archivedAt === undefined)
  const out: PlanTreeRow[] = []
  const push = (id: string, depth: number, node: PlanNode, hasChildren: boolean, forced: boolean): boolean => {
    const expanded = hasChildren && (forced || isOpen(id, node))
    out.push({ id, depth, node, hasChildren, expanded })
    return expanded
  }

  // A plan, its rounds (a schedule's Runs) or its steps, then its Tasks. A filter keeps the plan whose name matches
  // whole, and of the others only the Tasks that match, opened down to them.
  const plan = (row: JobRow, parent: string, depth: number, parentHit = false): void => {
    const nameHit = q === '' || parentHit || has(jobName(row))
    const kids = row.children ?? []
    const tasks = nameHit ? row.tasks : row.tasks.filter((t) => has(t.title))
    const rounds = nameHit ? kids : kids.filter((k) => k.tasks.some((t) => has(t.title)))
    if (!nameHit && tasks.length === 0 && rounds.length === 0) return
    const id = `${parent}plan:${row.id}`
    const forced = !nameHit
    if (!push(id, depth, { kind: 'plan', row }, kids.length > 0 || row.tasks.length > 0, forced)) return
    if (kids.length > 0) {
      for (const kid of rounds) plan(kid, `${id}/`, depth + 1, nameHit)
      return
    }
    const steps = stepsOf(row)
    if (steps.length === 0) {
      for (const task of tasks) push(`${id}/task:${task.id}`, depth + 1, { kind: 'task', row, task }, false, false)
      return
    }
    for (const { step, tasks: all } of steps) {
      const shown = all.filter((t) => tasks.includes(t))
      if (shown.length === 0) continue
      const stepId = `${id}/step:${step}`
      if (!push(stepId, depth + 1, { kind: 'step', row, step }, true, forced)) continue
      for (const task of shown) push(`${stepId}/task:${task.id}`, depth + 2, { kind: 'task', row, task }, false, false)
    }
  }

  if (groupBy === 'plans') {
    for (const row of keepOrder ? plans : planListOrder(plans)) plan(row, '', 0)
    return out
  }
  if (groupBy === 'area') {
    for (const g of areaGroupsOf(plans)) {
      const id = `area:${g.area}`
      const at = out.length
      const open = push(id, 0, { kind: 'group', key: g.area }, true, q !== '')
      const before = out.length
      if (open) for (const row of g.rows) plan(row, `${id}/`, 1)
      // a group the filter emptied goes
      if (open && q !== '' && out.length === before) out.splice(at, 1)
    }
    return out
  }
  // status: every Task of the live plans (a schedule's own rounds are listed under it in the other groupings)
  const live = planListOrder(plans).flatMap((row) => (row.children?.length ? row.children : [row]))
  for (const key of STATUS_GROUPS) {
    const tasks = live.flatMap((row) => row.tasks.filter((t) => statusGroupOf(t) === key && (q === '' || has(t.title) || has(jobName(row)))).map((task) => ({ row, task })))
    if (tasks.length === 0) continue
    const id = `status:${key}`
    if (!push(id, 0, { kind: 'group', key }, true, q !== '')) continue
    for (const { row, task } of tasks) push(`${id}/task:${row.id}:${task.id}`, 1, { kind: 'task', row, task }, false, false)
  }
  return out
}

/** How many Tasks of a group row's subtree there are, for its badge. */
export function groupCount(rows: readonly JobRow[], groupBy: GroupBy, key: string, showArchived: boolean): number {
  const plans = rows.filter((r) => showArchived || r.archivedAt === undefined)
  if (groupBy === 'area') return areaGroupsOf(plans).find((g) => g.area === key)?.rows.length ?? 0
  return plans.flatMap((r) => (r.children?.length ? r.children : [r])).reduce((n, r) => n + r.tasks.filter((t) => statusGroupOf(t) === key).length, 0)
}

/** How many of the plan's Tasks wait on a person (a question, a gate): the row's badge. */
export const needsYouOf = (row: JobRow): number => row.tasks.filter((t) => statusGroupOf(t) === 'needs').length

/** A plan row's dim line: "step 2/3 · 4/7 done · 3h ago", each part only when known. */
export function planDescription(row: JobRow, nowMs: number, t: T): string {
  const last = lastActivityOf(row)
  return [
    row.wave && row.wave.of > 1 ? t('pages.plans.tree.stepOf', { at: row.wave.at, of: row.wave.of }) : null,
    row.total > 0 ? t('pages.plans.progress', { done: row.done, total: row.total }) : null,
    last !== undefined ? t('pages.plans.age', { age: ageOf(new Date(last).toISOString(), nowMs) }) : null
  ]
    .filter((s): s is string => s !== null)
    .join(' · ')
}

/** A finished plan row's dim line: "4/7 done · finished 2h ago"; the finish time replaces the last-activity age. */
export function finishedDescription(row: JobRow, nowMs: number, t: T): string {
  const at = finishedAtMs(row)
  return [
    row.total > 0 ? t('pages.plans.progress', { done: row.done, total: row.total }) : null,
    at !== undefined ? t('pages.plans.finishedAge', { age: ageOf(new Date(at).toISOString(), nowMs) }) : null
  ]
    .filter((s): s is string => s !== null)
    .join(' · ')
}

/** A Task row's dim line: its account and, after the first, its attempts. */
export function taskDescription(task: JobTask, accountLabel: (id: string) => string, t: T): string {
  const account = task.accountId ?? task.accountIds?.[0]
  const attempts = task.attempts ?? 0
  return [account !== undefined ? accountLabel(account) : null, attempts > 1 ? t('pages.plans.tree.attempts', { n: attempts }) : null]
    .filter((s): s is string => s !== null)
    .join(' · ')
}

/** The overlap a row is decorated with (the old Overlap tab): the other plans' names, or null. A plan row names the
 *  plans it shares files with; a Task row the plan whose lease it waits for. */
export function overlapOf(node: PlanNode, rows: readonly JobRow[]): string[] | null {
  if (node.kind === 'plan') {
    const names = (node.row.overlapPlans ?? []).map((id) => rows.find((r) => r.id === id)).map((r, i) => (r ? jobName(r) : (node.row.overlapPlans ?? [])[i]))
    return names.length > 0 ? names : null
  }
  if (node.kind === 'task') {
    const reason = node.task.board?.reason
    return reason?.kind === 'same-files' && reason.plan ? [reason.plan.title] : null
  }
  return null
}

/** The plan context menu's Pause / Resume, as the plan tab's header button decides it (PlanHeader pauseButton): a
 *  schedule pauses and resumes (pauseRun / resumeRun), another live plan holds and releases new agents (holdJob). */
export type PauseAction = 'pause-schedule' | 'resume-schedule' | 'hold' | 'release'
export function pauseActionOf(row: JobRow): PauseAction | null {
  if (row.archivedAt !== undefined || row.pendingStart || row.outcome === 'completed') return null
  if (row.schedule) return row.paused ? 'resume-schedule' : 'pause-schedule'
  return row.dispatchHold ? 'release' : 'hold'
}

/** The plan tab section of a Task: `openPlan(jobId, taskSection(id))` scrolls the tab to it (planPage.ts planAnchorOf). */
export const taskSection = (taskId: string): PlanSection => `task-${taskId}`
