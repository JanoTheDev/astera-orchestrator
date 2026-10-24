import { DEFAULT_ACTIVITY, type ActivityId } from '../../../core/ui/pages'

/** What can reach the side bar's view. Only the owner's own moves change it: a click on a view (activity bar,
 *  palette, Ctrl+1…6) and the old sidebar keys (`toggle`). A plan tab activated (openRun), a pushed snapshot, a plan
 *  page closed and a pending plan that resolves late keep the view the owner left. */
export type SidebarEvent =
  | { kind: 'click'; activity: ActivityId }
  | { kind: 'toggle'; activity: ActivityId }
  | { kind: 'openRun' | 'push' | 'planClose' | 'pendingPlan' }

/** The side bar's view after `event`. A toggle pressed on its own view goes back to Agents (core/ui/pages.ts togglePage). */
export function nextActivity(current: ActivityId, event: SidebarEvent): ActivityId {
  switch (event.kind) {
    case 'click':
      return event.activity
    case 'toggle':
      return current === event.activity ? DEFAULT_ACTIVITY : event.activity
    default:
      return current
  }
}
