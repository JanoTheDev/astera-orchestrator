// W7-F (#84): the quick tab switcher's filter. The ranking is search's (sessionIndex.ts rankByFields), so `hw1` finds
// "Hold Worker 1" here as it does in the sidebar search. Pure, for vitest's node environment.
import { rankByFields } from '../../../core/orchestration/sessionIndex'

export interface SwitcherTab {
  tabId: string
  /** What the tab strip shows. */
  title: string
  /** A plan session's tree label ("Hold Worker 1"), its plan, its Task and its project, when it is one. */
  label?: string
  planName?: string
  taskTitle?: string
  projectName?: string
}

const fieldsOf = (t: SwitcherTab): string[] =>
  [t.title, t.label ?? '', t.taskTitle ?? '', t.planName ?? '', t.projectName ?? ''].map((f) => f.toLowerCase())

/** The tabs `query` asks for, best first. An empty query lists every tab in strip order. */
export function filterSwitcherTabs(tabs: readonly SwitcherTab[], query: string): SwitcherTab[] {
  return query.trim() === '' ? [...tabs] : rankByFields(tabs, query, fieldsOf, Infinity)
}
