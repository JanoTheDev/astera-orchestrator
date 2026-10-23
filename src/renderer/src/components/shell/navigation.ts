// The one way to move around the app (PLAN.md "Wave 9 contracts"). App registers its handlers once
// (state/useNavigation.ts); the exported functions forward to them. W9-A ships stubs that call
// today's paths (the sidebar views, RunDetail, the settings modal); the 9.2 pages replace the handlers,
// not the callers.
import { activityOfSaved, type ActivityId, type PageId, type PanelTab } from '../../../../core/ui/pages'
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
  /** `plan`: Agents opens filtered to that plan's consoles (W9-H plan pills). Kept for the old page ids: the handler
   *  maps them through pageTargetOf. */
  openPage: (id: PageId, plan?: string) => void
  openConsole: (sessionId: string) => void
  openPlan: (jobId: string, section?: string) => void
  openInbox: (filter?: string) => void
  openWorktree: (path: string) => void
  /** An old tab name still lands right: it maps to its group and row (settingsTarget). */
  openSettings: (group: SettingsGroup | OldSettingsTab, anchor?: string) => void
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

/** Where an old page id lands in the workbench (the openPage shim). Settings, Start-less pages and the Inbox are no
 *  longer side bar views: Settings is a view tab, the Inbox the panel's Needs you tab. */
export type PageTarget = { activity: ActivityId } | { view: ViewName } | { panel: PanelTab }
export function pageTargetOf(id: PageId): PageTarget {
  if (id === 'settings') return { view: 'settings' }
  const to = activityOfSaved(id)
  return to.panelTab ? { panel: to.panelTab } : { activity: to.activity }
}

export const openActivity = (id: ActivityId): void => forward('openActivity', id)
export const openView = (name: ViewName, arg?: string): void => (arg === undefined ? forward('openView', name) : forward('openView', name, arg))
export const openPanel = (tab: PanelTab): void => forward('openPanel', tab)
export const toggleSideBar = (): void => forward('toggleSideBar')
export const togglePanel = (): void => forward('togglePanel')
export const openPage = (id: PageId, plan?: string): void => (plan === undefined ? forward('openPage', id) : forward('openPage', id, plan))
export const openConsole = (sessionId: string): void => forward('openConsole', sessionId)
export const openPlan = (jobId: string, section?: string): void => forward('openPlan', jobId, section)
export const openInbox = (filter?: string): void => forward('openInbox', filter)
export const openWorktree = (path: string): void => forward('openWorktree', path)
export const openSettings = (group: SettingsGroup | OldSettingsTab, anchor?: string): void => forward('openSettings', group, anchor)
