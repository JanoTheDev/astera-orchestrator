// W9-B: the pages (DESIGN.md §2), one at a time below the top bar. Each page component is mounted by its owner prompt
// (W9-C Plans/Tasks, W9-D Inbox, W9-E Settings, W9-H Agents, W9-J Worktrees); until one lands, its page here is the
// panel that held that view in the retired sidebar. The consoles (Content) are rendered after the page's own column,
// always at the same place, and only hidden off the pages that show them, so no xterm remounts on a page switch.
import { useState } from 'react'
import { HistoryBrowser } from '../HistoryBrowser'
import { FileExplorer } from '../FileExplorer'
import { JobsView } from '../JobsView'
import { jobsStall } from '../../../../core/orchestration/jobsView'
import { UnderstandingView } from '../UnderstandingView'
import { WorktreePanel } from '../WorktreePanel'
import { RuntimeSelector } from '../RuntimeSelector'
import { RunToolbar } from '../RunToolbar'
import { controlReason, isRemoteRuntime, offlineNote } from '../../lib/remoteJobs'
import { localDoor } from '../../lib/orchDoor'
import { deleteRun, pauseRun, restartCoordinator as restartRunCoordinator, resumeRun } from '../../lib/jobActions'
// W1-C plan lifecycle
import { archiveJob, holdJob, renameJob, unarchiveJob } from '../../lib/jobActions'
import { ActivityPanel } from '../activity/ActivityPanel' // W3-A
import { SessionSearch } from '../search/SessionSearch' // W3-C
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import type { PageId } from '../../../../core/ui/pages'
import { Button, Field } from '../ui'
import { Content, type ContentProps } from './Content'
import { openPlan } from './navigation'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'

/** The pages that show the consoles: Agents, and the pages whose own tabs open in the pane grid beside a list
 *  (Files' editor tabs, How It Works' records, Browser's tabs). */
export const showsConsoles = (page: PageId): boolean =>
  page === 'agents' || page === 'files' || page === 'more:hiw' || page === 'more:browser'

export type PagesProps = ContentProps &
  Pick<
    AppState,
    'accounts' | 'actionUi' | 'activeRecordId' | 'activeRuns' | 'applyRunSelection' | 'approve' | 'canOpenSessionTab' |
    'cancelOpenTask' | 'closeExplorer' | 'completeOpenTask' | 'currentProject' | 'defaultSessionKind' |
    'explorerClipboardRef' | 'explorerReveal' | 'explorerTreesRef' | 'explorerUndoRef' | 'ghostAccounts' |
    'handlePathDeleted' | 'handlePathRenamed' | 'hostDriver' | 'hostStatus' | 'jobsRuntime' | 'layout' |
    'openBrowserTab' | 'openProjectFile' | 'openTerminal' | 'openRecordTab' | 'openRunManager' | 'openTasks' | 'orchHostGate' |
    'orchSnapshot' | 'page' | 'pairedRuntimes' | 'parkedSinceMs' | 'pauseScheduleRun' | 'regenerateRecord' |
    'remoteActionUi' | 'remoteProject' | 'remoteProjects' | 'remoteSnapshot' | 'remoteViewDoor' |
    'remoteViewPermission' | 'restartCoordinator' | 'resumeFromHistory' | 'resumeScheduleRun' | 'runConfigs' |
    'runFile' | 'runJump' | 'runMenuOpen' | 'runSelectConfigShortcut' | 'runSelectedId' | 'runStart' | 'runStop' |
    'runs' | 'selectWorkbenchTab' | 'setDetail' | 'setExplorerReveal' | 'setJobsRuntime' | 'setNewRunOpen' |
    'setNewSessionCwd' | 'setOpenRun' | 'setRemoteNewRunOpen' | 'setRemoteProject' | 'setRunMenuOpen' |
    'setRunPanelOpen' | 'setShowNew' | 'setSourceJobOpen' | 'setWorkspaceScope' | 't' | 'understanding' |
    'workspacePlanId'
  > &
  Pick<ShellState, 'needsYou' | 'sessionIndex'>

export function Pages(p: PagesProps): React.JSX.Element {
  const {
    accounts, actionUi, activeRecordId, activeRuns, applyRunSelection, approve, canOpenSessionTab, cancelOpenTask,
    closeExplorer, completeOpenTask, currentProject, defaultSessionKind, explorerClipboardRef, explorerReveal,
    explorerTreesRef, explorerUndoRef, ghostAccounts, handlePathDeleted, handlePathRenamed, hostDriver, hostStatus,
    jobsRuntime, layout, needsYou, openBrowserTab, openProjectFile, openTerminal, openRecordTab, openRunManager, openTasks,
    orchHostGate, orchSnapshot, page, pairedRuntimes, parkedSinceMs, pauseScheduleRun, regenerateRecord,
    remoteActionUi, remoteProject, remoteProjects, remoteSnapshot, remoteViewDoor, remoteViewPermission,
    restartCoordinator, resumeFromHistory, resumeScheduleRun, runConfigs, runFile, runJump, runMenuOpen,
    runSelectConfigShortcut, runSelectedId, runStart, runStop, runs, selectWorkbenchTab, sessionIndex, setDetail,
    setExplorerReveal, setJobsRuntime, setNewRunOpen, setNewSessionCwd, setOpenRun, setRemoteNewRunOpen,
    setRemoteProject, setRunMenuOpen, setRunPanelOpen, setShowNew, setSourceJobOpen, setWorkspaceScope, t,
    understanding, workspacePlanId
  } = p
  const [browserUrl, setBrowserUrl] = useState('')
  const openSession = (sessionId: string, jobId: string): void => {
    if (!canOpenSessionTab(sessionId)) return
    setWorkspaceScope(null, jobId)
    selectWorkbenchTab(sessionTab(sessionId))
  }
  const wide = !showsConsoles(page)
  return (
    <div className="pages">
      {page === 'files' && (
        <aside className="page-side">
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
        </aside>
      )}
      {page === 'more:hiw' && (
        <aside className="page-side">
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
        </aside>
      )}
      {wide && (
        <section className="page" aria-label={page}>
          {(page === 'plans' || page === 'tasks') && (
            <div className="page-jobs">
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
            </div>
          )}
          {/* Until W9-D: "Needs you" (W3-C's needs-input list) and "Handled for you" (W3-A's activity feed) */}
          {page === 'inbox' && (
            <div className="page-inbox">
              <div className="page-inbox-needs">
                <h2 className="page-title">Needs you</h2>
                <SessionSearch
                  index={sessionIndex}
                  inbox={needsYou}
                  showInbox
                  canOpenSession={canOpenSessionTab}
                  onOpenSession={openSession}
                  onSelectPlan={(jobId) => openPlan(jobId)}
                  // W7-C (#72): an escalation row opens the Run's window, its board holds the answer box
                  onOpenRun={(_runId, jobId) => openPlan(jobId)}
                />
              </div>
              <div className="page-inbox-handled">
                <ActivityPanel planId={workspacePlanId} accounts={accounts} onOpenSession={openSession} />
              </div>
            </div>
          )}
          {page === 'worktrees' && (
            <WorktreePanel
              onStartSession={(p) => {
                setNewSessionCwd(p)
                setShowNew(true)
              }}
            />
          )}
          {page === 'more:history' && (
            <HistoryBrowser
              asPage
              accounts={accounts}
              ghostAccounts={ghostAccounts}
              defaultSessionKind={defaultSessionKind}
              onResume={resumeFromHistory}
            />
          )}
          {page === 'more:runs' && (
            <div className="page-runs">
              <h2 className="page-title">Run configs</h2>
              {currentProject ? (
                <RunToolbar
                  configs={runConfigs}
                  selectedId={runSelectedId}
                  onSelect={(id) => applyRunSelection(currentProject, id)}
                  runs={runs}
                  onRun={() => runStart()}
                  onRunConfig={(id) => {
                    applyRunSelection(currentProject, id)
                    runStart(id)
                  }}
                  onStop={runStop}
                  onOpenManager={() => openRunManager()}
                  onEditConfig={(id) => openRunManager(id)}
                  activeRuns={activeRuns}
                  onJump={runJump}
                  onStopRun={runStop}
                  menuOpen={runMenuOpen}
                  onMenuOpenChange={setRunMenuOpen}
                  shortcut={runSelectConfigShortcut}
                />
              ) : (
                <p className="page-note">Open a project to run its configurations.</p>
              )}
              <div className="page-actions">
                <Button size="sm" onClick={() => setRunPanelOpen(true)}>
                  Show output
                </Button>
                {/* the rail's terminal button, now here: the drawer opens on a new shell */}
                <Button size="sm" onClick={() => void openTerminal()}>
                  New terminal
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
      {page === 'more:browser' && (
        <aside className="page-side">
          <h2 className="page-title">Browser</h2>
          <form
            className="page-browser-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (browserUrl.trim()) openBrowserTab(browserUrl.trim())
            }}
          >
            <Field
              kind="text"
              label="Open a page"
              hint={currentProject ? 'It opens as a tab beside the consoles.' : 'Open a project first.'}
              value={browserUrl}
              onChange={(e) => setBrowserUrl(e.target.value)}
              placeholder="localhost:5173 or a URL"
            />
            <Button type="submit" size="sm" disabled={!currentProject || !browserUrl.trim()}>
              Open
            </Button>
          </form>
        </aside>
      )}
      <Content {...p} hidden={wide} />
    </div>
  )
}
