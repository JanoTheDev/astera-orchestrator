// The one way to move around the app (PLAN.md "Wave 9 contracts"). App registers its handlers once
// (state/useNavigation.ts); the exported functions forward to them. W9-A ships stubs that call
// today's paths (the sidebar views, RunDetail, the settings modal); the 9.2 pages replace the handlers,
// not the callers.
import { setAgentsPlan } from '../views/agentsPlan'
import type { ActivityId, PanelTab } from '../../../../core/ui/pages'
import type { ViewName } from '../../../../core/panes/tabId'
import type { useSettings } from '../../state/useSettings'
import type { OldSettingsTab } from '../settings/settingsIndex'

/** A Settings page group (DESIGN §7, W9-E). */
export type SettingsGroup = ReturnType<typeof useSettings>['settingsTab']

export interface NavigationHandlers {
  /** DESIGN-W13: shows that side bar view (and the side bar). */
  openActivity: (id: ActivityId) => void
  /** Opens the `view:<name>[:<arg>]` editor tab, or focuses the one already open (placeViewTab). */
  openView: (name: ViewName, arg?: string) => void
  /** Shows the bottom panel on that tab. */
  openPanel: (tab: PanelTab) => void
  /** Ctrl+B and Ctrl+J. */
  toggleSideBar: () => void
  togglePanel: () => void
  openConsole: (sessionId: string) => void
  openPlan: (jobId: string, section?: string) => void
  openInbox: (filter?: string) => void
  openWorktree: (path: string) => void
  /** An old tab name still lands right: it maps to its group and row (settingsTarget). */
  openSettings: (group: SettingsGroup | OldSettingsTab, anchor?: string) => void
  /** T7 review: a file in an editor tab at a line, as a terminal link opens it. */
  openFile: (path: string, at?: { line: number }) => void
  /** T7 review: a new agent session in `cwd` on the Auto account, its tab opened (the New session dialog's spawn).
   *  Answers its id, or null when it did not start (the spawn already said why). */
  startSession: (cwd: string, kind: 'chat') => Promise<string | null>
  /** A new shell in `cwd` (a Task's worktree), its tab added to the bottom panel and shown. */
  openTerminalAt: (cwd: string) => Promise<void>
}

let current: NavigationHandlers | null = null

/** Installs the handlers; the returned function removes them again (only if they are still the ones installed). */
export function registerNavigation(handlers: NavigationHandlers): () => void {
  current = handlers
  return () => {
    if (current === handlers) current = null
  }
}

function forward<K extends keyof NavigationHandlers>(name: K, ...args: Parameters<NavigationHandlers[K]>): void {
  if (!current) {
    console.warn(`navigation.${name}: no handlers registered`)
    return
  }
  ;(current[name] as (...a: Parameters<NavigationHandlers[K]>) => void)(...args)
}

export const openActivity = (id: ActivityId): void => forward('openActivity', id)
/** run.selectConfig: reveals the Run view in the side bar, then raises the flag RunView reads on mount (or at once, when
 *  it is already showing) to put the keyboard on its configuration list. */
export const revealRunConfigs = (raise: () => void): void => {
  openActivity('run')
  raise()
}
export const openView = (name: ViewName, arg?: string): void => (arg === undefined ? forward('openView', name) : forward('openView', name, arg))
export const openPanel = (tab: PanelTab): void => forward('openPanel', tab)
export const toggleSideBar = (): void => forward('toggleSideBar')
export const togglePanel = (): void => forward('togglePanel')
/** A plan's "Its consoles": the Agents side bar, filtered to that plan (a Run id is its Job id). */
export const openPlanConsoles = (plan: string): void => {
  openActivity('agents')
  setAgentsPlan(plan)
}
export const openConsole = (sessionId: string): void => forward('openConsole', sessionId)
export const openPlan = (jobId: string, section?: string): void => forward('openPlan', jobId, section)
export const openInbox = (filter?: string): void => forward('openInbox', filter)
export const openWorktree = (path: string): void => forward('openWorktree', path)
export const openFile = (path: string, at?: { line: number }): void => forward('openFile', path, at)
export const startSession = (cwd: string, kind: 'chat'): Promise<string | null> => {
  if (current) return current.startSession(cwd, kind)
  console.warn('navigation.startSession: no handlers registered')
  return Promise.resolve(null)
}
export const openTerminalAt = (cwd: string): Promise<void> => {
  if (current) return current.openTerminalAt(cwd)
  console.warn('navigation.openTerminalAt: no handlers registered')
  return Promise.resolve()
}
export const openSettings = (group: SettingsGroup | OldSettingsTab, anchor?: string): void => forward('openSettings', group, anchor)
