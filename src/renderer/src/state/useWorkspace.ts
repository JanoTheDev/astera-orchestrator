// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceData } from './useWorkspaceData'
import { buildWorkspaceTree, findPlan, planSessions, projectOfCwd, scopeLayout } from './workspaceTree'
// W6-F: one workspace per project
import { entryTab, OTHER_WORKSPACE, scopeIds as workspaceScopeOf, workspaceFolderOf, workspaceSessionIds } from './workspaceTree'
import { initialScope, ownerOf } from './projectScope'
import { projectScopeOf, scopeData, scopeTree, selectionAfterFocus } from './projectView'
import type { ProjectScope } from './useProjectScope'
import * as sticky from '../lib/stickyProject'
import { projectAnchorOf } from '../components/projects/projectAnchor' // W8-G
// W7-F (#84): ended plan tabs close on their own; the quick tab switcher
import { tabsToAutoClose } from '../lib/tabAutoClose'
import type { SwitcherTab } from '../lib/tabSwitcher'
import { groupOfTab, leaves } from '../../../core/panes/tree'
import { parseTab, sessionTab } from '../../../core/panes/tabId'
import type { useWorkbench } from './useWorkbench'
import type { useLayout } from './useLayout'
import type { useWorkbenchState } from './useWorkbenchState'
import { selectionAfterDrop, type useJobs } from './useJobs'

export type WorkspaceDeps = Pick<ReturnType<typeof useWorkbench>,
    'bottomRootRef' | 'bottomTab' | 'openWorkspaceSlotRef' | 'selectWorkbenchTab' | 'terminals'> &
  Pick<ReturnType<typeof useLayout>,
    'activeSessionId' | 'activeTabId' | 'layout' | 'layoutRef' | 'remoteSessions' | 'sessions'> &
  Pick<ReturnType<typeof useWorkbenchState>,
    'closeWorkbenchTabRef'> &
  Pick<ReturnType<typeof useJobs>,
    'activeTabRoot' | 'currentProject' | 'droppedRoot' | 'homeDir' | 'setScopeRoot'>

export function useWorkspace(deps: WorkspaceDeps) {
  const {
    activeSessionId, activeTabId, activeTabRoot, bottomRootRef, bottomTab, closeWorkbenchTabRef,
    currentProject, droppedRoot, homeDir, setScopeRoot, layout, layoutRef, openWorkspaceSlotRef, remoteSessions, selectWorkbenchTab, sessions, terminals
  } = deps
  // W2-B workspace: the selected plan, and the pane tree as its workspace shows it (scopeLayout). Read while the
  // tree is on screen or a plan is open; the anchor is only the path the reads are sent through.
  const [workspacePlanId, setWorkspacePlanId] = useState<string | null>(null)
  const [workspaceArchived, setWorkspaceArchived] = useState(false)
  // W6-F: the open project workspace (a project id or OTHER_WORKSPACE), null for every tab. An open plan narrows it.
  // T6: starts as the window's stored scope (not null = All), and `scopeKnown` holds the tabs back while it has none.
  const [start] = useState(() => initialScope(sticky.readScope()))
  const [workspaceProjectId, setWorkspaceProjectId] = useState<string | null>(start.projectId)
  const [scopeKnown, setScopeKnown] = useState(start.known)
  // W7-B: the new / add / settings dialogs of the project switcher, and a bump that makes the switcher read again
  const [projectDialog, setProjectDialog] = useState<'new' | 'add' | 'clone' | { settings: string } | null>(null)
  const [projectsRefresh, setProjectsRefresh] = useState(0)
  const [firstPlan, setFirstPlan] = useState<{ path: string; objective: string } | null>(null)
  // W7-F (#84): the tab auto-close setting (default on) and the quick tab switcher (`tabs.switcher`). The plan data is
  // read while one of them needs it: the switcher's plan and Task names, or an ended tab that may be a plan's to close.
  const [autoCloseEndedPlanTabs, setAutoCloseEndedPlanTabs] = useState(true)
  useEffect(() => {
    void window.api.settings.getAutoCloseEndedPlanTabs().then(setAutoCloseEndedPlanTabs, () => {})
  }, [])
  const autoCloseWanted = autoCloseEndedPlanTabs && sessions.some((s) => s.status === 'exited')
  const workspaceData = useWorkspaceData(
    currentProject ?? sessions[0]?.cwd ?? null,
    // W9-B: always — the top bar's switcher and Inbox count and the status bar read it on every page
    true,
    projectsRefresh // W7-B
  )
  const projectAnchor = projectAnchorOf(currentProject, sessions[0]?.cwd, homeDir) // W7-B; W8-G (#104): home when no tab is open
  const workspaceTree = useMemo(
    () => (workspaceData ? buildWorkspaceTree(workspaceData, { showArchived: workspaceArchived }) : []),
    [workspaceData, workspaceArchived]
  )
  // T12: the title bar's selection is the window's one current project; every view reads what is derived from it.
  // Until the project list is read, a selected project's folder is the one last stored (stickyProject).
  const [rememberedRoot] = useState(() => sticky.read())
  const scopeView = projectScopeOf(workspaceData?.projects ?? null, workspaceProjectId, rememberedRoot)
  const scopeId = scopeView.scopeId
  const scopedTree = useMemo(() => scopeTree(workspaceTree, scopeId), [workspaceTree, scopeId])
  const scopedData = useMemo(() => (workspaceData ? scopeData(workspaceData, scopeId) : null), [workspaceData, scopeId])
  // W6-F: every workspace's sessions, and the ones the open project's (or plan's) workspace shows. Paired Runtimes'
  // tabs have no local cwd, so they are "Other"'s.
  const workspaceIds = useMemo(() => {
    const ids = workspaceSessionIds(workspaceTree, sessions, workspaceData?.worktrees ?? [])
    for (const r of remoteSessions) ids.get(OTHER_WORKSPACE)!.add(r.key)
    return ids
  }, [workspaceTree, sessions, workspaceData?.worktrees, remoteSessions])
  const scopeOf = (projectId: string | null, planId: string | null): Set<string> | null =>
    workspaceScopeOf(workspaceTree, workspaceIds, projectId, planId)
  const workspaceScope = scopeOf(workspaceProjectId, workspacePlanId)
  const workspaceKey = workspaceScope ? [...workspaceScope].join('\n') : null
  const shownLayout = useMemo(
    () => (!scopeKnown ? null : workspaceScope ? scopeLayout(layout, workspaceScope) : layout),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- workspaceKey stands for the scope's session ids
    [layout, workspaceKey, scopeKnown]
  )
  // A session outside the open workspace focused from elsewhere (a notification, the Jobs view) leaves it for that
  // session's own project workspace: the scoped view would hide the very tab the person just asked for.
  useEffect(() => {
    // W9-K: not before the tree is in: until then every session reads as Other's, and a window bound to a project
    // would leave it for Other at mount.
    if (!workspaceData) return
    if (!workspaceScope || !activeSessionId || workspaceScope.has(activeSessionId)) return
    // a session not yet in the tree (owner unknown) never resets the selection
    const owner = ownerOf(workspaceIds, activeSessionId)
    if (!owner) return
    setWorkspacePlanId(null)
    setWorkspaceProjectId(owner)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a focus change decides this, not a refresh
  }, [activeSessionId])
  // T12: likewise a file, record or browser tab of another project moves the title bar to that project, so the views
  // never drift from it. Session tabs are the effect above's.
  useEffect(() => {
    if (!workspaceData || !activeTabRoot || !activeTabId) return
    const kind = parseTab(activeTabId)?.kind
    if (kind === 'session' || kind === 'app') return
    const next = selectionAfterFocus(workspaceProjectId, projectOfCwd(activeTabRoot, workspaceTree, workspaceData.worktrees ?? []))
    if (next === workspaceProjectId) return
    setWorkspacePlanId(null)
    setWorkspaceProjectId(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a focus change decides this, not a refresh
  }, [activeTabId, activeTabRoot])
  const canOpenSessionTab = (sessionId: string): boolean => !!layout && !!groupOfTab(layout, sessionTab(sessionId))
  // W7-F (#84): an ended plan's ended tabs, and a replan's stale planner tab, close on their own (tabsToAutoClose),
  // through the tab strip's own close as a hide (T13): the tab leaves the tree, nothing is killed, and Recently closed
  // lists it, so Ctrl+Shift+T resumes it from its transcript. The scrollback stays in the Host's ended entry, the
  // transcript on disk (History), and the workspace tree, built from orchestration data, still lists the session. A
  // plain session's ended tab is left alone.
  useEffect(() => {
    if (!workspaceData || !layout) return
    const open = leaves(layout)
      .flatMap((l) => l.tabIds.map(parseTab))
      .flatMap((r) => (r?.kind === 'session' ? [r.id] : []))
    const ids = tabsToAutoClose({
      sessions,
      jobs: Object.values(workspaceData.jobsByProject).flat(),
      runs: workspaceData.runs,
      tasks: workspaceData.tasks,
      dispatches: workspaceData.dispatches,
      // 2026-10-18: a running plan's finished workers and reviewers close too, unless their Task has an open Gate
      gates: workspaceData.gates,
      openTabSessionIds: open,
      enabled: autoCloseEndedPlanTabs
    })
    for (const id of ids) closeWorkbenchTabRef.current(sessionTab(id), 'hide') // T13: hidden, and listed in Recently closed
  }, [workspaceData, sessions, layout, autoCloseEndedPlanTabs])
  // W7-F (#84): what the switcher filters a plan session's tab by, besides its title
  const switcherMeta = useMemo(() => {
    const m = new Map<string, Omit<SwitcherTab, 'tabId' | 'title'>>()
    for (const p of workspaceTree)
      for (const plan of p.plans)
        for (const x of planSessions(plan))
          m.set(x.sessionId, { label: x.label, planName: x.planName, projectName: x.projectName, ...(x.taskTitle ? { taskTitle: x.taskTitle } : {}) })
    return m
  }, [workspaceTree])
  // W6-F: each workspace's focused tab while it is away, keyed by plan id, project id, or '' for every tab. Renderer
  // memory only: the pane tree it points into is not stored either.
  const workspaceFocusRef = useRef(new Map<string, string>())
  /** Opens a workspace without moving focus: the caller focuses a session of it. A plan opens inside its project. */
  const setWorkspaceScope = (projectId: string | null, planId: string | null): void => {
    if (activeTabId) workspaceFocusRef.current.set(workspacePlanId ?? workspaceProjectId ?? '', activeTabId)
    const plan = planId ? findPlan(workspaceTree, planId) : undefined
    setWorkspacePlanId(planId)
    // a plan the tree does not know yet keeps the current project instead of falling back to All
    setWorkspaceProjectId(planId ? (plan?.projectId ?? projectId ?? workspaceProjectId) : projectId)
  }
  /** Opens a workspace and focuses the tab it had when it was left, else its first. */
  const enterWorkspace = (projectId: string | null, planId: string | null): void => {
    setWorkspaceScope(projectId, planId)
    const tab = entryTab(layoutRef.current, scopeOf(projectId, planId), workspaceFocusRef.current.get(planId ?? projectId ?? ''))
    if (tab) selectWorkbenchTab(tab)
  }
  // Closing a plan's workspace goes back to its project's
  const openWorkspacePlan = (jobId: string | null): void => enterWorkspace(workspaceProjectId, jobId)
  const openWorkspaceProject = (projectId: string | null): void => enterWorkspace(projectId, null)
  openWorkspaceSlotRef.current = (slot) => {
    const p = workspaceTree[slot - 1]
    if (p) openWorkspaceProject(p.id)
  }
  // W9-K: this window's project (main binds it, src/main/windows.ts), read once at mount and entered once the tree is
  // in, so the window focuses one of its own tabs. From then on what the window shows is reported back: that retitles
  // the window, and it is how a notice and `--project` find it.
  const [boundProject, setBoundProject] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    void window.api.win.boundProject().then(
      (id) => {
        if (id) setWorkspaceProjectId(id)
        setBoundProject(id)
        setScopeKnown(true)
      },
      () => {
        setBoundProject(null)
        setScopeKnown(true)
      }
    )
  }, [])
  // T6: the next reload of this window starts on what it shows now
  useEffect(() => {
    if (scopeKnown) sticky.writeScope(workspaceProjectId)
  }, [scopeKnown, workspaceProjectId])
  const boundEnteredRef = useRef(false)
  useEffect(() => {
    if (!boundProject || !workspaceData || boundEnteredRef.current) return
    boundEnteredRef.current = true
    openWorkspaceProject(boundProject)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the tree first arrives
  }, [boundProject, workspaceData])
  const workspaceName = workspaceTree.find((p) => p.id === workspaceProjectId)?.name
  // The switcher's selection is the project jobs are made in; its name is kept so a reload labels it before the tree is in.
  const selectedProject = workspaceTree.find((p) => p.id === workspaceProjectId)
  // The folder of the selected project is gone (useJobs dropped it): the selection moves to the active tab's project,
  // else All, so the switcher, the tabs' scope and the window agree. Read once per drop: a pick of the same folder
  // again must not be undone by a render that still has the old drop.
  useEffect(() => {
    if (!droppedRoot) return
    const next = selectionAfterDrop(workspaceProjectId, workspaceTree, droppedRoot, activeTabRoot)
    if (next !== workspaceProjectId) setWorkspaceProjectId(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new drop decides this, not a pick or a refresh
  }, [droppedRoot])
  // T12: currentProject (useJobs) is the selection's folder, null for All and Other: every view reads it from there
  useEffect(() => setScopeRoot(scopeView.path), [scopeView.path])
  useEffect(() => {
    if (workspaceProjectId && selectedProject) sticky.writeName(workspaceProjectId, selectedProject.name)
  }, [workspaceProjectId, selectedProject?.name])
  const projectScope: ProjectScope = {
    projectId: scopeView.projectId, project: scopeView.project, path: scopeView.path, isAll: scopeView.isAll, select: openWorkspaceProject
  }
  useEffect(() => {
    if (boundProject === undefined) return
    window.api.win.setScope({
      projectId: workspaceProjectId,
      ...(workspaceName ? { name: workspaceName } : {}),
      sessionIds: workspaceScope ? [...workspaceScope] : null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- workspaceKey stands for the scope's session ids
  }, [boundProject, workspaceProjectId, workspaceName, workspaceKey])
  // A new tab opened in a project workspace starts in the project's folder
  const workspaceCwd = workspaceFolderOf(workspaceTree, workspaceProjectId)
  /** 아래쪽 패널이 쓰는 경로. 프로젝트가 없으면 홈으로 떨어진다 — 셸을 직접 띄웠을 때와 같은 곳이고,
   *  그래야 탭이 하나도 없을 때도 터미널을 열 수 있다. 홈에서는 Run 탭이 없다(runAvailable):
   *  실행 구성은 프로젝트 단위이고, 홈의 파일 목록으로 시드를 감지하면 남의 홈 package.json 스크립트를
   *  실행 구성으로 제안하게 된다. main 의 경로 가드도 터미널에만 홈을 열어 준다(assertTerminalPath). */
  const bottomRoot = currentProject ?? homeDir
  bottomRootRef.current = bottomRoot
  // The Run tab is there for as long as a project is. Rows are closed one by one in the list; with none
  // left the tab shows where to start one rather than disappearing.
  const runAvailable = currentProject !== null
  /** 아래쪽 패널에 실제로 넘길 탭. Run 탭이 없는데 bottomTab 이 'run' 에 남아 있으면 본문이 비므로,
   *  그때는 터미널로 떨어뜨린다. 여러 자리(closeTerminal, 터미널 목록 효과, 초기값)가 'run' 을
   *  기본 폴백으로 쓰고 있어 그 하나하나를 고치는 대신 내려보내는 값에서 한 번에 바로잡는다. */
  const bottomTabShown = runAvailable
    ? bottomTab
    : (terminals.find((x) => x.id === bottomTab)?.id ?? terminals[0]?.id ?? 'run')
  return {
    workspacePlanId, workspaceArchived, setWorkspaceArchived, workspaceProjectId, projectDialog, setProjectDialog,
    setProjectsRefresh, firstPlan, setFirstPlan, autoCloseEndedPlanTabs, setAutoCloseEndedPlanTabs, workspaceData,
    projectAnchor, workspaceTree, workspaceIds, scopeId, projectScope, scopedTree, scopedData, shownLayout, canOpenSessionTab, switcherMeta,
    setWorkspaceScope, enterWorkspace, openWorkspacePlan, openWorkspaceProject, workspaceCwd, bottomRoot,
    runAvailable, bottomTabShown
  }
}
