// DESIGN-W13 §5: the `view` editor tabs (view:<name>[:<arg>]). One registry for their titles, icons and bodies, which
// PaneGrid draws through `renderView`; useViewTabSync keeps the tabs and the state their pages still read (Start's
// request, the open plan, the Settings flag) in step, so every old way into those pages opens their tab.
import { useEffect, useMemo, useRef } from 'react'
import { parseViewTab, sessionTab, viewTab, type ViewName } from '../../../../core/panes/tabId'
import { groupOfTab } from '../../../../core/panes/tree'
import { placeViewTab } from '../../../../core/panes/place'
import { findRun } from '../../../../core/orchestration/snapshot'
import type { MessageKey } from '../../../../core/i18n'
import type { JobRow } from '../../../../core/types'
import { jobName } from '../../lib/jobName'
import { localDoor } from '../../lib/orchDoor'
import { archiveJob, deleteRun, holdJob, renameJob, resolveFailed, unarchiveJob } from '../../lib/jobActions'
import { Button, EmptyState, ICONS, type IconName } from '../ui'
import { PlansPage } from '../pages/PlansPage'
import { StartPage } from '../pages/StartPage'
import { WorktreeDetail } from '../worktrees/WorktreeDetail'
import { SettingsPage } from '../settings/SettingsPage'
import { KeyboardShortcuts } from '../ShortcutSettings'
import { MainPlan } from '../plan/MainPlan'
import type { PlanActs } from '../plan/PlanRow'
import { worktreeTitle } from '../worktrees/worktreeView'
import { Welcome } from './Welcome'
import { DeviceDetail } from '../devices/DeviceDetail'
import { devicesSnapshot } from '../devices/useDevices'
import { openPlan } from './navigation'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'
import { useOrchConsumer } from '../../state/orchFeed'

export type ViewTabProps = AppState & ShellState

const NO_ROWS: JobRow[] = []

const VIEW_META: Record<ViewName, { icon: IconName; title: MessageKey }> = {
  welcome: { icon: 'sparkles', title: 'shell.view.welcome' },
  plan: { icon: 'listTree', title: 'shell.view.plan' },
  mainplan: { icon: 'target', title: 'shell.view.mainplan' },
  start: { icon: 'add', title: 'shell.view.start' },
  settings: { icon: 'settings', title: 'settings.title' },
  worktree: { icon: 'branch', title: 'worktrees.title' },
  device: { icon: 'laptop', title: 'shell.activity.devices' }
}

/** A view tab's title and icon: a plan's own name, a worktree's folder, a device's name, else the view's name. */
export function viewTabInfo(p: Pick<ViewTabProps, 't' | 'orchSnapshot'>, name: ViewName, arg?: string): { title: string; icon: IconName } {
  const meta = VIEW_META[name]
  if (name === 'plan' && arg !== undefined) {
    const run = p.orchSnapshot ? findRun(p.orchSnapshot, arg) : undefined
    return { icon: meta.icon, title: run ? jobName(run) : p.t(meta.title) }
  }
  if (name === 'settings' && arg === 'keys') return { icon: 'keyboard', title: p.t('keys.title') }
  if (name === 'worktree' && arg !== undefined) return { icon: meta.icon, title: worktreeTitle(undefined, arg) }
  if (name === 'device' && arg !== undefined) return { icon: meta.icon, title: devicesSnapshot().paired?.find((r) => r.runtimeId === arg)?.name ?? p.t(meta.title) }
  return { icon: meta.icon, title: p.t(meta.title) }
}

/** The handlers the plan list rows take (PlansPage's own set), for the Main plan tab. */
function planActs(p: ViewTabProps): PlanActs {
  const { actionUi, approve, currentProject, layout, orchSnapshot, selectWorkbenchTab, setDetail, setOpenRun } = p
  const local = currentProject ? localDoor(window.api, currentProject) : null
  return {
    onOpen: (runId) => {
      setDetail(null)
      if (currentProject) setOpenRun({ projectPath: currentProject, runId })
    },
    canOpenSession: (sessionId) => !!layout && !!groupOfTab(layout, sessionTab(sessionId)),
    onOpenSession: (sessionId) => selectWorkbenchTab(sessionTab(sessionId)),
    onPause: p.pauseScheduleRun,
    onResume: p.resumeScheduleRun,
    onRestartCoordinator: p.restartCoordinator,
    onApprove: (runId) => {
      if (local) approve(local, orchSnapshot, runId, actionUi)
    },
    onDelete: (runId) => local && void deleteRun(local, orchSnapshot, runId, actionUi),
    onRename: (jobId, title) => local && void renameJob(local, jobId, title, actionUi),
    onArchive: (jobId) => local && void archiveJob(local, orchSnapshot, jobId, actionUi),
    onUnarchive: (jobId) => local && void unarchiveJob(local, jobId, actionUi),
    onHold: (jobId, hold) => local && void holdJob(local, jobId, hold, actionUi),
    onResolveFailed: (taskId, action) => local && void resolveFailed(local, taskId, action, actionUi)
  }
}

/** The Main plan tab. `p` is a new object every App render, so the handlers go through a ref and MainPlan's memo holds. */
function MainPlanTab({ p }: { p: ViewTabProps }): React.JSX.Element {
  const pRef = useRef(p)
  pRef.current = p
  const acts = useMemo<PlanActs>(() => {
    const now = (): PlanActs => planActs(pRef.current)
    return {
      onOpen: (id) => now().onOpen(id),
      canOpenSession: (id) => now().canOpenSession(id),
      onOpenSession: (id) => now().onOpenSession?.(id),
      onPause: (id) => now().onPause?.(id),
      onResume: (id) => now().onResume?.(id),
      onRestartCoordinator: (id) => now().onRestartCoordinator?.(id),
      onApprove: (id) => now().onApprove?.(id),
      onDelete: (id) => now().onDelete?.(id),
      onRename: (id, title) => now().onRename?.(id, title),
      onArchive: (id) => now().onArchive?.(id),
      onUnarchive: (id) => now().onUnarchive?.(id),
      onHold: (id, hold) => now().onHold?.(id, hold),
      onResolveFailed: (id, action) => now().onResolveFailed?.(id, action)
    }
  }, [])
  return <MainPlan rows={p.orchSnapshot?.runs ?? NO_ROWS} acts={acts} accounts={p.accounts} />
}

/** A worktree tab: the one worktree at its own path, never the side bar's selection. */
function WorktreeTab({ p, path, close }: { p: ViewTabProps; path?: string; close: () => void }): React.JSX.Element | null {
  if (path === undefined) return null
  return (
    <WorktreeDetail
      path={path}
      runs={p.orchSnapshot?.runs ?? []}
      door={p.currentProject ? localDoor(window.api, p.currentProject) : null}
      onClose={close}
      onStartSession={(cwd) => {
        p.setNewSessionCwd(cwd)
        p.setShowNew(true)
      }}
      onOpenFiles={(cwd) => p.openLinkedFolder(cwd)}
    />
  )
}

/** A view tab's body. Each stays mounted for its tab's life (PaneGrid's view slots), so Start keeps its draft. */
/** Counts itself as a reader of the snapshot, so the watch stays armed while Plans is not the sidebar view. */
function MainPlanTab({ p }: { p: ViewTabProps }): React.JSX.Element {
  useOrchConsumer()
  return <MainPlan rows={p.orchSnapshot?.runs ?? []} acts={planActs(p)} accounts={p.accounts} />
}

export function renderViewTab(p: ViewTabProps, name: ViewName, arg: string | undefined, active: boolean): React.ReactNode {
  const close = (): void => p.closeWorkbenchTab(viewTab(name, arg))
  switch (name) {
    case 'welcome':
      return <Welcome {...p} />
    case 'plan': {
      if (arg !== undefined && p.openRun?.runId === arg && p.detailDoor)
        return (
          <PlansPage
            {...p}
            // the plan page's ✕ closes its tab
            setOpenRun={(next) => {
              p.setOpenRun(next)
              if (next === null) close()
            }}
          />
        )
      return (
        <EmptyState icon={ICONS.tasks} title={p.t('shell.view.planClosed')}>
          {arg !== undefined && (
            <Button size="sm" variant="primary" onClick={() => openPlan(arg)}>
              {p.t('shell.view.openPlan')}
            </Button>
          )}
        </EmptyState>
      )
    }
    case 'mainplan':
      return (
        <div className="view-doc">
          <MainPlanTab p={p} />
        </div>
      )
    case 'start': {
      const req = p.start ?? {}
      const cwd = req.cwd ?? p.currentProject ?? p.homeDir ?? ''
      return (
        // T17: not keyed by the folder: picking a project on All projects switches the title bar, and what was typed stays
        <StartPage
          req={req}
          cwd={cwd}
          accounts={p.accounts}
          onClose={() => {
            p.openStart(null)
            close()
          }}
          onOpenConsole={() => p.setShowNew(true)}
          onOtherSources={() => p.setSourceJobOpen(cwd)}
        />
      )
    }
    case 'settings':
      // `view:settings:keys` is the Keyboard Shortcuts editor tab
      return arg === 'keys' ? <KeyboardShortcuts keyOverrides={p.keyOverrides} setKeyOverrides={p.setKeyOverrides} /> : <SettingsPage {...p} onClose={close} />
    case 'worktree':
      return <WorktreeTab p={p} path={arg} close={close} />
    case 'device':
      return arg === undefined ? null : (
        <DeviceDetail
          runtimeId={arg}
          onNewConsole={p.setRemoteDialog}
          onOpenSession={p.openRemoteSession}
          onChanged={() => p.setPairedChanged((n) => n + 1)}
          onClose={close}
        />
      )
  }
}

type SyncDeps = Pick<
  AppState,
  | 'layout' | 'layoutRef' | 'activePaneIdRef' | 'setLayout' | 'setActivePaneId' | 'activeTabId' | 'start' | 'openStart'
  | 'showSettings' | 'setShowSettings' | 'openRun' | 'setOpenRun' | 'setDetail' | 'workspaceTree' | 'currentProject'
>

/** Keeps the view tabs and the state their pages read in step:
 *  - Start's request (New, a drop, a new project's first plan) opens the Start tab; closing the tab drops the request;
 *  - a plan opened anywhere (openRun) opens its tab, and activating a plan tab opens that plan again;
 *  - the old Settings flag (setShowSettings) opens the Settings tab. */
export function useViewTabSync(p: SyncDeps): void {
  const { layout, activeTabId, start, openRun, showSettings } = p
  const place = (id: string): void => {
    const placed = placeViewTab(p.layoutRef.current, id, p.activePaneIdRef.current)
    p.setLayout(placed.root)
    if (placed.paneId) p.setActivePaneId(placed.paneId)
  }
  const has = (id: string): boolean => !!layout && !!groupOfTab(layout, id)

  // Start: a new request opens (or focuses) the tab; the tab gone, the request goes too
  const startTab = viewTab('start')
  const lastStart = useRef(start)
  useEffect(() => {
    if (start && start !== lastStart.current) place(startTab)
    lastStart.current = start
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the request only
  }, [start])
  const hadStartTab = useRef(false)
  useEffect(() => {
    const now = has(startTab)
    if (hadStartTab.current && !now && start) p.openStart(null)
    hadStartTab.current = now
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the tree only
  }, [layout])

  // Settings: the old flag becomes the tab
  useEffect(() => {
    if (!showSettings) return
    place(viewTab('settings'))
    p.setShowSettings(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the flag only
  }, [showSettings])

  // Plans: openRun opens its tab; a remote plan's runtime is remembered for when its tab is activated again.
  // Keyed on the request object, not its runId: every open (a click in the Plans tree, Welcome, the Inbox) sets a new
  // one, so the same plan opens again after its tab was closed (the runId alone had not changed).
  const opened = useRef(new Map<string, { projectPath: string; runId: string; runtimeId?: string }>())
  useEffect(() => {
    if (!openRun) return
    opened.current.set(openRun.runId, openRun)
    const id = viewTab('plan', openRun.runId)
    if (activeTabId !== id) place(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the open plan only
  }, [openRun])
  const lastActive = useRef(activeTabId)
  useEffect(() => {
    if (lastActive.current === activeTabId) return
    lastActive.current = activeTabId
    const view = activeTabId ? parseViewTab(activeTabId) : null
    if (view?.name !== 'plan' || view.arg === undefined || p.openRun?.runId === view.arg) return
    const runId = view.arg
    const known = opened.current.get(runId)
    const projectPath = known?.projectPath ?? p.workspaceTree.find((x) => x.plans.some((plan) => plan.jobId === runId || plan.runId === runId))?.path ?? p.currentProject
    if (!projectPath) return
    p.setDetail(null)
    p.setOpenRun(known ?? { projectPath, runId })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follows the active tab only
  }, [activeTabId])
}
