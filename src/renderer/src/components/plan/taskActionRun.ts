// What a Task action does (taskActions.ts says which are on offer). The plan page's own commands (start, stop, ask,
// stop auto-fix, restart) arrive as callbacks; the rest go through lib/jobActions and the window's api.
import type { JobTask } from '../../../../core/types'
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import type { Dispatch } from '../../../../core/orchestration/types'
import { holdWorker, resolveFailed, unholdWorker, type ActionUi } from '../../lib/jobActions'
import type { OrchDoor } from '../../lib/orchDoor'
import { toast } from '../../lib/toast'
import { openConsole, openTerminalAt, openWorktree } from '../shell/navigation'
import { askAboutTaskWithToast } from './planCommands'
import type { TaskActionId } from './taskActions'

export interface TaskActionRun {
  door: OrchDoor
  ui: ActionUi
  runId: string
  t: (key: MessageKey, params?: MessageParams) => string
  /** The plan page's commands (usePlanPage), which own their busy state and confirmations. */
  start: (taskId: string) => void
  stop: (taskId: string) => void
  ask: (taskId: string) => void
  stopAutoFix: (taskId: string) => void
  restart: (taskId: string) => void
  /** Expands the Task's row (where Edit lives). */
  show: (taskId: string) => void
}

/** The Task's worktree folder, found by its branch in the registry; null when it is gone. */
async function worktreePathOf(branch: string): Promise<string | null> {
  const list = await window.api.worktrees.list().catch(() => [])
  return list.find((w) => w.branch === branch)?.path ?? null
}

export async function runTaskAction(id: TaskActionId, task: JobTask, r: TaskActionRun): Promise<void> {
  switch (id) {
    case 'start': return r.start(task.id)
    case 'stop': return r.stop(task.id)
    case 'ask': return r.ask(task.id)
    case 'stopAutoFix': return r.stopAutoFix(task.id)
    case 'continue':
    case 'retry':
    case 'restart': return r.restart(task.id)
    case 'edit': return r.show(task.id)
    case 'copyId': return window.api.clipboard.writeText(task.id)
    case 'openConsole': return task.sessionId === undefined ? undefined : openConsole(task.sessionId)
    case 'acceptFailed':
    case 'cancelFailed':
      await resolveFailed(r.door, task.id, id === 'acceptFailed' ? 'accept' : 'cancel', r.ui)
      return
    case 'askAbout': return askAboutTaskWithToast(r.door, r.runId, task.id, r.t)
    case 'holdWorker':
    case 'unholdWorker': {
      // worker-hold wants the Dispatch id (as worker-stop does), so the Task's open one is looked up first
      const shown = await r.door.command('dispatch-show', { task: task.id })
      const open = shown.status < 400 ? (shown.body as Dispatch[]).find((d) => !d.outcome && !d.endedAt) : undefined
      if (!open) return void toast.error(r.t('plan.taskMenu.noWorker'))
      if (id === 'holdWorker') await holdWorker(r.door, open.id, task.title, r.ui)
      else await unholdWorker(r.door, open.id, r.ui)
      return
    }
    case 'openWorktree':
    case 'reveal':
    case 'terminal': {
      const path = task.branch === undefined ? null : await worktreePathOf(task.branch)
      if (path === null) return void toast.error(r.t('plan.taskMenu.noWorktree'))
      if (id === 'openWorktree') openWorktree(path)
      else if (id === 'reveal') await window.api.files.reveal(path)
      else await openTerminalAt(path)
      return
    }
  }
}
