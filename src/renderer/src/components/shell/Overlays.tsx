// Moved out of App.tsx unchanged (W9-A): the JSX is App's, the values come from App's state hooks.
import { SourceJobModal } from '../SourceJobModal'
import { NewSessionDialog, rememberMachine } from '../NewSessionDialog'
import { RemoteSessionsDialog } from '../RemoteSessionsDialog'
import { RunConfigManager } from '../RunConfigManager'
import { remoteNewJobFolder } from '../../lib/remoteJobs'
import { localDoor } from '../../lib/orchDoor'
import { defaultAccountIdOf } from '../../../../core/accounts/defaultAccount'
import { CommandBar } from '../command/CommandBar'
import { openActivity, openPlan } from './navigation'
import { ConfirmHost } from '../ui/ConfirmHost'
import { AutoLimitsCrashNotice, CrashReportHost } from '../CrashReportPrompt'
import { Onboarding } from '../onboarding/Onboarding'
import { exitEffects, isOnboardingShown, projectDialogOf } from '../onboarding/onboardingModel'
import { setOnboardingReplay, useOnboardingReplay } from '../onboarding/replay'
import { findRun } from '../../../../core/orchestration/snapshot'
import { toast } from '../../lib/toast'
import { NewProjectDialog } from '../projects/NewProjectDialog'
import { AddProjectDialog } from '../projects/AddProjectDialog'
import { CloneProjectDialog } from '../projects/CloneProjectDialog'
import { ProjectSettings } from '../projects/ProjectSettings'
import { useDropToStart, useStartLanding } from '../pages/StartPage'
import { NewModal } from '../NewModal'
import { MAX_PANES, countLeaves, groupOfTab, splitAndMove, type PaneDir } from '../../../../core/panes/tree'
import { parseTab, parseRemoteSessionKey, sessionTab } from '../../../../core/panes/tabId'
import { Menu, ToastViewport, type MenuItem } from '../ui'
import { isConfirmOpen } from '../../lib/confirm'
import { isMac } from '../../lib/platformKeys'
import { closeInSequence, closeTargets, relativeUnder, tabActions, type TabMenuKind } from './tabMenu'
import { copyText, moveTargets, moveToAccount, revealPath, stopKeepTab } from './tabActions'
import type { AppState } from '../../state/appState'
import { HelpPanel } from '../help/HelpPanel'
import { setHelpOpen, useHelpOpen } from '../help/helpStore'

export type OverlaysProps = Pick<
  AppState,
  'accounts' | 'actionUi' | 'agentAppEnabled' | 'agentBrowserEnabled' | 'agentBusy' | 'agentYolo' | 'appVersion' |
  'autoCloseEndedPlanTabs' | 'browserTabsRef' | 'cli' | 'cliInstallStatus' | 'cliInstalled' | 'closeWorkbenchTab' | 'commandOpen' |
  'currentProject' | 'defaultSessionKind' | 'firstPlan' | 'firstRunAsked' | 'homeDir' |
  'hostHolding' | 'hostRestarting' | 'hostStatus' | 'installUpdate' | 'jobsRuntime' | 'keyOverrides' | 'layout' |
  'layoutRef' | 'managerFor' | 'managerInitialSelectedId' | 'newSessionCwd' | 'openLinkedFolder' | 'openLinkedPath' |
  'openRemoteSession' | 'openWorkspacePlan' | 'openWorkspaceProject' | 'orchSnapshot' | 'pairedRuntimes' |
  'pendingSplitRef' | 'projectAnchor' | 'projectDialog' | 'remoteAccounts' | 'remoteDialog' |
  'remoteProject' | 'remoteProjects' | 'remoteReadOnly' | 'remoteSessions' | 'remoteSnapshot' | 'remoteViewDoor' |
  'restart' | 'restartHost' | 'runManagerApply' | 'runningCount' | 'selectWorkbenchTab' | 'setActivePaneId' |
  'setAgentAppEnabled' | 'setAgentBrowserEnabled' | 'setAgentYolo' | 'setAutoCloseEndedPlanTabs' |
  'setCheckClickedAt' | 'setCli' | 'setCliInstallStatus' | 'setCliInstalled' | 'setCommandOpen' |
  'setDefaultSessionKind' | 'setDetail' | 'setFirstPlan' | 'setFirstRunAsked' |
  'setKeyOverrides' | 'setLang' | 'setLayout' | 'setManagerFor' | 'setManagerInitialSelectedId' |
  'setNewSessionCwd' | 'setOpenRun' | 'setPairedChanged' | 'setProjectDialog' | 'setProjectsRefresh' |
  'setRemoteDialog' | 'setRenamingTabId' | 'setSettingsTab' | 'setShowNew' | 'settingsAnchor' | 'setSettingsAnchor' |
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
    autoCloseEndedPlanTabs, browserTabsRef, cli, cliInstallStatus, cliInstalled, closeWorkbenchTab, commandOpen, currentProject,
    defaultSessionKind, firstPlan, firstRunAsked, homeDir, hostHolding, hostRestarting,
    hostStatus, installUpdate, jobsRuntime, keyOverrides, layout, layoutRef, managerFor, managerInitialSelectedId,
    newSessionCwd, openLinkedFolder, openLinkedPath, openRemoteSession, openWorkspacePlan, openWorkspaceProject,
    orchSnapshot, pairedRuntimes, pendingSplitRef, projectAnchor, projectDialog, remoteAccounts, remoteDialog,
    remoteProject, remoteProjects, remoteReadOnly, remoteSessions, remoteSnapshot, remoteViewDoor,
    restart, restartHost, runManagerApply, runningCount, selectWorkbenchTab, setActivePaneId, setAgentAppEnabled,
    setAgentBrowserEnabled, setAgentYolo, setAutoCloseEndedPlanTabs, setCheckClickedAt, setCli, setCliInstallStatus,
    setCliInstalled, setCommandOpen, setDefaultSessionKind, setDetail, setFirstPlan, setFirstRunAsked,
    setKeyOverrides, setLang, setLayout, setManagerFor, setManagerInitialSelectedId,
    setNewSessionCwd, setOpenRun, setPairedChanged, setProjectDialog, setProjectsRefresh,
    setRemoteDialog, setRenamingTabId, setSettingsTab, setShowNew, setShowSettings,
    setSourceJobOpen, setTabMenu, setWorkUnitTrackingEnabled, setWorkspaceScope, setWtRoot, settingsTab,
    settingsTouched, showNew, showSettings, sourceJobOpen, spawn, stopRemoteSession, storedLang, systemLang, t,
    tabMenu, talkSignal, unsplitPane, update, updateChecking, workUnitTrackingEnabled, workspaceCwd, workspaceData,
    workspacePlanId, workspaceTree, wtRoot, start, openStart, newOpen, setNewOpen, sessions
  } = p
  const onboardingReplay = useOnboardingReplay()
  const helpOpen = useHelpOpen()
  // W9-E: an empty project lands on Start; files dropped on the window open it
  useStartLanding(currentProject, sessions, openStart)
  useDropToStart(openStart)
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
          onSpawn={async (opts) => void (await spawn(opts))}
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
            // This computer is the pick for the project now, or the new console dialog would hand straight back.
            rememberMachine(newSessionCwd ?? workspaceCwd, 'local')
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
      {/* DESIGN-W13: Settings and Start are view tabs now (viewTabs.tsx); setShowSettings and openStart open them */}
      {/* The pane tab context menu — the entry point for split and unsplit. It serves every kind of tab:
          the id goes to the tree unread, and Close takes the same path the tab's × does (a dirty file
          still asks for confirmation, a session is still ended). What gets split is the group the
          right-clicked tab belongs to, not the active pane — so right-clicking a tab in another group
          does not split the wrong one (the same as IntelliJ). */}
      {tabMenu && (
        <Menu
          at={{ x: tabMenu.x, y: tabMenu.y }}
          label={t('overlays.tabMenu.label')}
          onClose={() => setTabMenu(null)}
          items={((): Array<MenuItem | 'separator'> => {
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
            const local = isSession ? sessions.find((x) => x.id === tabRef.id) : undefined
            const filePath = tabRef?.kind === 'file' || tabRef?.kind === 'media' ? tabRef.id : undefined
            const kind: TabMenuKind = remote ? 'remote' : local ? 'local' : filePath !== undefined ? 'file' : tabRef?.kind === 'browser' ? 'browser' : 'other'
            const relPath = filePath !== undefined ? relativeUnder(workspaceCwd, filePath) : null
            const acts = tabActions({ kind, exited: local?.status === 'exited', relative: relPath !== null })
            const tabName = local?.title ?? tid
            const sessionItem = (a: string): Array<MenuItem | 'separator'> => {
              switch (a) {
                case 'stop':
                  return local ? [{ label: t('overlays.tabMenu.stop'), danger: true, onSelect: () => void stopKeepTab(local, tabName, t) }] : []
                case 'restart':
                  return local ? [{ label: t('overlays.tabMenu.restart'), onSelect: () => restart(local) }] : []
                case 'duplicate':
                  return local
                    ? [{
                        label: t('overlays.tabMenu.duplicate'),
                        onSelect: () => void spawn({ accountIds: [local.accountId], cwd: local.cwd, saveDefault: false, kind: local.kind, slackNotify: local.slackNotify, bypassPermissions: local.bypassPermissions })
                      }]
                    : []
                case 'moveAccount':
                  return local ? moveTargets(local, accounts).map((acc) => ({ label: t('overlays.tabMenu.moveTo', { label: acc.label }), onSelect: () => void moveToAccount(local, acc, t) })) : []
                case 'copyId':
                  return [{ label: t('overlays.tabMenu.copyId'), onSelect: () => copyText(local?.id ?? (tabRef ? (parseRemoteSessionKey(tabRef.id)?.sessionId ?? tabRef.id) : tid)) }]
                case 'copyPath':
                  return [{ label: t('overlays.tabMenu.copyPath'), onSelect: () => copyText(filePath ?? local?.cwd ?? '') }]
                case 'copyRelativePath':
                  return relPath !== null ? [{ label: t('overlays.tabMenu.copyRelativePath'), onSelect: () => copyText(relPath) }] : []
                case 'reveal':
                  return [{ label: t(isMac() ? 'overlays.tabMenu.revealMac' : 'overlays.tabMenu.reveal'), onSelect: () => revealPath(filePath ?? local?.cwd ?? '', t) }]
                default:
                  return [] // rename sits above with its own wording
              }
            }
            const manageItems = acts.manage.filter((a) => a !== 'rename').flatMap(sessionItem)
            const pathItems = acts.path.flatMap(sessionItem)
            const ids = group?.tabIds ?? [tid]
            const targets = closeTargets(ids, tid)
            const closeMany = (list: string[]): void => void closeInSequence(list, closeWorkbenchTab, isConfirmOpen)
            return [
              // 세션 탭에만. 파일 탭의 라벨은 파일 이름이라 여기서 바꿀 것이 아니고, 기록 탭의
              // 라벨은 그 기록의 요청문이다. 더블클릭과 같은 자리를 연다.
              ...(isSession
                ? ([
                    {
                      label: t('session.tab.rename'),
                      onSelect: () => setRenamingTabId(tid)
                    },
                    ...manageItems,
                    'separator'
                  ] as Array<MenuItem | 'separator'>)
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
                  ] as Array<MenuItem | 'separator'>)
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
                  ] as Array<MenuItem | 'separator'>)
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
              ...(pathItems.length > 0 ? ['separator' as const, ...pathItems] : []),
              'separator',
              { label: t('overlays.tabMenu.closeOthers'), disabled: targets.others.length === 0, onSelect: () => closeMany(targets.others) },
              { label: t('overlays.tabMenu.closeRight'), disabled: targets.right.length === 0, onSelect: () => closeMany(targets.right) },
              { label: t('overlays.tabMenu.closeAll'), onSelect: () => closeMany(targets.all) },
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
      {/* W9-C: RunDetail's window is the plan page now (components/pages/PlanPage.tsx, mounted by PlansPage) */}
      {/* W7-B project dialogs */}
      {projectAnchor && projectDialog === 'new' && (
        <NewProjectDialog
          anchor={projectAnchor}
          onClose={() => setProjectDialog(null)}
          onCreated={(id) => {
            setProjectsRefresh((n) => n + 1)
            openWorkspaceProject(id)
          }}
          onStartPlan={(path, objective) => openStart({ text: objective, cwd: path })}
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
      {projectAnchor && projectDialog === 'clone' && (
        <CloneProjectDialog
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
      {/* W3-B command bar (W9-D: and the session search, one box): names resolve against the workspace tree; changes go through this computer's doors */}
      <CommandBar
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        tree={workspaceTree}
        data={workspaceData}
        currentProject={currentProject}
        currentPlanId={workspacePlanId}
        ui={actionUi}
        talkSignal={talkSignal}
        keyOverrides={keyOverrides}
        layout={layout}
        orchSnapshot={orchSnapshot}
        onSelectTab={selectWorkbenchTab}
        onOpenFile={(path) => openLinkedPath(path)}
        onOpenSession={(sessionId, jobId) => {
          if (jobId) setWorkspaceScope(null, jobId)
          selectWorkbenchTab(sessionTab(sessionId))
        }}
        deps={{
          door: (projectPath) => localDoor(window.api, projectPath),
          attention: (sessionId) => window.api.conversation.attention(sessionId),
          openPlan: (jobId) => openPlan(jobId),
          openRun: (projectPath, runId) => {
            setDetail(null)
            setOpenRun({ projectPath, runId })
          },
          // W5-C (#41): read when asked, for a plan of any project, not the Jobs view's current snapshot
          snapshotFor: (projectPath) => window.api.orch.peek(projectPath),
          coordinatorAccount: async () => {
            const signedIn = await localDoor(window.api, currentProject ?? homeDir ?? '').signedInIds(accounts)
            // T5b: always Auto ('') — the Host picks the account with most room; null only when none is signed in
            return defaultAccountIdOf('claude', accounts, signedIn) === null ? null : ''
          }
        }}
      />
      {sourceJobOpen !== null && (
        <SourceJobModal
          projectPath={sourceJobOpen}
          accounts={accounts}
          onClose={() => setSourceJobOpen(null)}
          onCreated={(jobId) => {
            const project = sourceJobOpen
            setSourceJobOpen(null)
            // The Job made opens at once (plan P5)
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
      {/* T30: the in-app help (F1, the top bar's More menu, the command box) */}
      {helpOpen && <HelpPanel keyOverrides={keyOverrides} onClose={() => setHelpOpen(false)} />}
      <ConfirmHost />
      {/* T27: a crash report is offered here, and sent only on its Send */}
      <CrashReportHost />
      <AutoLimitsCrashNotice />
      {/* The first-run onboarding, replacing the old single question. Shown on a genuinely fresh profile only
          (main/appSettingsStore.ts's firstRunAsked carries how that is told from an install that predates it) or
          when Settings > General asks to show it again. Every way out settles firstRunAsked, so it shows once. */}
      {isOnboardingShown(firstRunAsked, onboardingReplay) && (
        <Onboarding
          replay={onboardingReplay}
          cli={cli}
          cliInstalled={cliInstalled}
          onCliInstalled={(installed) => {
            setCliInstalled(installed)
            void window.api.system.checkCli().then(setCli)
          }}
          accounts={accounts}
          currentProject={currentProject}
          onChooseProject={projectAnchor ? (c) => setProjectDialog(projectDialogOf(c)) : undefined}
          defaultSessionKind={defaultSessionKind}
          setDefaultSessionKind={setDefaultSessionKind}
          update={update}
          onExit={(exit) => {
            const { open } = exitEffects(exit)
            setFirstRunAsked(true)
            setOnboardingReplay(false)
            void window.api.settings.markFirstRunAsked()
            if (open === 'start') openStart({ mode: 'chat' })
            else if (open === 'agents') openActivity('agents')
          }}
        />
      )}
      <ToastViewport />
    </>
  )
}
