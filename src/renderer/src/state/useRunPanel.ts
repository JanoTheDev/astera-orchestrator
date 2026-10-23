// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useRef, useState } from 'react'
import type { RunConfig, RunContext, RunStatus } from '../../../core/types'
import { PANEL_TAB_KEY, PANEL_VISIBLE_KEY, type PanelTab } from '../../../core/ui/pages'
import { readWorkbenchLayout, storageRead, storageWrite } from '../components/shell/shellView'

export function useRunPanel() {

  // Project Run/Stop: run configurations, the active run, the list of all active runs, and whether the panel is open
  const [runConfigs, setRunConfigs] = useState<RunConfig[]>([])
  // Read by the run:status subscription, which is registered once — same reason as runStartRef
  // Runs whose address has already been offered — the toast is a one-time hint, not a repeat on
  // every status change the run goes through.
  const previewOfferedRef = useRef(new Set<string>())
  const runConfigsRef = useRef(runConfigs)
  runConfigsRef.current = runConfigs
  const [runSelectedId, setRunSelectedId] = useState<string | null>(null)
  /** 프로젝트 경로 → 그 프로젝트에서 고른 실행 구성. 선택은 프로젝트마다 따로 기억해야 한다.
   *
   *  씨앗 구성의 id 는 스크립트 이름에서 만들어져(`seed:npm:dev`) 프로젝트를 담지 않는다. 그래서
   *  "이전 선택이 새 목록에도 있으면 유지" 로는 프로젝트가 바뀐 것을 아예 감지하지 못한다 — A 에서
   *  고른 `seed:npm:dev` 는 dev 스크립트가 있는 B 에서도 멀쩡히 유효해서, B 가 조용히 A 의 선택을
   *  물려받는다. npm 프로젝트끼리 dev·build·start·test 가 겹치는 것은 예외가 아니라 보통이다.
   *
   *  state 가 아니라 ref 인 이유: 이 값이 바뀐다고 다시 그릴 것이 없다. 화면에 나가는 것은
   *  runSelectedId 이고, 이건 그 값을 프로젝트별로 되찾기 위한 기억일 뿐이다. state 로 두면 아래
   *  프로젝트 전환 효과의 의존성에 들어가 선택할 때마다 목록을 다시 불러오게 된다. */
  const runSelectedByProject = useRef<Record<string, string>>({})
  /** 선택을 화면과 기억에 함께 적는다. 한쪽만 적으면 다음에 그 프로젝트로 돌아왔을 때 어긋난다. */
  const applyRunSelection = (projectPath: string | null, id: string | null): void => {
    setRunSelectedId(id)
    if (!projectPath) return
    if (id) runSelectedByProject.current[projectPath] = id
    else delete runSelectedByProject.current[projectPath]
  }
  /** The current project's runs, finished ones included, in seat order — the Run tab's list. Kept in step
   *  by run:status events through upsertRun (core/run/instances.ts), and reloaded whole from run.list on
   *  a project switch. */
  const [runs, setRuns] = useState<RunStatus[]>([])
  /** The run whose console the Run tab shows. Starting a run selects it. */
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [activeRuns, setActiveRuns] = useState<RunStatus[]>([])
  // DESIGN-W13: the bottom panel. runPanelOpen is whether it shows (remembered); every older caller that opened the
  // run drawer still calls setRunPanelOpen(true), which lands on Output or Terminal (shellView shownPanelTab).
  const [launch] = useState(() => readWorkbenchLayout(storageRead))
  const [runPanelOpen, setPanelOpenState] = useState(launch.panelVisible)
  const [panelTab, setPanelTabState] = useState<PanelTab>(launch.panelTab)
  const setPanelTab = (tab: PanelTab): void => {
    setPanelTabState(tab)
    storageWrite(PANEL_TAB_KEY, tab)
  }
  const setRunPanelOpen = (open: boolean): void => {
    setPanelOpenState(open)
    storageWrite(PANEL_VISIBLE_KEY, String(open))
    if (open) setPanelTabState((cur) => (cur === 'needs' || cur === 'activity' ? 'output' : cur))
  }
  /** Ctrl+J and the panel's close button: shows or hides it on the tab it had. */
  const setPanelVisible = (open: boolean): void => {
    setPanelOpenState(open)
    storageWrite(PANEL_VISIBLE_KEY, String(open))
  }
  /** Shows the panel on `tab` (the panel's own tab strip, the status bar, openPanel). */
  const openPanelTab = (tab: PanelTab): void => {
    setPanelOpenState(true)
    storageWrite(PANEL_VISIBLE_KEY, 'true')
    setPanelTab(tab)
  }
  const [runPanelHeight, setRunPanelHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem('cm.runPanelHeight'))
    return v >= 120 && v <= 800 ? v : 220
  })
  // Whether to show the Spring profile field — run.list decides from the build file bodies and sends it down
  const [runIsSpringBoot, setRunIsSpringBoot] = useState(false)
  // Whether RunTypePicker should show 'python'/'pytest' as detected — run.list decides this from the
  // project root's file list (hasPythonProject) and sends it down the same way as isSpringBoot
  const [runIsPythonProject, setRunIsPythonProject] = useState(false)
  // Whether RunTypePicker should show 'dockerfile' as detected — run.list decides this from the project
  // root's file list (hasDockerfile) and sends it down the same way as isPythonProject
  const [runHasDockerfile, setRunHasDockerfile] = useState(false)
  // The two-pane run configuration manager (Task 6). context is the assembly context run.list also
  // sends down — the manager's preview calls buildCommand(config, context) so it shows exactly what
  // run.start would run, and it starts null until the first run.list response arrives.
  const [runContext, setRunContext] = useState<RunContext | null>(null)
  /** What the Run Configurations dialog was opened against, captured once. The dialog must not follow
   *  currentProject: the active tab can change under an open modal (a desktop notification click
   *  activates that session's tab), and Apply replaces a project's whole stored list — so a dialog that
   *  read the live project could write one project's draft over another's configurations. Capturing the
   *  context too keeps a run.list failure from unmounting the dialog and discarding the draft without
   *  the confirmation the user is owed. */
  const [managerFor, setManagerFor] = useState<{
    projectPath: string
    configs: RunConfig[]
    context: RunContext
    isSpringBoot: boolean
    isPythonProject: boolean
    hasDockerfile: boolean
  } | null>(null)
  /** Which configuration the manager should open on — the toolbar menu's "Edit '<name>'…" sets this
   *  right before opening; absent, the manager falls back to its own default (the first configuration). */
  const [managerInitialSelectedId, setManagerInitialSelectedId] = useState<string | undefined>(undefined)
  return {
    runConfigs, setRunConfigs, previewOfferedRef, runConfigsRef, runSelectedId, runSelectedByProject,
    applyRunSelection, runs, setRuns, selectedRunId, setSelectedRunId, activeRuns, setActiveRuns, runPanelOpen,
    setRunPanelOpen, panelTab, setPanelTab, openPanelTab, setPanelVisible, runPanelHeight, setRunPanelHeight, runIsSpringBoot, setRunIsSpringBoot, runIsPythonProject,
    setRunIsPythonProject, runHasDockerfile, setRunHasDockerfile, runContext, setRunContext, managerFor,
    setManagerFor, managerInitialSelectedId, setManagerInitialSelectedId
  }
}
