// W9-B: the pages (DESIGN.md §2), one at a time below the top bar. Each page component is mounted by its owner prompt
// (W9-C Plans/Tasks, W9-D Inbox, W9-E Settings, W9-H Agents, W9-J Worktrees); until one lands, its page here is the
// panel that held that view in the retired sidebar. The consoles (Content) are rendered after the page's own column,
// always at the same place, and only hidden off the pages that show them, so no xterm remounts on a page switch.
import { useEffect, useState } from 'react'
import { HistoryBrowser } from '../HistoryBrowser'
import { FileExplorer } from '../FileExplorer'
import { JobsView } from '../JobsView'
import { UnderstandingView } from '../UnderstandingView'
import { WorktreePanel } from '../WorktreePanel'
import { RuntimeSelector } from '../RuntimeSelector'
import { RunToolbar } from '../RunToolbar'
import { controlReason, isRemoteRuntime, offlineNote } from '../../lib/remoteJobs'
import { deleteRun, pauseRun, restartCoordinator as restartRunCoordinator, resumeRun } from '../../lib/jobActions'
import { PlansPage, type PlansPageProps } from '../pages/PlansPage' // W9-C
import { TasksPage, type TasksPageProps } from '../pages/TasksPage' // W9-C
import { InboxPage } from '../inbox/InboxPage' // W9-D
import { AgentsPage, type AgentsPageProps } from '../pages/AgentsPage' // W9-H
import { getWallView, setWallView } from '../wall/wallView' // W9-H
import type { PageId } from '../../../../core/ui/pages'
import { Button, Field } from '../ui'
import { Content, type ContentProps } from './Content'
import type { AppState } from '../../state/appState'

/** The pages that show the consoles: Agents, and the pages whose own tabs open in the pane grid beside a list
 *  (Files' editor tabs, How It Works' records, Browser's tabs). */
export const showsConsoles = (page: PageId): boolean =>
  page === 'agents' || page === 'files' || page === 'more:hiw' || page === 'more:browser'

export type PagesProps = ContentProps &
  Omit<AgentsPageProps, 'children' | 'hidden'> &
  PlansPageProps &
  TasksPageProps &
  Pick<
    AppState,
    'accounts' | 'actionUi' | 'activeRecordId' | 'activeRuns' | 'applyRunSelection' | 'approve' | 'cancelOpenTask' |
    'closeExplorer' | 'completeOpenTask' | 'currentProject' | 'defaultSessionKind' | 'explorerClipboardRef' |
    'explorerReveal' | 'explorerTreesRef' | 'explorerUndoRef' | 'ghostAccounts' | 'handlePathDeleted' |
    'handlePathRenamed' | 'jobsRuntime' | 'openBrowserTab' | 'openProjectFile' | 'openRecordTab' | 'openRun' |
    'openRunManager' | 'openTasks' | 'openTerminal' | 'page' | 'pairedRuntimes' | 'regenerateRecord' |
    'remoteActionUi' | 'remoteProject' | 'remoteProjects' | 'remoteSnapshot' | 'remoteViewDoor' |
    'remoteViewPermission' | 'resumeFromHistory' | 'runConfigs' | 'runFile' | 'runJump' | 'runMenuOpen' | 'runs' |
    'runSelectConfigShortcut' | 'runSelectedId' | 'runStart' | 'runStop' | 'setDetail' | 'setExplorerReveal' |
    'setJobsRuntime' | 'setNewSessionCwd' | 'setOpenRun' | 'setRemoteNewRunOpen' | 'setRemoteProject' |
    'setRunMenuOpen' | 'setRunPanelOpen' | 'setShowNew' | 't' | 'understanding' | 'workspaceData' | 'workspaceTree'
  >

export function Pages(p: PagesProps): React.JSX.Element {
  const {
    accounts, actionUi, activeRecordId, activeRuns, applyRunSelection, approve, cancelOpenTask, closeExplorer,
    completeOpenTask, currentProject, defaultSessionKind, explorerClipboardRef, explorerReveal, explorerTreesRef,
    explorerUndoRef, ghostAccounts, handlePathDeleted, handlePathRenamed, jobsRuntime, openBrowserTab,
    openProjectFile, openRecordTab, openRun, openRunManager, openTasks, openTerminal, page, pairedRuntimes,
    regenerateRecord, remoteActionUi, remoteProject, remoteProjects, remoteSnapshot, remoteViewDoor,
    remoteViewPermission, resumeFromHistory, runConfigs, runFile, runJump, runMenuOpen, runs, runSelectConfigShortcut,
    runSelectedId, runStart, runStop, setDetail, setExplorerReveal, setJobsRuntime, setNewSessionCwd, setOpenRun,
    setRemoteNewRunOpen, setRemoteProject, setRunMenuOpen, setRunPanelOpen, setShowNew, t, understanding,
    workspaceData, workspaceTree
  } = p
  const [browserUrl, setBrowserUrl] = useState('')
  const wide = !showsConsoles(page)
  // W9-H: the wall is the Agents page's; any other page has the window, and coming back opens on the wall
  useEffect(() => {
    if (page !== 'agents') setWallView({ kind: 'away' })
    else if (getWallView().kind === 'away') setWallView({ kind: 'wall' })
  }, [page])
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
          {/* W9-C: the Plans page (PlansPage, its plan page included) and the Tasks page; a paired Runtime's plans keep
              their selector and list here (PlansPage's shortcut note) */}
          {page === 'plans' && (
            <div className="page-jobs">
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
        {isRemoteRuntime(jobsRuntime) && !openRun ? (
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
          <PlansPage {...p} />
        )}
            </div>
          )}
          {page === 'tasks' && <TasksPage {...p} />}
          {/* W9-D: the Inbox page */}
          {page === 'inbox' && <InboxPage tree={workspaceTree} data={workspaceData} accounts={accounts} ui={actionUi} />}
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
      {/* W9-H: the Agents page wraps the pane grid, which stays mounted for every session's life (AgentsPage) */}
      <AgentsPage {...p} hidden={wide}>
        <Content {...p} hidden={wide} />
      </AgentsPage>
    </div>
  )
}
