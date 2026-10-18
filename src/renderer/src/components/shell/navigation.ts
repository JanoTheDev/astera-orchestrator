// The one way to move around the app (PLAN.md "Wave 9 contracts"). App registers its handlers once
// (state/useNavigation.ts); the exported functions forward to them. W9-A ships stubs that call
// today's paths (the sidebar views, RunDetail, the settings modal); the 9.2 pages replace the handlers,
// not the callers.
import type { PageId } from '../../../../core/ui/pages'
import type { useSettings } from '../../state/useSettings'
import type { OldSettingsTab } from '../settings/settingsIndex'

/** A Settings page group (DESIGN §7, W9-E). */
export type SettingsGroup = ReturnType<typeof useSettings>['settingsTab']

export interface NavigationHandlers {
  openPage: (id: PageId) => void
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

export const openPage = (id: PageId): void => forward('openPage', id)
export const openConsole = (sessionId: string): void => forward('openConsole', sessionId)
export const openPlan = (jobId: string, section?: string): void => forward('openPlan', jobId, section)
export const openInbox = (filter?: string): void => forward('openInbox', filter)
export const openWorktree = (path: string): void => forward('openWorktree', path)
export const openSettings = (group: SettingsGroup | OldSettingsTab, anchor?: string): void => forward('openSettings', group, anchor)
