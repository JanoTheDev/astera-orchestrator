import { useState } from 'react'
import { UpdateGate } from './components/UpdateGate'
import { CliMissingBanner } from './components/CliMissingBanner'
import { HostStartingNotice } from './components/HostRuntimeNotice'
import * as sessionBus from './lib/sessionBus'
import { useLayout } from './state/useLayout'
import { useHost } from './state/useHost'
import { useSidebar } from './state/useSidebar'
import { useSettings } from './state/useSettings'
import { useWorkbenchState } from './state/useWorkbenchState'
import { useDialogs } from './state/useDialogs'
import { useWorkbench } from './state/useWorkbench'
import { useRunPanel } from './state/useRunPanel'
import { useJobs } from './state/useJobs'
import { useViews } from './state/useViews'
import { useWorkspace } from './state/useWorkspace'
import { useLiveData } from './state/useLiveData'
import { useRunActions } from './state/useRunActions'
import { useNavigation } from './state/useNavigation'
import { ProjectScopeContext } from './state/useProjectScope'
import { EditorArea } from './components/shell/Content'
import { useShell } from './components/shell/useShell'
import { StatusBar, useCurrentBranch } from './components/shell/StatusBar'
import { Overlays } from './components/shell/Overlays'
import { CommandCenter, Titlebar } from './components/shell/Titlebar'
import { ActivityBar } from './components/shell/ActivityBar'
import { SideBar } from './components/shell/SideBar'
import { Panel } from './components/shell/Panel'
import { activityClick, runningPlans } from './components/shell/shellView'
import { useViewTabSync } from './components/shell/viewTabs'
// W9-C Tasks and Plans pages' state (the pages are mounted by the views and the plan tabs)
import { usePlanPages } from './components/pages/PlansPage'
import { cliBannerShown, isOnboardingShown } from './components/onboarding/onboardingModel'
import { setOnboardingReplay, useOnboardingReplay } from './components/onboarding/replay'

sessionBus.init()

// W9-A: App's state lives in the state/* hooks, called in the order App's body used to run (so its effects
// still run in the same order), and its JSX in components/shell/*. App wires one into the other.
export default function App(): React.JSX.Element {
  const fromLayout = useLayout()
  const fromHost = useHost({ ...fromLayout })
  const fromSidebar = useSidebar({ ...fromLayout })
  const fromSettings = useSettings()
  const fromWorkbenchState = useWorkbenchState({ ...fromLayout, ...fromHost, ...fromSettings })
  const fromDialogs = useDialogs()
  const fromWorkbench = useWorkbench({
    ...fromLayout, ...fromHost, ...fromSidebar, ...fromSettings, ...fromWorkbenchState, ...fromDialogs
  })
  const fromRunPanel = useRunPanel()
  const fromJobs = useJobs({ ...fromLayout, ...fromHost, ...fromWorkbenchState, ...fromWorkbench, ...fromRunPanel })
  const fromPlanPages = usePlanPages({ ...fromJobs, ...fromSidebar, ...fromWorkbench }) // W9-C
  const fromViews = useViews({
    ...fromLayout, ...fromSidebar, ...fromSettings, ...fromWorkbenchState, ...fromWorkbench, ...fromRunPanel,
    ...fromJobs
  })
  const fromWorkspace = useWorkspace({
    ...fromLayout, ...fromSidebar, ...fromWorkbenchState, ...fromDialogs, ...fromWorkbench, ...fromJobs,
    ...fromViews
  })
  const fromLiveData = useLiveData({
    ...fromLayout, ...fromSidebar, ...fromWorkbenchState, ...fromWorkbench, ...fromRunPanel, ...fromJobs,
    ...fromViews, ...fromWorkspace, ...fromPlanPages
  })
  const fromRunActions = useRunActions({
    ...fromLayout, ...fromWorkbenchState, ...fromWorkbench, ...fromRunPanel, ...fromJobs, ...fromWorkspace
  })
  const app = {
    ...fromLayout, ...fromHost, ...fromSidebar, ...fromSettings, ...fromWorkbenchState, ...fromDialogs,
    ...fromWorkbench, ...fromRunPanel, ...fromJobs, ...fromViews, ...fromWorkspace, ...fromLiveData,
    ...fromRunActions, ...fromPlanPages
  }
  const { campaign, cliInstalled, firstRunAsked, hostStatus, installUpdate, isMax, runningCount, sidebarOpen, update } = app
  useNavigation(app)
  useViewTabSync(app) // DESIGN-W13: the view tabs follow Start's request, the open plan and the Settings flag
  const shell = useShell(app) // W9-B
  // The first-run onboarding (Overlays) covers the window and has its own Tools step, so the CLI-missing screen
  // and the top bar stand aside while it is open.
  const onboarding = isOnboardingShown(firstRunAsked, useOnboardingReplay())

  // T29: with neither CLI on the machine the app still opens (the old full-window CliMissingScreen is gone). A
  // dismissible banner says agents cannot run and reopens the onboarding at its install step; anything that needs a
  // CLI says why it cannot start (guardStart). "Present" is installed, not runnable: `cliInstalled`, not `cli` (a
  // CLI a toolchain manager refuses to run in the app's cwd is installed; calling it missing would be wrong).
  const [cliBannerDismissed, setCliBannerDismissed] = useState(false)
  const showCliBanner = cliBannerShown({ cliInstalled, onboarding, dismissed: cliBannerDismissed })

  const branch = useCurrentBranch(app.currentProject)
  const props = { ...app, ...shell }
  return (
    // T12: the title bar's project, for any component that reads it with useProjectScope()
    <ProjectScopeContext.Provider value={app.projectScope}>
      <div className="app">
        {/* DESIGN-W13 §2: title bar (command center) / activity bar | side bar | editor area over the panel / status bar */}
        <Titlebar isMax={isMax} update={update} runningCount={runningCount} onInstall={() => void installUpdate()} onBuild={() => void window.api.update.download()}>
          {!onboarding && <CommandCenter {...props} />}
        </Titlebar>
        {/* Only a block-mode campaign covers the workbench. notify is announced with a toast */}
        {campaign?.mode === 'block' && (
          <UpdateGate
            update={update}
            onDownload={() => void window.api.update.download()}
            onInstall={() => void installUpdate()}
            onRetry={() => void window.api.update.check()}
          />
        )}
        <HostStartingNotice status={hostStatus} />
        {showCliBanner && (
          <CliMissingBanner onInstall={() => setOnboardingReplay(true, 'tools')} onDismiss={() => setCliBannerDismissed(true)} />
        )}
        <div className="workbench wb-row">
          <ActivityBar
            {...props}
            badges={{ agents: shell.counts.agents, plans: runningPlans(app.orchSnapshot?.runs ?? []) }}
            onActivity={(id) => {
              const next = activityClick({ activity: app.activityRef.current, sidebarVisible: sidebarOpen }, id) // the ref: a second quick click reads the first
              app.showActivity(next.activity)
              app.setSidebarOpen(next.sidebarVisible)
            }}
          />
          <SideBar {...props} />
          <div className="wb-main">
            <EditorArea {...props} />
            <Panel {...props} />
          </div>
        </div>
        <StatusBar {...props} branch={branch} />
        <Overlays {...app} />
      </div>
    </ProjectScopeContext.Provider>
  )
}
