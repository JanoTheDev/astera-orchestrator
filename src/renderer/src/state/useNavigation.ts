// App's handlers behind components/shell/navigation.ts. W9-B: pages are real now (state/useSidebar.ts `page`, shown
// by components/shell/Pages.tsx); the page prompts (W9-C/D/E/H/J) replace their own handler, not the callers.
// Re-registered after every render so a handler always reads the latest state.
import { useEffect } from 'react'
import { sessionTab } from '../../../core/panes/tabId'
import { registerNavigation } from '../components/shell/navigation'
import { requestInbox } from '../components/inbox/inboxNav'
import { settingsTarget } from '../components/settings/settingsIndex'
import { setWallView } from '../components/wall/wallView' // W9-H
import type { AppState } from './appState'
import { planSectionOf } from '../components/plan/planBoard'

type NavigationDeps = Pick<
  AppState,
  | 'goPage' | 'setShowSettings' | 'setSettingsTab' | 'setSettingsAnchor' | 'setRunPanelOpen'
  | 'canOpenSessionTab' | 'setWorkspaceScope' | 'selectWorkbenchTab' | 'workspaceTree' | 'enterWorkspace' | 'setPendingRun'
  | 'setPlanPage'
>

export function useNavigation(app: NavigationDeps): void {
  useEffect(() => {
    const {
      goPage, setShowSettings, setSettingsTab, setSettingsAnchor, setRunPanelOpen, canOpenSessionTab, setWorkspaceScope,
      selectWorkbenchTab, workspaceTree, enterWorkspace, setPendingRun, setPlanPage
    } = app
    return registerNavigation({
      openPage: (id) => {
        // W9-H: Agents opens on the wall, also from a console open full size (Pages hides the wall off the page)
        if (id === 'agents') setWallView({ kind: 'wall' })
        // Settings is still the modal until W9-E's page lands
        if (id === 'settings') return setShowSettings(true)
        // Run configs come with their output drawer (DESIGN.md §1)
        if (id === 'more:runs') setRunPanelOpen(true)
        goPage(id)
      },
      // the same path the workspace tree's session rows took, on the Agents page; W9-H: shown full size
      openConsole: (sessionId) => {
        if (!canOpenSessionTab(sessionId)) return
        goPage('agents')
        setWorkspaceScope(null, null)
        selectWorkbenchTab(sessionTab(sessionId))
        setWallView({ kind: 'console', sessionId })
      },
      // the same path the workspace tree's escalation row took (W7-C), onto the plan page (W9-C) at `section`
      openPlan: (jobId, section) => {
        const project = workspaceTree.find((p) => p.plans.some((plan) => plan.jobId === jobId))
        if (!project) return
        enterWorkspace(project.id, jobId)
        setPlanPage({ page: 'plans', ...(section !== undefined ? { section: planSectionOf(section) } : {}) })
        setPendingRun({ projectPath: project.path, runId: jobId })
      },
      // W9-D: the Inbox page, with the filter the caller names (inbox/inboxView.ts parseFilter)
      openInbox: (filter) => {
        requestInbox(filter)
        goPage('inbox')
      },
      // no per-path view until W9-J's Worktrees page
      openWorktree: () => goPage('worktrees'),
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
