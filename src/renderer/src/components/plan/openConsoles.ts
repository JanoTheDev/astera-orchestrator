// The plan header's "N consoles" chip: the jobs-view payload (JobRow.consoles) as the rows the popover lists. Pure; the
// words live in the i18n catalogs (plan.consoles.*), so this returns keys.
import type { ConsoleReason, ConsoleRole, OpenConsole } from '../../../../core/orchestration/openConsoles'

export interface ConsoleRowView {
  sessionId: string
  /** The Task's title; absent for a console without a Task (coordinator, planner) or one the plan no longer lists. */
  taskTitle?: string
  roleKey: `plan.consoles.role.${ConsoleRole}`
  reasonKey: `plan.consoles.reason.${ConsoleReason}`
  /** Reason `none`: nothing keeps this console, the driving loop closes it soon. */
  closesSoon: boolean
}

export interface ConsoleSummary {
  count: number
  /** `plan.consoles.one` or `plan.consoles.many` (placeholder `{count}`). */
  labelKey: 'plan.consoles.one' | 'plan.consoles.many'
  rows: ConsoleRowView[]
}

/** Undefined when the plan has no open console: the header shows no chip. */
export function consoleSummaryOf(
  consoles: { count: number; list: readonly OpenConsole[] } | undefined,
  titleOf: (taskId: string) => string | undefined
): ConsoleSummary | undefined {
  if (!consoles || consoles.list.length === 0) return undefined
  const rows = consoles.list.map((c): ConsoleRowView => ({
    sessionId: c.sessionId,
    taskTitle: c.taskId === undefined ? undefined : titleOf(c.taskId),
    roleKey: `plan.consoles.role.${c.role}`,
    reasonKey: `plan.consoles.reason.${c.reason}`,
    closesSoon: c.reason === 'none'
  }))
  return { count: rows.length, labelKey: rows.length === 1 ? 'plan.consoles.one' : 'plan.consoles.many', rows }
}
