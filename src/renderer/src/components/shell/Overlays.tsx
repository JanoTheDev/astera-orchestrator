// Moved out of App.tsx unchanged (W9-A): the JSX is App's, the values come from App's state hooks.
import { RunDetail } from '../RunDetail'
import { NewRunModal } from '../NewRunModal'
import { SourceJobModal } from '../SourceJobModal'
import { NewSessionDialog } from '../NewSessionDialog'
import { RemoteSessionsDialog } from '../RemoteSessionsDialog'
import { RunConfigManager } from '../RunConfigManager'
import { ToastHost } from '../ToastHost'
import { remoteNewJobFolder } from '../../lib/remoteJobs'
import { localDoor } from '../../lib/orchDoor'
import { defaultAccountIdOf } from '../../../../core/accounts/defaultAccount'
import { CommandBar } from '../command/CommandBar'
import { ConfirmHost } from '../ConfirmHost'
import { FirstRunDialog } from '../FirstRunDialog'
import { findRun } from '../../../../core/orchestration/snapshot'
import { parentDir, resolveRelative } from '../../../../core/files/paths'
import { toast } from '../../lib/toast'
import { NewProjectDialog } from '../projects/NewProjectDialog'
import { AddProjectDialog } from '../projects/AddProjectDialog'
import { ProjectSettings } from '../projects/ProjectSettings'
import { StartPage, useDropToStart, useStartLanding } from '../pages/StartPage'
import { NewModal } from '../NewModal'
import { MAX_PANES, countLeaves, groupOfTab, splitAndMove, type PaneDir } from '../../../../core/panes/tree'
import { parseTab, sessionTab } from '../../../../core/panes/tabId'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import type { AppState } from '../../state/appState'
import { SettingsDialog } from './SettingsDialog'

export type OverlaysProps = Pick<
  AppState,
  'accounts' | 'actionUi' | 'agentAppEnabled' | 'agentBrowserEnabled' | 'agentBusy' | 'agentYolo' | 'appVersion' |
  'autoCloseEndedPlanTabs' | 'browserTabsRef' | 'cli' | 'cliInstallStatus' | 'closeWorkbenchTab' | 'commandOpen' |
  'currentProject' | 'defaultSessionKind' | 'detail' | 'detailDoor' | 'firstPlan' | 'firstRunAsked' | 'homeDir' |
  'hostHolding' | 'hostRestarting' | 'hostStatus' | 'installUpdate' | 'jobsRuntime' | 'keyOverrides' | 'layout' |
  'layoutRef' | 'managerFor' | 'managerInitialSelectedId' | 'newRunOpen' | 'newSessionCwd' | 'openLinkedFolder' |
  'openRemoteSession' | 'openRun' | 'openWorkspacePlan' | 'openWorkspaceProject' | 'orchSnapshot' | 'pairedRuntimes' |
  'pendingSplitRef' | 'projectAnchor' | 'projectDialog' | 'remoteAccounts' | 'remoteDialog' | 'remoteNewRunOpen' |
  'remoteProject' | 'remoteProjects' | 'remoteReadOnly' | 'remoteSessions' | 'remoteSnapshot' | 'remoteViewDoor' |
  'restartHost' | 'runManagerApply' | 'runningCount' | 'selectWorkbenchTab' | 'setActivePaneId' |
  'setAgentAppEnabled' | 'setAgentBrowserEnabled' | 'setAgentYolo' | 'setAutoCloseEndedPlanTabs' |
  'setCheckClickedAt' | 'setCli' | 'setCliInstallStatus' | 'setCliInstalled' | 'setCommandOpen' |
  'setDefaultSessionKind' | 'setDetail' | 'setFirstPlan' | 'setFirstRunAsked' | 'setJournalPagesFor' |
  'setKeyOverrides' | 'setLang' | 'setLayout' | 'setManagerFor' | 'setManagerInitialSelectedId' | 'setNewRunOpen' |
  'setNewSessionCwd' | 'setOpenRun' | 'setPairedChanged' | 'setProjectDialog' | 'setProjectsRefresh' |
  'setRemoteDialog' | 'setRemoteNewRunOpen' | 'setRenamingTabId' | 'setSettingsTab' | 'setShowNew' | 'settingsAnchor' | 'setSettingsAnchor' |
  'setShowSettings' | 'setSourceJobOpen' | 'setTabMenu' | 'setWorkUnitTrackingEnabled' | 'setWorkspaceScope' |
  'setWtRoot' | 'settingsTab' | 'settingsTouched' | 'showNew' | 'showSettings' | 'sourceJobOpen' | 'spawn' |
  'stopRemoteSession' | 'storedLang' | 'systemLang' | 't' | 'tabMenu' | 'talkSignal' | 'unsplitPane' | 'update' |
  'updateChecking' | 'workUnitTrackingEnabled' | 'workspaceCwd' | 'workspaceData' | 'workspacePlanId' |
  'workspaceTree' | 'wtRoot' |
  /* W9-E */ 'start' | 'openStart' | 'newOpen' | 'setNewOpen' | 'sessions'
>

export function Overlays(p: OverlaysProps): React.JSX.Element {
  const {
    accounts, actionUi, agentAppEnabled, agentBrowserEnabled, agentBusy, agentYolo, appVersion,
    autoCloseEndedPlanTabs, browserTabsRef, cli, cliInstallStatus, closeWorkbenchTab, commandOpen, currentProject,
    defaultSessionKind, detail, detailDoor, firstPlan, firstRunAsked, homeDir, hostHolding, hostRestarting,
    hostStatus, installUpdate, jobsRuntime, keyOverrides, layout, layoutRef, managerFor, managerInitialSelectedId,
    newRunOpen, newSessionCwd, openLinkedFolder, openRemoteSession, openRun, openWorkspacePlan, openWorkspaceProject,
    orchSnapshot, pairedRuntimes, pendingSplitRef, projectAnchor, projectDialog, remoteAccounts, remoteDialog,
    remoteNewRunOpen, remoteProject, remoteProjects, remoteReadOnly, remoteSessions, remoteSnapshot, remoteViewDoor,
    restartHost, runManagerApply, runningCount, selectWorkbenchTab, setActivePaneId, setAgentAppEnabled,
    setAgentBrowserEnabled, setAgentYolo, setAutoCloseEndedPlanTabs, setCheckClickedAt, setCli, setCliInstallStatus,
    setCliInstalled, setCommandOpen, setDefaultSessionKind, setDetail, setFirstPlan, setFirstRunAsked,
    setJournalPagesFor, setKeyOverrides, setLang, setLayout, setManagerFor, setManagerInitialSelectedId,
    setNewRunOpen, setNewSessionCwd, setOpenRun, setPairedChanged, setProjectDialog, setProjectsRefresh,
    setRemoteDialog, setRemoteNewRunOpen, setRenamingTabId, setSettingsTab, setShowNew, setShowSettings,
    setSourceJobOpen, setTabMenu, setWorkUnitTrackingEnabled, setWorkspaceScope, setWtRoot, settingsTab,
    settingsTouched, showNew, showSettings, sourceJobOpen, spawn, stopRemoteSession, storedLang, systemLang, t,
    tabMenu, talkSignal, unsplitPane, update, updateChecking, workUnitTrackingEnabled, workspaceCwd, workspaceData,
    workspacePlanId, workspaceTree, wtRoot, start, openStart, newOpen, setNewOpen, sessions
  } = p
  // W9-E: an empty project lands on Start; files dropped on the window open it
  useStartLanding(currentProject, sessions, openStart)
  useDropToStart(openStart)
  const startShown = firstPlan ? { req: { text: firstPlan.objective }, cwd: firstPlan.path } : start && currentProject ? { req: start, cwd: start.cwd ?? currentProject } : null
  return (
    <>
      {showNew && (
        <NewSessionDialog
          accounts={accounts}
          defaultSessionKind={defaultSessionKind}
          runningCount={runningCount}
          initialCwd={newSessionCwd ?? workspaceCwd}
          // The promise is passed straight through — the dialog awaits it to show a start-pending state
          // (discarding it with void would make the wait look instantly over)
          onSpawn={spawn}
          runtimes={pairedRuntimes}
          onRemote={(runtimeId) => {
            pendingSplitRef.current = null
            setShowNew(false)
            setNewSessionCwd(null)
            setRemoteDialog(runtimeId)
          }}
          onCancel={() => {
            // Cancels the split Ctrl+\ reserved — closing the dialog leaves no empty pane
            pendingSplitRef.current = null
            setShowNew(false)
            setNewSessionCwd(null)
          }}
        />
      )}
      {remoteDialog !== null && (
        <RemoteSessionsDialog
          runtimes={pairedRuntimes}
          runtimeId={remoteDialog}
          readOnly={remoteReadOnly(remoteDialog)}
          onRuntime={setRemoteDialog}
          onLocal={() => {
            setRemoteDialog(null)
            setShowNew(true)
          }}
          onOpen={(ref) => {
            setRemoteDialog(null)
            openRemoteSession(ref)
          }}
          onCancel={() => setRemoteDialog(null)}
        />
      )}
      <SettingsDialog {...p} />
      {/* The pane tab context menu — the entry point for split and unsplit. It serves every kind of tab:
          the id goes to the tree unread, and Close takes the same path the tab's × does (a dirty file
          still asks for confirmation, a session is still ended). What gets split is the group the
          right-clicked tab belongs to, not the active pane — so right-clicking a tab in another group
          does not split the wrong one (the same as IntelliJ). */}
      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
          items={((): MenuItem[] => {
            const cur = layout
            const tid = tabMenu.tabId
            const group = cur ? groupOfTab(cur, tid) : null
            const atMax = cur != null && countLeaves(cur) >= MAX_PANES
            // With only one tab in the group, splitting changes nothing (splitAndMove returns null) — shown as disabled
            const cantSplit = !group || atMax || group.tabIds.length < 2
            const split = (dir: PaneDir): void => {
              // The tree as written, not the copy this menu was rendered from: a tab placed in the background
              // since that render (a session taken back, an agent's tab) would be dropped by a split made from it
              // (final review of the taken-back tabs fix, minor 2).
              const now = layoutRef.current
              const from = now ? groupOfTab(now, tid) : null
              if (!now || !from) return
              const res = splitAndMove(now, tid, from.id, dir, false)
              if (!res) return
              setLayout(res.root)
              setActivePaneId(res.paneId)
            }
            const tabRef = parseTab(tid)
            const remote = tabRef?.kind === 'session' ? remoteSessions.find((r) => r.key === tabRef.id) : undefined
            const isSession = tabRef?.kind === 'session' && !remote
            // An agent's tab while its script runs: the one way to end it from the UI. Main aborts the
            // run and tells the CLI; nothing here waits for it.
            const agentTab = parseTab(tid)?.kind === 'browser' ? browserTabsRef.current.find((b) => b.id === tid && b.agentSessionId !== undefined) : undefined
            const agentSid = agentTab?.agentSessionId
            const agentRunning = agentSid !== undefined && agentBusy[agentSid] === true
            return [
              // 세션 탭에만. 파일 탭의 라벨은 파일 이름이라 여기서 바꿀 것이 아니고, 기록 탭의
              // 라벨은 그 기록의 요청문이다. 더블클릭과 같은 자리를 연다.
              ...(isSession
                ? ([
                    {
                      label: t('session.tab.rename'),
                      onSelect: () => setRenamingTabId(tid)
                    },
                    'separator'
                  ] as MenuItem[])
                : []),
              ...(remote
                ? ([
                    {
                      label: t('remote.session.stop'),
                      danger: true,
                      disabled: !remote.alive || remoteReadOnly(remote.runtimeId),
                      onSelect: () => void stopRemoteSession(remote)
                    },
                    'separator'
                  ] as MenuItem[])
                : []),
              ...(agentSid !== undefined
                ? ([
                    {
                      label: t('preview.agent.stop'),
                      disabled: !agentRunning,
                      onSelect: () => {
                        void window.api.preview.agentStop(agentSid).then((stopped) => {
                          if (stopped) toast.info(t('preview.agent.stopped'))
                        })
                      }
                    },
                    'separator'
                  ] as MenuItem[])
                : []),
              {
                label: t('session.pane.splitRight'),
                disabled: cantSplit,
                onSelect: () => split('row')
              },
              {
                label: t('session.pane.splitDown'),
                disabled: cantSplit,
                onSelect: () => split('col')
              },
              {
                label: t('session.pane.unsplit'),
                disabled: cur == null || countLeaves(cur) < 2,
                onSelect: () => group && unsplitPane(group.id)
              },
              'separator',
              { label: t('common.close'), danger: true, onSelect: () => closeWorkbenchTab(tid) }
            ]
          })()}
        />
      )}
      {/* Renders from the snapshot the dialog was opened with (managerFor), not the live
          currentProject/runContext — see managerFor's comment for why. */}
      {managerFor && (
        <RunConfigManager
          configs={managerFor.configs}
          context={managerFor.context}
          isSpringBoot={managerFor.isSpringBoot}
          isPythonProject={managerFor.isPythonProject}
          hasDockerfile={managerFor.hasDockerfile}
          projectPath={managerFor.projectPath}
          initialSelectedId={managerInitialSelectedId}
          onApply={(configs) => runManagerApply(managerFor.projectPath, configs)}
          onClose={() => {
            setManagerFor(null)
            setManagerInitialSelectedId(undefined)
          }}
        />
      )}
      {openRun && detailDoor && (
        <RunDetail
          door={detailDoor}
          // 그래프의 노드는 제목·상태·세션을 스냅샷에서 읽는다(detail 의 layers 는 id 뿐이다).
          // 그 Run 이 스냅샷에서 사라졌으면(다른 프로젝트로 갔거나 지워졌다) undefined 다.
          // findRun 인 이유는 위 두 효과와 같다 — 예약 회차는 children 안에 있다(snapshot.ts).
          run={(() => {
            const snap = openRun.runtimeId ? remoteSnapshot : orchSnapshot
            return snap ? findRun(snap, openRun.runId) : undefined
          })()}
          runtimeId={openRun.runtimeId}
          detail={detail}
          // Task 짓기(task-create)와 검증 구성 조회(run.list)가 쓴다 — run 이 undefined 인 동안에도
          // openRun 이 이 짝을 그대로 들고 있으므로 run?.id 를 대신 넘길 이유가 없다.
          projectPath={openRun.projectPath}
          runId={openRun.runId}
          // Verbatim the pair JobsView is handed above, and for the reason its comment there records:
          // the tab tree is the only place that knows whether the worker's tab is still open, so a
          // sessions.some(...) check would keep saying yes after the user closed it and the ↗ would
          // silently do nothing.
          canOpenSession={(sessionId) => !!layout && !!groupOfTab(layout, sessionTab(sessionId))}
          onOpenSession={(sessionId) => {
            setOpenRun(null) // 탭으로 가면서 닫는다
            selectWorkbenchTab(sessionTab(sessionId))
          }}
          onShowOlderJournal={() =>
            setJournalPagesFor((prev) => ({
              runId: openRun.runId,
              pages: (prev?.runId === openRun.runId ? prev.pages : 1) + 1
            }))
          }
          onClose={() => setOpenRun(null)}
          // W6-E progress view: a plan's affected path, shown in the explorer (its folder, as a folder link is)
          onOpenPath={
            openRun.runtimeId
              ? undefined
              : (rel) => {
                  setOpenRun(null)
                  openLinkedFolder(parentDir(resolveRelative(`${openRun.projectPath}/.`, rel)))
                }
          }
        />
      )}
      {/* currentProject 가 있을 때만 그린다 — 없으면 run-create 에 넘길 cwd 가 없어 만들 자리가
          없다. **Jobs 사이드바 자체는 currentProject 없이도 열린다** — 프로젝트가 없으면
          orchSnapshot 이 `{ runs: [] }` 로 채워져(그 effect 의 `currentProject === null ? { runs: [] } : null`) 빈 상태가 그려진다. "프로젝트 없이
          이 값이 true 가 되는" 사고는 그 빈 상태의 "+ 새 작업" 버튼과 onNewRun 콜백 쪽에서 이미
          막아 두었다(JobsView 의 hasProject, 바로 위 onNewRun) — currentProject 없이는 newRunOpen
          자체가 true 가 되지 않으므로 이 조건은 실제로는 걸리지 않지만, 렌더 자리를 currentProject
          와 별개로 옮기지 않기 위해 남겨 둔다. */}
      {remoteNewRunOpen && remoteViewDoor && (
        // A new Job on the paired Runtime, in its project's own folder there (never a path on this computer); none
        // under "Unregistered folders" (remoteNewJobFolder).
        <NewRunModal
          door={remoteViewDoor}
          cwd={remoteNewJobFolder(remoteProjects, remoteProject)}
          projectFolderBusy={remoteSnapshot?.projectFolderBusy ?? false}
          accounts={remoteAccounts}
          onClose={() => setRemoteNewRunOpen(false)}
          onCreated={(runId) => {
            setRemoteNewRunOpen(false)
            if (remoteProject) setOpenRun({ projectPath: remoteProject, runId, runtimeId: jobsRuntime })
          }}
        />
      )}
      {/* W7-B project dialogs */}
      {projectAnchor && projectDialog === 'new' && (
        <NewProjectDialog
          anchor={projectAnchor}
          onClose={() => setProjectDialog(null)}
          onCreated={(id) => {
            setProjectsRefresh((n) => n + 1)
            openWorkspaceProject(id)
          }}
          onStartPlan={(path, objective) => setFirstPlan({ path, objective })}
        />
      )}
      {projectAnchor && projectDialog === 'add' && (
        <AddProjectDialog
          anchor={projectAnchor}
          onClose={() => setProjectDialog(null)}
          onAdded={(id) => {
            setProjectsRefresh((n) => n + 1)
            openWorkspaceProject(id)
          }}
        />
      )}
      {projectAnchor && projectDialog !== null && typeof projectDialog === 'object' && (
        <ProjectSettings anchor={projectAnchor} projectId={projectDialog.settings} accounts={accounts} onClose={() => setProjectDialog(null)} />
      )}
      {/* W9-E: a new project's first plan, New's two plan modes and a window drop all open the Start page */}
      {startShown && (
        <StartPage
          key={startShown.cwd}
          req={startShown.req}
          cwd={startShown.cwd}
          accounts={accounts}
          onClose={() => {
            setFirstPlan(null)
            openStart(null)
          }}
          onOpenConsole={() => setShowNew(true)}
          onOtherSources={() => setSourceJobOpen(startShown.cwd)}
        />
      )}
      {newOpen && (
        <NewModal
          onClose={() => setNewOpen(false)}
          onConsole={() => {
            setNewOpen(false)
            setShowNew(true)
          }}
          onStart={(mode) => {
            setNewOpen(false)
            openStart({ mode })
          }}
        />
      )}
      {/* W3-B command bar: names resolve against the workspace tree; changes go through this computer's doors */}
      <CommandBar
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        tree={workspaceTree}
        data={workspaceData}
        currentProject={currentProject}
        currentPlanId={workspacePlanId}
        ui={actionUi}
        talkSignal={talkSignal}
        onOpenSession={(sessionId, jobId) => {
          if (jobId) setWorkspaceScope(null, jobId)
          selectWorkbenchTab(sessionTab(sessionId))
        }}
        deps={{
          door: (projectPath) => localDoor(window.api, projectPath),
          attention: (sessionId) => window.api.conversation.attention(sessionId),
          openPlan: openWorkspacePlan,
          openRun: (projectPath, runId) => {
            setDetail(null)
            setOpenRun({ projectPath, runId })
          },
          // W5-C (#41): read when asked, for a plan of any project, not the Jobs view's current snapshot
          snapshotFor: (projectPath) => window.api.orch.peek(projectPath),
          coordinatorAccount: async () => {
            const signedIn = await localDoor(window.api, currentProject ?? homeDir ?? '').signedInIds(accounts)
            return defaultAccountIdOf('claude', accounts, signedIn)
          }
        }}
      />
      {newRunOpen && currentProject && (
        <NewRunModal
          door={localDoor(window.api, currentProject)}
          cwd={currentProject}
          // 스냅숏이 이미 프로젝트별로 접혀 오므로 폴더 사실이 앉을 자리가 그것이다(view.ts).
          // 아직 안 왔으면 거짓 — 없는 것을 경고하는 것보다 낫다
          projectFolderBusy={orchSnapshot?.projectFolderBusy ?? false}
          accounts={accounts}
          onClose={() => setNewRunOpen(false)}
          onCreated={(runId) => {
            setNewRunOpen(false)
            // 만들자마자 상세 창을 열어 Task 를 짤 수 있게 한다 — onOpenRun 이 하는 것과 같은 짝
            setOpenRun({ projectPath: currentProject, runId })
          }}
        />
      )}
      {sourceJobOpen !== null && (
        <SourceJobModal
          projectPath={sourceJobOpen}
          accounts={accounts}
          onClose={() => setSourceJobOpen(null)}
          onCreated={(jobId) => {
            const project = sourceJobOpen
            setSourceJobOpen(null)
            // As NewRunModal's: the Job made opens at once (plan P5)
            setOpenRun({ projectPath: project, runId: jobId })
          }}
          onOpenJob={(jobId) => {
            // Only a Job the Jobs view shows can open: one it does not would close its detail at once and take the
            // window with it (4c final review I2). The Host lists the project's own Jobs; this is the second guard.
            if (orchSnapshot === null || !findRun(orchSnapshot, jobId)) return
            const project = sourceJobOpen
            setSourceJobOpen(null)
            setOpenRun({ projectPath: project, runId: jobId })
          }}
        />
      )}
      <ConfirmHost />
      {/* The first-run question. Two things gate it, and the second was measured rather than guessed:
          it sits below the CLI-missing branch above, which returns early, and it waits for an account
          to exist. A genuinely fresh profile opens with the detected-accounts modal already up, and
          this one stacked straight on top of it — two modals on the very first screen. Waiting is also
          the better question: before there is an account there are no sessions to have a default view
          for. Answering and dismissing settle it the same way — it asks once.

          A chat tab is the third gate, and the reason is that the question does not apply to one: a
          chat session has one view and no terminal to default to, so asking "터미널 or 대화?" over it
          would settle a preference the tab underneath cannot honour — and dismissing is permanent, so
          it would burn the one asking. Deferred, not dismissed: the next time a terminal tab is
          active, the question is still waiting. */}
      {firstRunAsked === false && accounts.length > 0 && (
        <FirstRunDialog
          onPick={(kind) => {
            setFirstRunAsked(true)
            setDefaultSessionKind(kind)
            void window.api.settings.setDefaultSessionKind(kind)
            void window.api.settings.markFirstRunAsked()
          }}
          onDismiss={() => {
            setFirstRunAsked(true)
            void window.api.settings.markFirstRunAsked()
          }}
        />
      )}
      <ToastHost />
    </>
  )
}
