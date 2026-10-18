// W9-A: App's handlers behind components/shell/navigation.ts — today's paths, until the 9.2 pages
// replace them. Re-registered after every render so a handler always reads the latest state.
import { useEffect } from 'react'
import type { PageId } from '../../../core/ui/pages'
import { sessionTab } from '../../../core/panes/tabId'
import { registerNavigation } from '../components/shell/navigation'
import { settingsTarget } from '../components/settings/settingsIndex'
import type { AppState } from './appState'

type NavigationDeps = Pick<
  AppState,
  | 'sidebarOpen' | 'sidebarPane' | 'toggleSidebar' | 'showExplorer' | 'setShowSettings' | 'setSettingsTab' | 'setSettingsAnchor' | 'setRunPanelOpen'
  | 'canOpenSessionTab' | 'setWorkspaceScope' | 'selectWorkbenchTab' | 'workspaceTree' | 'enterWorkspace' | 'setJobsOpen'
  | 'setPendingRun'
>

export function useNavigation(app: NavigationDeps): void {
  useEffect(() => {
    const {
      sidebarOpen, sidebarPane, toggleSidebar, showExplorer, setShowSettings, setSettingsTab, setSettingsAnchor, setRunPanelOpen,
      canOpenSessionTab, setWorkspaceScope, selectWorkbenchTab, workspaceTree, enterWorkspace, setJobsOpen, setPendingRun
    } = app
    // Shows a sidebar view; the rail's toggle would fold the sidebar when that view is already showing.
    const showView = (view: 'jobs' | 'understanding' | 'sessions'): void => {
      if (!(sidebarOpen && sidebarPane === view)) toggleSidebar(view)
    }
    const openPage = (id: PageId): void => {
      if (id === 'files') showExplorer()
      else if (id === 'plans' || id === 'tasks') showView('jobs')
      else if (id === 'more:hiw') showView('understanding')
      else if (id === 'settings') setShowSettings(true)
      else if (id === 'more:runs') setRunPanelOpen(true)
      else if (id === 'more:browser') console.warn('navigation.openPage: no browser page yet; a browser tab opens from a link')
      // agents, inbox (escalation rows), worktrees (WorktreePanel), more:history (HistoryBrowser): the session list
      else showView('sessions')
    }
    return registerNavigation({
      openPage,
      // the same path the workspace tree's session rows take
      openConsole: (sessionId) => {
        if (!canOpenSessionTab(sessionId)) return
        setWorkspaceScope(null, null)
        selectWorkbenchTab(sessionTab(sessionId))
      },
      // the same path the workspace tree's escalation row takes (W7-C); `section` has no target yet
      openPlan: (jobId) => {
        const project = workspaceTree.find((p) => p.plans.some((plan) => plan.jobId === jobId))
        if (!project) return
        enterWorkspace(project.id, jobId)
        setJobsOpen(true)
        setPendingRun({ projectPath: project.path, runId: jobId })
      },
      // needs-input shows as escalation rows in the session list's workspace tree; no filter yet
      openInbox: () => openPage('inbox'),
      // the WorktreePanel lives in the session list; it has no per-path view yet
      openWorktree: () => openPage('worktrees'),
      // W9-E: the Settings page scrolls to the anchor's row and clears it
      openSettings: (group, anchor) => {
        const target = settingsTarget(group, anchor)
        setSettingsTab(target.group)
        setSettingsAnchor(target.anchor)
        setShowSettings(true)
      }
    })
  })
}
