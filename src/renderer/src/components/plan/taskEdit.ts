// T2 Task details: what the owner may change about a Task now, and the change itself. The rules mirror the Host's
// editPlanTask (core/orchestration/planner.ts): a plan not yet started takes any field; in a running plan the owner
// changes any field while the Task has not started (pending, ready or blocked, never dispatched), only its acceptance
// criteria once it has, and nothing once it finished. The Host still decides: this only draws the form to match.
import type { Task } from '../../../../core/orchestration/types'
import { isTerminal } from '../../../../core/orchestration/running'
import type { OrchDoor } from '../../lib/orchDoor'

/** The fields the edit form offers, by their `task-update` argument name. */
export const EDIT_FIELDS = ['title', 'spec', 'prompt', 'criteria', 'deps', 'kind', 'difficulty', 'effort', 'affectedPaths'] as const
export type EditField = (typeof EDIT_FIELDS)[number]

/** What can be edited now: everything, the criteria only (and why), or nothing (and why). */
export type TaskEdit =
  | { fields: 'all' }
  | { fields: 'criteria'; reason: 'plan.edit.why.started' | 'plan.edit.why.notRunning' }
  | { fields: 'none'; reason: 'plan.edit.why.finished' }

/** The Task as `taskEditOf` reads it: its full record and how many Dispatches it ever had. */
export type EditableTask = Pick<Task, 'status' | 'runId' | 'consecutiveFailures'> & { dispatches: number }

/** `plan.outcome`: its Run's outcome (`runs-get`); absent for a plan not yet started (the Task has no Run). */
export function taskEditOf(task: EditableTask, plan: { outcome?: string }): TaskEdit {
  if (task.runId === undefined) return { fields: 'all' }
  // isTerminal reads only the status and the failure count
  if (isTerminal(task as unknown as Task)) return { fields: 'none', reason: 'plan.edit.why.finished' }
  // runs-get says `paused` for a paused Run; the Host's outcomeOf does not see the pause, so it is still running there
  const running = plan.outcome === 'running' || plan.outcome === 'paused'
  if (!running) return { fields: 'criteria', reason: 'plan.edit.why.notRunning' }
  const notStarted = (task.status === 'pending' || task.status === 'ready' || task.status === 'blocked') && task.dispatches === 0
  return notStarted ? { fields: 'all' } : { fields: 'criteria', reason: 'plan.edit.why.started' }
}

export const canEdit = (edit: TaskEdit, field: EditField): boolean =>
  edit.fields === 'all' || (edit.fields === 'criteria' && field === 'criteria')

/** The edit form's values: the list fields as text, one entry per line. Empty kind, difficulty and effort are "not set". */
export interface TaskDraft {
  title: string
  spec: string
  prompt: string
  criteria: string
  deps: string[]
  kind: string
  difficulty: string
  effort: string
  affectedPaths: string
}

export const lines = (text: string): string[] => text.split('\n').map((l) => l.trim()).filter((l) => l !== '')

export function draftOf(t: Partial<Task> & Pick<Task, 'title' | 'spec' | 'deps'>): TaskDraft {
  return {
    title: t.title,
    spec: t.spec,
    prompt: t.prompt ?? '',
    criteria: (t.acceptanceCriteria ?? []).join('\n'),
    deps: [...t.deps],
    kind: t.kind ?? '',
    difficulty: t.difficulty ?? '',
    effort: t.effort ?? '',
    affectedPaths: (t.affectedPaths ?? []).join('\n')
  }
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/** The `task-update` arguments for what the owner changed, and only that: a field sent unchanged to a started Task
 *  would be refused. A field the Host cannot clear (an emptied prompt, kind, difficulty or effort) is left out; the Host
 *  refuses empty criteria itself. Empty when nothing changed. */
export function editArgsOf(before: TaskDraft, after: TaskDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const text = (k: 'title' | 'spec' | 'prompt' | 'kind' | 'difficulty' | 'effort'): void => {
    const v = after[k].trim()
    if (v !== before[k].trim() && v !== '') out[k] = v
  }
  text('title')
  text('spec')
  text('prompt')
  if (!sameList(lines(after.criteria), lines(before.criteria))) out.criteria = lines(after.criteria)
  if (!sameList(after.deps, before.deps)) out.deps = after.deps
  text('kind')
  text('difficulty')
  text('effort')
  if (!sameList(lines(after.affectedPaths), lines(before.affectedPaths))) out.affectedPaths = lines(after.affectedPaths)
  return out
}

/** The `task-create` plan fields of the new-Task form: only those filled in. */
export function createArgsOf(prompt: string, criteria: string, kind: string): Record<string, unknown> {
  return {
    ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
    ...(lines(criteria).length > 0 ? { criteria: lines(criteria) } : {}),
    ...(kind ? { kind } : {})
  }
}

/** A change request on one Task for `jobs-feedback`: the planner reads which Task it is about by its title and id. */
export function feedbackTextOf(task: { id: string; title: string }, text: string): string {
  return `Request changes on Task "${task.title}" (${task.id}):\n\n${text.trim()}`
}

/** The Add task window's first screen: the planner's box when the plan has a planner, else the manual form. */
export const taskModeOf = (planned: boolean | undefined): 'ai' | 'manual' => (planned === true ? 'ai' : 'manual')

/** "Place it after: …" for the Tasks the window opened with as dependencies, so the planner puts the new Task behind them. Empty when none. */
export function placementLineOf(deps: readonly string[], tasks: readonly { id: string; title: string }[]): string {
  if (deps.length === 0) return ''
  const names = deps.map((id) => {
    const title = tasks.find((x) => x.id === id)?.title
    return title ? `"${title}" (${id})` : id
  })
  return `Place it after: ${names.join(', ')}`
}

/** The Add task window's text for `jobs-feedback`: the typed Task as a request to add it, with where to place it. */
export function addTaskRequestOf(title: string, spec: string, placement = ''): string {
  return [`Add a task to the plan${title.trim() ? `: "${title.trim()}"` : ''}.`, '', spec.trim(), ...(placement ? ['', placement] : [])].join('\n')
}

/** One attempt as `tasks-get` lists it (core/orchestration/taskDetail.ts TaskAttempt, which the web build does not
 *  take in: it reads the CLI's field list): the fields the row draws. */
export interface TaskAttempt {
  id: string
  accountId: string
  repair?: string
  review?: true
  outcome?: 'succeeded' | 'failed'
  startedAt: string
  endedAt?: string
}

/** How an attempt ended: its outcome, `stopped` when it ended without one (a pause, a lost worker), else `running`. */
export const attemptStateOf = (a: Pick<TaskAttempt, 'outcome' | 'endedAt'>): 'succeeded' | 'failed' | 'stopped' | 'running' =>
  a.outcome ?? (a.endedAt !== undefined ? 'stopped' : 'running')

/** Everything the expanded row shows of a Task: its full record, its attempts and its Run's outcome. */
export interface TaskInfo {
  task: Task
  attempts: TaskAttempt[]
  outcome?: string
}

/** Reads a Task for its expanded row: `tasks-get` (its attempts and its plan or Run), then that plan's full Tasks
 *  (`tasks-list`: tasks-get carries the public fields only, without the prompt or criteria) and its Run's outcome.
 *  Null when any read is refused. */
export async function loadTaskInfo(door: Pick<OrchDoor, 'command'>, id: string): Promise<TaskInfo | null> {
  const got = await door.command('tasks-get', { id })
  if (got.status >= 400) return null
  const detail = got.body as { runId?: string; jobId?: string; attempts?: TaskAttempt[] }
  const scope = detail.runId ?? detail.jobId
  if (scope === undefined) return null
  const [list, run] = await Promise.all([
    door.command('tasks-list', { run: scope }),
    detail.runId !== undefined ? door.command('runs-get', { id: detail.runId }) : Promise.resolve(null)
  ])
  const task = list.status < 400 && Array.isArray(list.body) ? (list.body as Task[]).find((t) => t.id === id) : undefined
  if (task === undefined) return null
  const outcome = run !== null && run.status < 400 ? (run.body as { outcome?: unknown }).outcome : undefined
  return { task, attempts: detail.attempts ?? [], ...(typeof outcome === 'string' ? { outcome } : {}) }
}
