// The actions one Task offers, by its state: the Board row's buttons, the Task detail's buttons and the right-click menu of
// a row or Graph node all read this one list, so they cannot disagree. The rules themselves stay where they were
// (planCommands taskActionOf, core nodeMeta canStopConvergence, taskDoneView doneViewOf); this only orders them. Pure.
import type { JobTask } from '../../../../core/types'
import { canStopConvergence } from '../../../../core/orchestration/nodeMeta'
import { taskActionOf } from './planCommands'
import { doneViewOf } from './taskDoneView'

export type TaskActionId =
  | 'start'
  | 'ask'
  | 'stop'
  | 'holdWorker'
  | 'unholdWorker'
  | 'stopAutoFix'
  | 'continue'
  | 'retry'
  | 'restart'
  | 'acceptFailed'
  | 'cancelFailed'
  | 'askAbout'
  | 'edit'
  | 'openConsole'
  | 'openWorktree'
  | 'reveal'
  | 'terminal'
  | 'copyId'

/** `mutates`: changes the plan, so a read-only pairing (`lockedReason`) turns it off. The rest only look or copy. */
export interface TaskAction {
  id: TaskActionId
  mutates: boolean
}

export interface TaskActionCtx {
  /** The plan lets the owner start one Task by hand (planPage canManualStartOf). */
  canManualStart: boolean
  /** The Task's session has a tab to go to. */
  consoleOpen: boolean
}

const mutating = (id: TaskActionId): TaskAction => ({ id, mutates: true })
const harmless = (id: TaskActionId): TaskAction => ({ id, mutates: false })

export function taskActionsOf(task: JobTask, ctx: TaskActionCtx): TaskAction[] {
  const notStarted = task.status === 'ready' || task.status === 'pending'
  // A Dispatch is open only while `provider` is set (PlanGraph's own signal): that is what Stop and Pause act on.
  const running = task.status === 'dispatched' && task.provider !== undefined
  const restart = taskActionOf(task)
  const out: TaskAction[] = []
  // A Task with no account has no provider to start on (the Graph's rule), so no Start.
  if (notStarted && ctx.canManualStart && (task.accountIds?.length ?? 0) > 0) out.push(mutating('start'))
  if (notStarted) out.push(mutating('ask'))
  if (running) out.push(mutating('stop'))
  // shortcut: the snapshot does not say whether the worker is paused, so a running Task offers both; the Host refuses the
  // one that does not apply. Upgrade when JobTask carries Dispatch.held.
  if (running) out.push(mutating('holdWorker'), mutating('unholdWorker'))
  if (canStopConvergence(task)) out.push(mutating('stopAutoFix'))
  if (restart !== undefined) out.push(mutating(restart))
  // The Host accepts any failed Task with no worker on it (replan.ts resolveFailedWait), not only a stalled plan's
  if (task.status === 'failed') out.push(mutating('acceptFailed'), mutating('cancelFailed'))
  if (doneViewOf(task).ask) out.push(mutating('askAbout'))
  if (task.status !== 'completed') out.push(harmless('edit'))
  if (task.sessionId !== undefined && ctx.consoleOpen) out.push(harmless('openConsole'))
  // The worktree is found by its branch (the registry), as the row's branch button does
  if (task.branch !== undefined) out.push(harmless('openWorktree'), harmless('reveal'), harmless('terminal'))
  out.push(harmless('copyId'))
  return out
}
