// App's handlers behind components/shell/navigation.ts. DESIGN-W13: the side bar's views (activities), the `view`
// editor tabs and the bottom panel; 
// Re-registered after every render so a handler always reads the latest state.
import { useEffect } from 'react'
import { sessionTab, viewTab, type ViewName } from '../../../core/panes/tabId'
import { placeViewTab } from '../../../core/panes/place'
import type { ActivityId } from '../../../core/ui/pages'
import { registerNavigation, type SettingsGroup } from '../components/shell/navigation'
import { requestInbox } from '../components/inbox/inboxNav'
import { settingsTarget } from '../components/settings/settingsIndex'
import { showWorktrees } from '../components/worktrees/worktreeView'
import type { AppState } from './appState'
import { planSectionOf } from '../components/plan/planBoard'
import { ownerOf, scopeFor } from './projectScope'
import { toast } from '../lib/toast'

type NavigationDeps = Pick<
  AppState,
  | 'setSettingsTab' | 'setSettingsAnchor'
  | 'canOpenSessionTab' | 'setWorkspaceScope' | 'workspaceIds' | 'workspaceProjectId' | 'selectWorkbenchTab' | 'workspaceTree' | 'enterWorkspace' | 'setPendingRun'
  | 'setPlanPage' | 'showActivity' | 'setSidebarOpen' | 'openPanelTab' | 'setPanelVisible' | 'runPanelOpen' | 'layoutRef'
  | 'activePaneIdRef' | 'setLayout' | 'setActivePaneId' | 'openStart' | 'terminals' | 'setBottomTab' | 'openTerminal'
  | 'openLinkedPath' | 'spawn' | 'setTerminals' | 'setRunPanelOpen' | 'bottomRoot' | 't'
>

export function useNavigation(app: NavigationDeps): void {
  useEffect(() => {
    const {
      setSettingsTab, setSettingsAnchor, canOpenSessionTab, setWorkspaceScope,
      selectWorkbenchTab, workspaceTree, enterWorkspace, setPendingRun, setPlanPage, workspaceIds, workspaceProjectId,
      showActivity, setSidebarOpen, openPanelTab, setPanelVisible, runPanelOpen, layoutRef, activePaneIdRef, setLayout,
      setActivePaneId, openStart, terminals, setBottomTab, openTerminal, openLinkedPath, spawn,
      setTerminals, setRunPanelOpen, bottomRoot, t
    } = app
    /** Opens the view tab, or focuses the one already open, in whichever group it sits. */
    const placeView = (name: ViewName, arg?: string): void => {
      const placed = placeViewTab(layoutRef.current, viewTab(name, arg), activePaneIdRef.current)
      setLayout(placed.root)
      if (placed.paneId) setActivePaneId(placed.paneId)
    }
    const openActivity = (id: ActivityId): void => {
      showActivity(id)
      setSidebarOpen(true)
    }
    const openSettings = (group: SettingsGroup | Parameters<typeof settingsTarget>[0], anchor?: string): void => {
      const target = settingsTarget(group, anchor)
      setSettingsTab(target.group)
      setSettingsAnchor(target.anchor)
      placeView('settings')
    }
    const openPlan = (jobId: string, section?: string): void => {
      const project = workspaceTree.find((p) => p.plans.some((plan) => plan.jobId === jobId))
      if (!project) return
      enterWorkspace(project.id, jobId)
      setPlanPage({ page: 'plans', ...(section !== undefined ? { section: planSectionOf(section) } : {}) })
      // the plan's tab follows openRun (shell/viewTabs.tsx useViewTabSync)
      setPendingRun({ projectPath: project.path, runId: jobId })
    }
    const openView = (name: ViewName, arg?: string): void => {
      if (name === 'settings' && arg === 'keys') return placeView(name, arg) // the Keyboard Shortcuts tab, not a Settings group
      if (name === 'settings') return openSettings((arg ?? 'general') as SettingsGroup)
      if (name === 'plan') return arg === undefined ? undefined : openPlan(arg)
      // Start's tab follows its request (useViewTabSync), so New/Start keeps one way in
      if (name === 'start') return openStart((cur) => cur ?? {})
      if (name === 'worktree' && arg !== undefined) showWorktrees(arg)
      placeView(name, arg)
    }
    return registerNavigation({
      openActivity,
      openView,
      openPanel: (tab) => {
        openPanelTab(tab)
        // Output and Terminal are the console strip's tabs: the run tab, else the first shell (or a new one)
        if (tab === 'output') setBottomTab('run')
        if (tab === 'terminal') {
          if (terminals[0]) setBottomTab(terminals[0].id)
          else void openTerminal()
        }
      },
      toggleSideBar: () => setSidebarOpen((v) => !v),
      togglePanel: () => setPanelVisible(!runPanelOpen),
      // a console's own tab; the side bar stays on what it shows
      openConsole: (sessionId) => {
        if (!canOpenSessionTab(sessionId)) return
        // the selected project stays; a console of another project switches to that project, never to All
        setWorkspaceScope(scopeFor(workspaceProjectId, ownerOf(workspaceIds, sessionId)), null)
        selectWorkbenchTab(sessionTab(sessionId))
      },
      openPlan,
      // W9-D: the Inbox is the panel's Needs you tab, with the filter the caller names (inbox/inboxView.ts parseFilter)
      openInbox: (filter) => {
        requestInbox(filter)
        openPanelTab('needs')
      },
      openWorktree: (path) => openView('worktree', path),
      // W9-E: the Settings tab scrolls to the anchor's row and clears it
      openSettings,
      // T7 review: Edit on a hunk
      openFile: (path, at) => openLinkedPath(path, at),
      // T7 review: Ask AI on a plain worktree. No account named is Auto (T1); no default is saved for it
      startSession: (cwd, kind) => spawn({ accountIds: [], cwd, saveDefault: false, kind }),
      // A Task's worktree shell: newTerminal's steps (state/useRunActions.ts), at `cwd`; keyed by the panel's root so a re-list keeps it
      openTerminalAt: async (cwd) => {
        if (!bottomRoot) return
        try {
          const info = await window.api.terminal.open(bottomRoot, undefined, undefined, cwd)
          setTerminals((prev) => [...prev, { id: info.id, buffer: '' }])
          setBottomTab(info.id)
          setRunPanelOpen(true)
        } catch (err) {
          toast.error(t('terminal.open.failed', { detail: err instanceof Error ? err.message : String(err) }))
        }
      }
    })
  })
}
