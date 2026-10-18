// Moved out of App.tsx unchanged (W9-A): the JSX is App's, the values come from App's state hooks.
import { AccountPanel } from '../AccountPanel'
import { HistoryBrowser } from '../HistoryBrowser'
import { FileExplorer } from '../FileExplorer'
import { JobsView } from '../JobsView'
import { jobsStall } from '../../../../core/orchestration/jobsView'
import { UnderstandingView } from '../UnderstandingView'
import { WorktreePanel } from '../WorktreePanel'
import { RuntimeSelector } from '../RuntimeSelector'
import { controlReason, isRemoteRuntime, offlineNote } from '../../lib/remoteJobs'
import { localDoor } from '../../lib/orchDoor'
import { deleteRun, pauseRun, restartCoordinator as restartRunCoordinator, resumeRun } from '../../lib/jobActions'
// W1-C plan lifecycle
import { archiveJob, holdJob, renameJob, unarchiveJob } from '../../lib/jobActions'
// W2-B workspace sidebar
import { WorkspaceSidebar } from '../workspace/WorkspaceSidebar'
import { ActivityPanel } from '../activity/ActivityPanel' // W3-A
import { ProjectSwitcher } from '../workspace/ProjectSwitcher'
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import type { AppState } from '../../state/appState'

export type SidebarProps = Pick<
  AppState,
  'accounts' | 'actionUi' | 'activeRecordId' | 'approve' | 'canOpenSessionTab' | 'cancelOpenTask' | 'closeExplorer' |
  'completeOpenTask' | 'currentProject' | 'defaultSessionKind' | 'enterWorkspace' | 'explorerClipboardRef' |
  'explorerReveal' | 'explorerTreesRef' | 'explorerUndoRef' | 'ghostAccounts' | 'handlePathDeleted' |
  'handlePathRenamed' | 'hostDriver' | 'hostStatus' | 'jobsRuntime' | 'layout' | 'openProjectFile' | 'openRecordTab' |
  'openTasks' | 'openWorkspacePlan' | 'openWorkspaceProject' | 'orchHostGate' | 'orchSnapshot' | 'pairedRuntimes' |
  'parkedSinceMs' | 'pauseScheduleRun' | 'projectAnchor' | 'regenerateRecord' | 'remoteActionUi' | 'remoteProject' |
  'remoteProjects' | 'remoteSnapshot' | 'remoteViewDoor' | 'remoteViewPermission' | 'restartCoordinator' |
  'resumeFromHistory' | 'resumeScheduleRun' | 'runFile' | 'selectWorkbenchTab' | 'sessions' | 'setDetail' |
  'setExplorerReveal' | 'setJobsOpen' | 'setJobsRuntime' | 'setNewRunOpen' | 'setNewSessionCwd' | 'setOpenRun' |
  'setPendingRun' | 'setProjectDialog' | 'setRemoteNewRunOpen' | 'setRemoteProject' | 'setShowNew' |
  'setSidebarWidth' | 'setSourceJobOpen' | 'setWorkspaceArchived' | 'setWorkspaceScope' | 'sidebarOpen' |
  'sidebarPane' | 'sidebarRef' | 'sidebarWidth' | 't' | 'understanding' | 'workspaceArchived' | 'workspaceData' |
  'workspaceIds' | 'workspacePlanId' | 'workspaceProjectId' | 'workspaceTree'
>

export function Sidebar(p: SidebarProps): React.JSX.Element {
  const {
    accounts, actionUi, activeRecordId, approve, canOpenSessionTab, cancelOpenTask, closeExplorer, completeOpenTask,
    currentProject, defaultSessionKind, enterWorkspace, explorerClipboardRef, explorerReveal, explorerTreesRef,
    explorerUndoRef, ghostAccounts, handlePathDeleted, handlePathRenamed, hostDriver, hostStatus, jobsRuntime,
    layout, openProjectFile, openRecordTab, openTasks, openWorkspacePlan, openWorkspaceProject, orchHostGate,
    orchSnapshot, pairedRuntimes, parkedSinceMs, pauseScheduleRun, projectAnchor, regenerateRecord, remoteActionUi,
    remoteProject, remoteProjects, remoteSnapshot, remoteViewDoor, remoteViewPermission, restartCoordinator,
    resumeFromHistory, resumeScheduleRun, runFile, selectWorkbenchTab, sessions, setDetail, setExplorerReveal,
    setJobsOpen, setJobsRuntime, setNewRunOpen, setNewSessionCwd, setOpenRun, setPendingRun, setProjectDialog,
    setRemoteNewRunOpen, setRemoteProject, setShowNew, setSidebarWidth, setSourceJobOpen, setWorkspaceArchived,
    setWorkspaceScope, sidebarOpen, sidebarPane, sidebarRef, sidebarWidth, t, understanding, workspaceArchived,
    workspaceData, workspaceIds, workspacePlanId, workspaceProjectId, workspaceTree
  } = p
  return (
    <>
        {sidebarOpen && (
          <aside className="sidebar" ref={sidebarRef} style={{ width: sidebarWidth }}>
            {sidebarPane === 'explorer' ? (
              <FileExplorer
                root={currentProject}
                onOpenFile={openProjectFile}
                onClose={() => void closeExplorer()}
                stateRef={explorerTreesRef}
                clipboardRef={explorerClipboardRef}
                undoRef={explorerUndoRef}
                onPathRenamed={handlePathRenamed}
                onPathDeleted={handlePathDeleted}
                onRunFile={runFile}
                revealFolder={explorerReveal}
                onRevealDone={(seq) => setExplorerReveal((r) => (r !== null && r.seq === seq ? null : r))}
              />
            ) : sidebarPane === 'jobs' ? (
              <>
              {/* Only when a Runtime is paired: with none, the Jobs view is exactly what it was (Phase 6). */}
              {pairedRuntimes.length > 0 && (
                <RuntimeSelector
                  readOnlyReason={controlReason(remoteViewPermission, t as never)}
                  paired={pairedRuntimes}
                  runtimeId={jobsRuntime}
                  onRuntime={setJobsRuntime}
                  projects={remoteProjects}
                  project={remoteProject}
                  onProject={setRemoteProject}
                  offline={offlineNote(
                    remoteSnapshot?.runtime,
                    pairedRuntimes.find((r) => r.runtimeId === jobsRuntime)?.name ?? jobsRuntime,
                    // The last answer this app had (review I4); the pairing time only before any answer.
                    remoteSnapshot?.runtime?.lastSeenAt ??
                      pairedRuntimes.find((r) => r.runtimeId === jobsRuntime)?.lastSeenAt ??
                      null,
                    t as never,
                    (iso) => new Date(iso).toLocaleString()
                  )}
                />
              )}
              {isRemoteRuntime(jobsRuntime) ? (
                // A paired Runtime's Jobs, acted on there through its door (Phase 7): every action is an orch-call
                // to that Runtime, disabled with the reason for a read-only pairing. No session to jump to (remote
                // session tabs are Phase 9).
                <JobsView
                  snapshot={remoteSnapshot}
                  hostGate={null}
                  stall={null}
                  hasProject={remoteProject !== null}
                  remote
                  disabledReason={controlReason(remoteViewPermission, t as never) ?? undefined}
                  canOpenSession={() => false}
                  onOpenSession={() => {}}
                  onOpenRun={(runId) => {
                    setDetail(null)
                    if (remoteProject) setOpenRun({ projectPath: remoteProject, runId, runtimeId: jobsRuntime })
                  }}
                  onNewRun={() => {
                    if (remoteViewDoor) setRemoteNewRunOpen(true)
                  }}
                  onPauseRun={(runId) => {
                    if (remoteViewDoor) void pauseRun(remoteViewDoor, runId, remoteActionUi)
                  }}
                  onResumeRun={(runId) => {
                    if (remoteViewDoor) void resumeRun(remoteViewDoor, runId, remoteActionUi)
                  }}
                  onDeleteRun={(runId) => {
                    if (remoteViewDoor) void deleteRun(remoteViewDoor, remoteSnapshot, runId, remoteActionUi)
                  }}
                  onRestartCoordinator={(runId) => {
                    if (remoteViewDoor) void restartRunCoordinator(remoteViewDoor, runId, remoteActionUi)
                  }}
                  onApprove={(runId) => {
                    if (remoteViewDoor) approve(remoteViewDoor, remoteSnapshot, runId, remoteActionUi)
                  }}
                />
              ) : (
              <JobsView
                snapshot={orchSnapshot}
                hostGate={orchHostGate}
                // 아무것도 움직이지 않을 때 그 까닭(한도 L3): 멈춰 둔 Host, 응답하지 않는 Host.
                stall={jobsStall({ hostStatus, driver: hostDriver, parkedSinceMs, nowMs: Date.now() })}
                // 빈 상태의 "+ 새 작업" 버튼을 가리는 신호 — snapshot 만으로는 프로젝트가 없는
                // 경우와 프로젝트가 있는데 Run 이 없는 경우를 구별할 수 없다(JobsView 의
                // hasProject 주석). onNewRun 의 가드(아래)와 함께 newRunOpen 이 프로젝트 없이
                // true 가 되는 두 갈래를 모두 막는다.
                hasProject={!!currentProject}
                // W6-H: the project's delivery setting
                projectPath={currentProject ?? undefined}
                // JobTask.sessionId only says main still has the session record, and main never drops
                // one — SessionManager.kill flips the status and list() keeps exited sessions on
                // purpose. closeSession, on the other hand, takes the tab out of this tree. So after a
                // user closes a finished worker's tab the row would keep full opacity and its click
                // would reach activateTab, find no group, and return null: a silent no-op that only
                // heals on a window reload. The tree is the renderer's, so this is the one condition
                // the fold in main cannot make, and it is exactly what selectWorkbenchTab needs.
                canOpenSession={(sessionId) => !!layout && !!groupOfTab(layout, sessionTab(sessionId))}
                onOpenSession={(sessionId) => selectWorkbenchTab(sessionTab(sessionId))}
                onOpenRun={(runId) => {
                  setDetail(null) // 이전 Run 의 상세가 한 프레임 보이지 않게 한다
                  // 여는 시점의 프로젝트를 runId 와 함께 든다 — 이 스냅샷을 준 프로젝트가 그것이다
                  if (currentProject) setOpenRun({ projectPath: currentProject, runId })
                }}
                // currentProject 가 없으면 세우지 않는다 — hasProject 가 버튼 자체를 지우므로
                // 정상 클릭으로는 이 가드에 닿지 않지만, 그 버튼을 세운 것이 바로 이 값을
                // 가드 없이 세우는 사고였다(newRunOpen 선언부의 주석) — 그 원인을 한 군데(버튼)
                // 가 아니라 값이 세워지는 자리에서도 막아, 나중에 이 콜백을 다른 데서 새로
                // 부르더라도 같은 사고가 되풀이되지 않게 한다.
                onNewRun={() => {
                  if (currentProject) setNewRunOpen(true)
                }}
                onNewFromSource={() => {
                  if (currentProject) setSourceJobOpen(currentProject)
                }}
                // Run 을 물러나게 한다. **확인을 여기서 받는다** — 되돌릴 수 없고, 지워지는 것을
                // 세어 보여 줄 수 있는 곳이 스냅숏을 든 이 자리다. 워크트리는 건드리지 않으므로
                // (사용자의 git 저장소다) 몇 개가 남는지도 함께 말한다: 조용히 고아로 두지 않는다.
                // 거절(도는 워커가 있다)은 토스트로 — 폼이 없는 단발 액션의 실패 관례다.
                onPauseRun={pauseScheduleRun}
                onResumeRun={resumeScheduleRun}
                onRestartCoordinator={restartCoordinator}
                onApprove={(runId) => {
                  if (currentProject) approve(localDoor(window.api, currentProject), orchSnapshot, runId, actionUi)
                }}
                onDeleteRun={(runId) => {
                  if (currentProject) void deleteRun(localDoor(window.api, currentProject), orchSnapshot, runId, actionUi)
                }}
                // W1-C plan lifecycle: this computer's Jobs only (a paired Runtime's controller gate does not list them)
                onRenameJob={(jobId, title) => {
                  if (currentProject) void renameJob(localDoor(window.api, currentProject), jobId, title, actionUi)
                }}
                onArchiveJob={(jobId) => {
                  if (currentProject) void archiveJob(localDoor(window.api, currentProject), orchSnapshot, jobId, actionUi)
                }}
                onUnarchiveJob={(jobId) => {
                  if (currentProject) void unarchiveJob(localDoor(window.api, currentProject), jobId, actionUi)
                }}
                // W5-C (#39): stop launching new workers; nothing is closed, so nothing is asked
                onHoldJob={(jobId, hold) => {
                  if (currentProject) void holdJob(localDoor(window.api, currentProject), jobId, hold, actionUi)
                }}
              />
              )}
              </>
            ) : sidebarPane === 'understanding' ? (
              <UnderstandingView
                // Passed only when it belongs to the current project. Between switching projects and
                // the IPC round trip finishing, the cache still holds the previous project's data, and
                // passing it through as-is would stand the previous project's record list under the
                // new project's name — clicking a row would then open a tab that draws nothing. Until
                // then this is the same empty state as before any work was recorded (the same gap a
                // run configuration shows while waiting on run.list).
                understanding={understanding?.root === currentProject ? understanding.data : null}
                // Which row stays lit is decided by the tab tree — whichever record the active pane's
                // active tab holds, if any
                selectedRecordId={activeRecordId}
                onOpenRecord={openRecordTab}
                // [Write it up again] — does not wait. The row's status becomes "Writing up" and,
                // once it finishes, 'understanding:changed' makes this screen read itself again
                onRegenerate={(id) => currentProject && regenerateRecord(currentProject, id)}
                // Same "only when it belongs to the current project" guard as `understanding` above,
                // for the same reason.
                openTasks={openTasks?.root === currentProject ? openTasks.data : []}
                onCompleteTask={(id) => currentProject && completeOpenTask(currentProject, id)}
                onCancelTask={(id) => currentProject && cancelOpenTask(currentProject, id)}
              />
            ) : (
              <>
                <ProjectSwitcher
                  tree={workspaceTree}
                  byWorkspace={workspaceIds}
                  sessions={sessions}
                  selectedId={workspaceProjectId}
                  onSelect={openWorkspaceProject}
                  // W7-B
                  onNew={() => setProjectDialog('new')}
                  onAdd={() => setProjectDialog('add')}
                  onSettings={(id) => setProjectDialog({ settings: id })}
                  onOpenWindow={(id) => window.api.win.openNew(id)} // W9-K
                  toolsDisabledReason={projectAnchor ? undefined : 'Open a tab first'}
                />
                <AccountPanel accounts={accounts} />
                <WorkspaceSidebar
                  tree={workspaceTree}
                  data={workspaceData}
                  sessions={sessions}
                  showArchived={workspaceArchived}
                  onShowArchived={setWorkspaceArchived}
                  selectedPlanId={workspacePlanId}
                  onSelectPlan={openWorkspacePlan}
                  canOpenSession={canOpenSessionTab}
                  onOpenSession={(sessionId, jobId) => {
                    setWorkspaceScope(null, jobId)
                    selectWorkbenchTab(sessionTab(sessionId))
                  }}
                  // W7-C (#72): an escalation row opens the Run's window, its board holds the answer box
                  onOpenRun={(_runId, jobId) => {
                    const project = workspaceTree.find((p) => p.plans.some((plan) => plan.jobId === jobId))
                    if (!project) return
                    // The Run's window reads the current project's snapshot, so its project's tab comes first
                    enterWorkspace(project.id, jobId)
                    setJobsOpen(true) // the Run's window reads the snapshot the Jobs panel loads
                    // The Jobs list keys a plan's window by its Job (`foldedRunId` is the Run inside), as JobsView opens it
                    setPendingRun({ projectPath: project.path, runId: jobId })
                  }}
                />
                {/* W3-A: the activity feed, the open plan's (its workspace) or every plan's */}
                <ActivityPanel
                  planId={workspacePlanId}
                  accounts={accounts}
                  onOpenSession={(sessionId, jobId) => {
                    if (!canOpenSessionTab(sessionId)) return
                    setWorkspaceScope(null, jobId)
                    selectWorkbenchTab(sessionTab(sessionId))
                  }}
                />
                <WorktreePanel
                  onStartSession={(p) => {
                    setNewSessionCwd(p)
                    setShowNew(true)
                  }}
                />
                <HistoryBrowser
                  accounts={accounts}
                  ghostAccounts={ghostAccounts}
                  defaultSessionKind={defaultSessionKind}
                  onResume={resumeFromHistory}
                />
              </>
            )}
          </aside>
        )}
        {sidebarOpen && (
          <div
            className="resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('common.resizeSidebar')}
            onPointerDown={(e) => {
              e.preventDefault()
              const startId = e.pointerId
              const startX = e.clientX
              const startW = sidebarRef.current?.getBoundingClientRect().width ?? sidebarWidth
              let latestX = startX
              let rafId = 0
              const clamp = (x: number): number => Math.min(520, Math.max(160, startW + x - startX))
              const apply = (): void => {
                rafId = 0
                if (sidebarRef.current) sidebarRef.current.style.width = `${clamp(latestX)}px`
              }
              // MarkdownSplit 의 md-resizer 와 같은 이유로 pointerId 를 확인한다 — window 리스너는
              // 이 드래그를 시작한 포인터가 아닌 다른 포인터(예: 화면 다른 곳의 두 번째 터치 접점)의
              // pointermove/pointerup/pointercancel 도 그냥 받는다. 그 이벤트를 걸러내지 않으면 무관한
              // 포인터가 드래그를 조기에 끝내거나(onUp) 폭을 엉뚱한 좌표로 끌고 간다(onMove).
              const onMove = (ev: PointerEvent): void => {
                if (ev.pointerId !== startId) return
                latestX = ev.clientX
                if (!rafId) rafId = requestAnimationFrame(apply)
              }
              const onUp = (ev: PointerEvent): void => {
                if (ev.pointerId !== startId) return
                if (rafId) cancelAnimationFrame(rafId)
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', onUp)
                window.removeEventListener('pointercancel', onUp)
                document.body.classList.remove('resizing')
                const w = clamp(latestX)
                setSidebarWidth(w) // React state is synchronised here, once only
                localStorage.setItem('cm.sidebarWidth', String(w))
              }
              document.body.classList.add('resizing')
              window.addEventListener('pointermove', onMove)
              window.addEventListener('pointerup', onUp)
              window.addEventListener('pointercancel', onUp)
            }}
          />
        )}
    </>
  )
}
