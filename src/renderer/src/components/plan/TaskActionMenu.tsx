// How the actions of taskActions.ts are drawn: the buttons of a Board row or the Task detail, and the right-click menu of a
// row or Graph node. Drawing only; what an action does is taskActionRun.ts's.
import type { JobTask } from '../../../../core/types'
import type { MessageKey } from '../../../../core/i18n'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Icon, IconButton, type IconName, type MenuItem } from '../ui'
import { taskActionsOf, type TaskActionCtx, type TaskActionId } from './taskActions'

export type OnTaskAction = (id: TaskActionId, task: JobTask) => void

const VIEW: Record<TaskActionId, { label: MessageKey; icon: IconName; danger?: true }> = {
  start: { label: 'jobs.node.start', icon: 'run' },
  ask: { label: 'plan.graph.gate', icon: 'lock' },
  stop: { label: 'jobs.node.stop', icon: 'stop' },
  holdWorker: { label: 'plan.taskMenu.pauseWorker', icon: 'pause' },
  unholdWorker: { label: 'plan.taskMenu.resumeWorker', icon: 'run' },
  stopAutoFix: { label: 'jobs.convergence.stop', icon: 'stopFix' },
  continue: { label: 'plan.task.continue', icon: 'refresh' },
  retry: { label: 'plan.task.retry', icon: 'refresh' },
  restart: { label: 'jobs.node.restart', icon: 'refresh' },
  acceptFailed: { label: 'plan.failedWait.accept', icon: 'done' },
  cancelFailed: { label: 'plan.failedWait.cancel', icon: 'close', danger: true },
  askAbout: { label: 'plan.done.ask', icon: 'terminal' },
  edit: { label: 'plan.task.edit', icon: 'edit' },
  openConsole: { label: 'plan.row.openConsole', icon: 'open' },
  openWorktree: { label: 'plan.taskMenu.openWorktree', icon: 'branch' },
  reveal: { label: 'plan.taskMenu.reveal', icon: 'folder' },
  copyId: { label: 'pages.plans.tree.menu.copyId', icon: 'copy' }
}

/** The right-click menu's items for a Task: every action it has, the ones that only look or copy after a separator. */
export function taskMenuItems(
  task: JobTask,
  ctx: TaskActionCtx,
  t: (key: MessageKey) => string,
  lockedReason: string | undefined,
  onAction: OnTaskAction
): Array<MenuItem | 'separator'> {
  const items: Array<MenuItem | 'separator'> = []
  let sawHarmless = false
  for (const a of taskActionsOf(task, ctx)) {
    if (!a.mutates && !sawHarmless && items.length > 0) items.push('separator')
    if (!a.mutates) sawHarmless = true
    const v = VIEW[a.id]
    items.push({
      id: a.id,
      label: t(v.label),
      icon: <Icon name={v.icon} />,
      ...(v.danger ? { danger: true } : {}),
      disabled: a.mutates && lockedReason !== undefined,
      onSelect: () => onAction(a.id, task)
    })
  }
  return items
}

/** The buttons for `ids` (those the Task has, in the helper's order). `iconOnly` is the Board row's compact form. */
export function TaskActionButtons({
  task,
  ctx,
  ids,
  iconOnly = false,
  lockedReason,
  onAction
}: {
  task: JobTask
  ctx: TaskActionCtx
  ids: readonly TaskActionId[]
  iconOnly?: boolean
  lockedReason?: string
  onAction: OnTaskAction
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <>
      {taskActionsOf(task, ctx)
        .filter((a) => ids.includes(a.id))
        .map((a) => {
          const v = VIEW[a.id]
          const label = t(v.label)
          const disabled = a.mutates && lockedReason !== undefined
          const icon = <Icon name={v.icon} size={14} />
          const onClick = (ev: React.MouseEvent): void => {
            ev.stopPropagation()
            onAction(a.id, task)
          }
          return iconOnly ? (
            <IconButton key={a.id} size="sm" className="plan-row-action" label={label} title={lockedReason ?? label} disabled={disabled} icon={icon} onClick={onClick} />
          ) : (
            <Button key={a.id} size="sm" disabled={disabled} title={lockedReason} icon={icon} onClick={onClick}>
              {label}
            </Button>
          )
        })}
    </>
  )
}
