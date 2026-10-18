import { UpdateGate } from './components/UpdateGate'
import { CliMissingScreen } from './components/CliMissingScreen'
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
import { Pages } from './components/shell/Pages'
import { RunDrawer } from './components/shell/Content'
import { TopBar } from './components/shell/TopBar'
import { useShell } from './components/shell/useShell'
import { StatusBar } from './components/shell/StatusBar'
import { Overlays } from './components/shell/Overlays'
import { Titlebar } from './components/shell/Titlebar'
// W9-C Tasks and Plans pages' state (the pages are mounted by Pages)
import { usePlanPages } from './components/pages/PlansPage'

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
  const {
    campaign, canStart, cliInstalled, installUpdate, isMax, runningCount, setCli, setCliInstalled, setCommandOpen,
    setShowNew, update
  } = app
  useNavigation(app)
  const shell = useShell(app) // W9-B

  // Only when neither CLI is present is there nothing to launch. With one of the two installed the app
  // opens as usual, and the new-session dialog blocks the accounts whose CLI is missing.
  //
  // "Present" means installed, which is why this reads `cliInstalled` and not `cli`. A CLI a toolchain
  // manager refuses to run in the app's own working directory is installed; answering "neither CLI is
  // here" to that locks a person out of the entire app over a file in a folder they never chose, and
  // the install button this screen offers cannot fix it because nothing is missing. Asked of the
  // machine's PATH instead, that person gets the workbench, and the per-folder truth is told where it
  // belongs — in the new-session dialog, about the folder they actually picked.
  //
  // The screen itself — what it offers, how it installs, and why it carries its own language switch
  // — lives in CliMissingScreen.tsx. (That line used to say "why it is English-only", which the
  // screen has not been for some time: it follows the stored language and offers a switch, because
  // the rail that normally holds one is not drawn here.)
  if (cliInstalled && !cliInstalled.claude && !cliInstalled.codex) {
    return (
      <div className="app">
        {/* 0, not runningCount: this screen renders no ConfirmHost, so a close confirmation would
            never be answered and the close button would stop working entirely. */}
        <Titlebar isMax={isMax} update={update} runningCount={0} onInstall={() => void installUpdate()} />
        {/* The gate above reads `cliInstalled`, so that is what the screen hands back. `cli` is
            refreshed alongside it: Settings reads the version strings off it, and leaving it on the
            pre-install answer would have it still saying "not detected" for a CLI now installed. */}
        <CliMissingScreen
          onFound={(installed) => {
            setCliInstalled(installed)
            void window.api.system.checkCli().then(setCli)
          }}
        />
      </div>
    )
  }

  return (
    <div className="app">
      {/* W9-B: the title bar is the 44px top bar. Run configs moved behind More ▾ (DESIGN.md §1). */}
      <Titlebar isMax={isMax} update={update} runningCount={runningCount} onInstall={() => void installUpdate()}>
        <TopBar
          {...app}
          {...shell}
          onSearch={() => setCommandOpen(true)}
          onNew={() => {
            if (canStart()) setShowNew(true)
          }}
          newDisabled={!canStart()}
        />
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
      <div className="workbench">
        <Pages {...app} {...shell} />
        <RunDrawer {...app} />
      </div>
      <StatusBar {...app} {...shell} />
      <Overlays {...app} />
    </div>
  )
}
