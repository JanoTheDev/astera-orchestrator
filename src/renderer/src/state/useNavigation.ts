// App's handlers behind components/shell/navigation.ts. W9-B: pages are real now (state/useSidebar.ts `page`, shown
// by components/shell/Pages.tsx); the page prompts (W9-C/D/E/H/J) replace their own handler, not the callers.
// Re-registered after every render so a handler always reads the latest state.
import { useEffect } from 'react'
import { sessionTab } from '../../../core/panes/tabId'
import { registerNavigation } from '../components/shell/navigation'
import type { AppState } from './appState'

type NavigationDeps = Pick<
  AppState,
  | 'goPage' | 'setShowSettings' | 'setSettingsTab' | 'setRunPanelOpen'
  | 'canOpenSessionTab' | 'setWorkspaceScope' | 'selectWorkbenchTab' | 'workspaceTree' | 'enterWorkspace' | 'setPendingRun'
>

export function useNavigation(app: NavigationDeps): void {
  useEffect(() => {
    const {
      goPage, setShowSettings, setSettingsTab, setRunPanelOpen, canOpenSessionTab, setWorkspaceScope, selectWorkbenchTab,
      workspaceTree, enterWorkspace, setPendingRun
    } = app
    return registerNavigation({
      openPage: (id) => {
        // Settings is still the modal until W9-E's page lands
        if (id === 'settings') return setShowSettings(true)
        // Run configs come with their output drawer (DESIGN.md §1)
        if (id === 'more:runs') setRunPanelOpen(true)
        goPage(id)
      },
      // the same path the workspace tree's session rows took, on the Agents page
      openConsole: (sessionId) => {
        if (!canOpenSessionTab(sessionId)) return
        goPage('agents')
        setWorkspaceScope(null, null)
        selectWorkbenchTab(sessionTab(sessionId))
      },
      // the same path the workspace tree's escalation row took (W7-C): the plan's window over the Plans page, which
      // loads the snapshot it reads; `section` has no target until W9-C's plan page
      openPlan: (jobId) => {
        const project = workspaceTree.find((p) => p.plans.some((plan) => plan.jobId === jobId))
        if (!project) return
        enterWorkspace(project.id, jobId)
        goPage('plans')
        setPendingRun({ projectPath: project.path, runId: jobId })
      },
      // no filter until W9-D's Inbox
      openInbox: () => goPage('inbox'),
      // no per-path view until W9-J's Worktrees page
      openWorktree: () => goPage('worktrees'),
      // the settings modal has no anchors yet
      openSettings: (group) => {
        setSettingsTab(group)
        setShowSettings(true)
      }
    })
  })
}
