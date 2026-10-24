// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useEffect, useRef, useState } from 'react'
import type { HistoryEntry, ScheduleConfig, SessionInfo, SessionKind } from '../../../core/types'
import type { UnattendedPermission } from '../../../core/chat/types'
import { invalidateImageCache } from '../components/MarkdownPreview'
import { setActiveSession } from '../lib/activeSession'
import type { EditorState, StateEffect } from '@codemirror/state'
import { openSessionIds, placeAppTabs, removeAppTab } from '../lib/workspaceMirror'
import { flushPendingEdits } from '../lib/editCoalescer'
import { mirrorFrames } from '../lib/mirrorFrames'
import type { TerminalBuffer, UpdateApi } from '../../../core/types'
import { findActionForEvent } from '../../../core/keys/binding'
import { ACTIONS } from '../lib/actions'
import { MIN_CHECKING_MS, isCheckResult, shouldNotifyDownloaded, showChecking } from '../../../core/update/checkFeedback'
import { readyToast } from '../../../core/update/manualInstallNotice'
import { sourceReadyToast } from '../../../core/update/sourceView'
import { applyEol, classifyExternalChange, detectEol, toLf } from '../../../core/files/edit'
import { isSubPath, rebasePath } from '../../../core/files/ops'
import { cycleViewMode } from '../../../core/files/markdownView'
import * as sessionBus from '../lib/sessionBus'
import { dismiss, toast } from '../lib/toast'
import { spawnNotice } from '../lib/spawnNotice'
import { announceSettingsRecovery } from '../lib/settingsRecoveryNotice'
import { confirmModal, confirmModalWithChoices, isConfirmOpen } from '../lib/confirm'
import { ACTIVITY_STORAGE_KEY, type ActivityId } from '../../../core/ui/pages'
import { nextActivity } from './sidebarView'
import { requestBox } from '../components/command/boxStore'
import { openActivity, openView, revealRunConfigs, togglePanel, toggleSideBar } from '../components/shell/navigation'
import { storageWrite } from '../components/shell/shellView'
import { LOST_SIGHT_EXIT_CODE, LOST_TERMINAL_GRACE_MS, terminalsWithCreated, terminalsWithExit } from '../lib/terminalTabs'
import { isCancelled as isWorktreeCancelled } from '../lib/worktreeErrors'
import { spawnErrorMessage } from '../lib/spawnErrors'
import { notifyCreated as notifyWorktreeCreated } from '../lib/worktreeBus'
import { MAX_PANES, activateTab, countLeaves, createGroup, findNeighbor, firstLeaf, groupOfTab, leafOf, moveTab, removeTab, replaceTabId, splitAndMove, unsplit, type DropZone, type MoveDir, type PaneDir, type PaneNode } from '../../../core/panes/tree'
import { fileTab, isRemoteSessionKey, mediaTab, parseTab, sessionTab } from '../../../core/panes/tabId'
import { canStartSession, type RemoteSessionRef } from '../lib/remoteSessions'
import { mediaTabsUnder, placeMediaTab, placeTab } from '../../../core/panes/place'
import { mediaKindOf } from '../../../core/files/media'
import { openPath } from '../lib/openPath'
import { sessionKindOf } from '../../../core/sessions/kind'
import { onFileChanges } from '../lib/fileChanges'
import type { FileChange } from '../../../core/files/changeBatch'
import { playAlertChime } from '../lib/alertSound' // W6-B
import type { useWorkbenchState } from './useWorkbenchState'
import type { useLayout } from './useLayout'
import type { useSidebar } from './useSidebar'
import type { useHost } from './useHost'
import type { useSettings } from './useSettings'
import type { useDialogs } from './useDialogs'
import { scopeKey } from './appConstants'
import { adoptSessions, cycledTab, type OwnerPick } from './selection'
import { openInbox } from '../components/shell/navigation'
import { setHelpOpen } from '../components/help/helpStore'
import { closeSessionTab, dropClosed, isAgentSession, ownConsolePref, recentlyClosed, recordClosed, reopenClosed, reopenWayOf, setOwnConsolePref, setReopenHandler, type ClosedTab, type CloseHow } from '../lib/recentlyClosed'

export type WorkbenchDeps = Pick<ReturnType<typeof useWorkbenchState>,
    'activeFileIdRef' | 'cliRef' | 'closableTabIdRef' | 'closeWorkbenchTabRef' | 'defaultMdMode' | 'dropReveal' |
    'editorCacheRef' | 'explorerClipboardRef' | 'explorerTreesRef' | 'explorerUndoRef' | 'fileBuffers' |
    'fileBuffersRef' | 'fileTabs' | 'fileTabsRef' | 'heardRollRef' | 'heardSchedRef' | 'hiwOpenRef' |
    'installUpdate' | 'jobsOpenRef' | 'mdModesRef' | 'mirrorsRef' | 'modalOpenRef' | 'pendingSplitRef' |
    'recordTabs' | 'requestReveal' | 'runRerunSelectedRef' | 'runStartRef' | 'runStopSelectionRef' |
    'runningCountRef' | 'selectWorkbenchTabRef' | 'setBrowserLoading' | 'setBrowserNonce' | 'setBrowserTabs' |
    'setBusy' | 'setFileBuffers' | 'setFileTabs' | 'setHiwOpen' | 'setIsMax' | 'setJobsOpen' | 'setMdMode' |
    'setMdModes' | 'setMediaNonces' | 'setPendingReveal' | 'setRecordTabs' | 'setRollStates' | 'setSchedStates' |
    'setScopedNode' | 'tRef'> &
  Pick<ReturnType<typeof useLayout>,
    'activePaneIdRef' | 'activeSessionId' | 'lastSessionIdRef' | 'layoutRef' | 'sessions' | 'sessionsRef' |
    'setAccounts' | 'setActivePaneId' | 'setGhostAccounts' | 'setLayout' | 'setRemoteSessions' | 'setRemoteStatus' |
    'setSessions' | 't'> &
  Pick<ReturnType<typeof useSidebar>,
    'bindingsRef' | 'explorerOpenRef' | 'setExplorerOpen' | 'setKeyOverrides' | 'setSidebarOpen' | 'sidebarOpenRef' |
    'activityRef' | 'setActivity'> &
  Pick<ReturnType<typeof useHost>,
    'campaignRef' | 'checkClickedAt' | 'cliInstalled' | 'notifiedUpdateRef' | 'readyToastRef' | 'setAppVersion' |
    'setCampaign' | 'setCheckClickedAt' | 'setCli' | 'setCliInstalled' | 'setHostHolding' | 'setHostStatus' |
    'setNewSessionCwd' | 'setShowNew' | 'setUpdate' | 'update'> &
  Pick<ReturnType<typeof useSettings>,
    'setAgentAppEnabled' | 'setAgentBrowserEnabled' | 'setAgentYolo' | 'setDefaultSessionKind' | 'setFirstRunAsked' |
    'setWorkUnitTrackingEnabled' | 'setWtRoot' | 'settingsTouched' | 'showSettings'> &
  Pick<ReturnType<typeof useDialogs>,
    'setCommandOpen' | 'setRunMenuOpen' | 'setSwitcherOpen' | 'setTalkSignal' | /* W9-E */ 'setNewOpen'>

/** T1: a session's account and rolling chain for a respawn (Restart, Reopen): its account first, then the rest of its
 *  chain; no chain, no rolling. */
/** The update:justUpdated record as the toast reads it (JustUpdatedApi in core/update/sourceUpdate.ts is outside the web project). */
type JustUpdatedApi = { justUpdated(): Promise<{ sha: string; commits: { subject: string }[] } | null> }

/** Commit subjects the "Updated to" toast lists before "and N more". */
const JUST_UPDATED_LISTED = 5

const chainOf = (accountId: string, chain: string[] | undefined): { accountIds: string[]; roll: boolean } =>
  chain && chain.length > 0
    ? { accountIds: [accountId, ...chain.filter((id) => id !== accountId)], roll: true }
    : { accountIds: [accountId], roll: false }

export function useWorkbench(deps: WorkbenchDeps) {
  const {
    activeFileIdRef, activePaneIdRef, activeSessionId, bindingsRef, campaignRef, checkClickedAt, cliInstalled,
    cliRef, closableTabIdRef, closeWorkbenchTabRef, defaultMdMode, dropReveal, editorCacheRef, explorerClipboardRef,
    explorerOpenRef, explorerTreesRef, explorerUndoRef, fileBuffers, fileBuffersRef, fileTabs, fileTabsRef,
    heardRollRef, heardSchedRef, hiwOpenRef, installUpdate, jobsOpenRef, lastSessionIdRef, layoutRef, mdModesRef,
    mirrorsRef, modalOpenRef, notifiedUpdateRef, pendingSplitRef, readyToastRef, recordTabs, requestReveal,
    runRerunSelectedRef, runStartRef, runStopSelectionRef, runningCountRef, selectWorkbenchTabRef, sessions,
    sessionsRef, setAccounts, setActivePaneId, setAgentAppEnabled, setAgentBrowserEnabled, setAgentYolo,
    setAppVersion, setBrowserLoading, setBrowserNonce, setBrowserTabs, setBusy, setCampaign, setCheckClickedAt,
    setCli, setCliInstalled, setCommandOpen, setDefaultSessionKind, setExplorerOpen, setFileBuffers, setFileTabs,
    setFirstRunAsked, setGhostAccounts, setHiwOpen, setHostHolding, setHostStatus, setIsMax, setJobsOpen,
    setKeyOverrides, setLayout, setMdMode, setMdModes, setMediaNonces, setNewSessionCwd, setPendingReveal,
    setRecordTabs, setRemoteSessions, setRemoteStatus, setRollStates, setRunMenuOpen, setSchedStates, setScopedNode,
    setSessions, setShowNew, setSidebarOpen, setSwitcherOpen, setTalkSignal, setUpdate, setWorkUnitTrackingEnabled,
    setWtRoot, settingsTouched, showSettings, sidebarOpenRef, t, tRef, update, activityRef, setNewOpen, setActivity
  } = deps
  // W9-A: declared here, ahead of where App's body had them, because effects and handlers in this hook
  // (or an earlier one) read them; they are state and refs, so moving them up changes nothing that runs.
  // Project terminals. They share the bottom panel with the Run tab.
  const [terminals, setTerminals] = useState<TerminalBuffer[]>([])
  const [bottomTab, setBottomTab] = useState<string>('run') // 'run' | terminalId
  const [pairedRuntimes, setPairedRuntimes] = useState<Array<{ runtimeId: string; name: string; lastSeenAt: string | null; offline: boolean | null; permission: string }>>([])

  /** bottomRoot 를 ref 로 비춘다 — 비동기 흐름 중에 루트가 바뀌었는지 보는 데 쓴다(openTerminal).
   *  currentProjectRef 로는 안 된다: 프로젝트가 없을 때 그쪽은 null 이고 bottomRoot 는 홈이다. */
  const bottomRootRef = useRef<string | null>(null)
  /** 마크다운으로 다룰 확장자. edit.ts 의 LANG_BY_EXT 가 markdown 으로 잡는 둘과 같다 */
  const isMarkdownPath = (p: string): boolean => /\.(md|markdown)$/i.test(p)
  // The workspace keys are handled by a listener that holds its first closure, so it reads this ref
  const openWorkspaceSlotRef = useRef<(slot: number) => void>(() => {})
  // The owner's last pick of a project or a tab since mount (selection.ts): restores yield to it, and only a picked tab
  // moves the project. Tab picks are marked here, project picks in useWorkspace.
  const ownerPickRef = useRef<OwnerPick | null>(null)
  // The pane tree as the open workspace shows it (scopeLayout), for the key listener below; useWorkspace sets it
  const shownLayoutRef = useRef<(layout: PaneNode) => PaneNode | null>((l) => l)
  // W9-A: starts empty, not at closeAgentTab (declared later, in useViews); useViews sets it every render
  // before any effect or handler reads it.
  const closeAgentTabRef = useRef<(sessionId: string) => void>(() => {})

  // Mirrors currentProject into a ref — avoids a stale closure in the run:status subscription effect
  // W9-A: starts at null, not at currentProject (computed later, in useJobs); useJobs sets it every render
  // before any effect or handler reads it.
  const currentProjectRef = useRef<string | null>(null)

  // showSession(sessionId)은 사라졌다 — 탭을 화면에 올리는 경로가 종류를 가리지 않는 selectWorkbenchTab
  // 하나로 합쳐졌고, 그것이 유일한 호출자였다. 세션이 없는 상태에서 새로 만드는 경로는 place()가 맡는다.

  useEffect(() => {
    void window.api.accounts.list().then(setAccounts)
    void window.api.accounts.ghosts().then(setGhostAccounts)
    void window.api.system.checkCli().then(setCli)
    void window.api.system.checkCliInstalled().then(setCliInstalled)
    void window.api.system.appVersion().then(setAppVersion)
    void window.api.settings.getAgentBrowserEnabled().then(setAgentBrowserEnabled)
    void window.api.settings.getAgentAppEnabled().then(setAgentAppEnabled)
    // Both session dialogs seed their kind from this, so it has to be loaded before either can open —
    // it cannot wait for the settings modal.
    void window.api.settings.getDefaultSessionKind().then(setDefaultSessionKind)
    // Read here with the rest: the modal below is drawn from it, and it must not flash in front of
    // someone who has used the app for months while an answer is in flight.
    void window.api.settings
      .getFirstRunAsked()
      .then(setFirstRunAsked)
      .catch(() => setFirstRunAsked(true)) // could not tell — the quiet answer is the right one
    // A damaged settings file was reset at load, with permission prompts on. An error toast, because
    // it does not auto-dismiss: the person has to see that their settings changed.
    void announceSettingsRecovery(window.api.settings.takeRecoveryNotice, (key) => toast.error(tRef.current(key)))
    // The schedule banner's one-shot read. 'session:schedState' is pushed on changes only, so a session
    // whose schedule was registered before this renderer existed — a reload, or main re-arming a
    // session while the window was still coming up — would wear no banner until its next due tick.
    // Null is the ordinary answer (no live schedule) and changes nothing.
    const seedSchedState = (sessionId: string): void => {
      void window.api.scheduler
        .state(sessionId)
        .then((ev) => {
          if (ev && !heardSchedRef.current.has(sessionId))
            setSchedStates((prev) => ({ ...prev, [sessionId]: ev }))
        })
        .catch(() => {})
    }
    // The roll banner's own one-shot read, same reasoning as the schedule seed just above.
    const seedRollState = (sessionId: string): void => {
      void window.api.rolling
        .state(sessionId)
        .then((ev) => {
          if (ev && !heardRollRef.current.has(sessionId))
            setRollStates((prev) => ({ ...prev, [sessionId]: ev }))
        })
        .catch(() => {})
    }
    // Re-adopts sessions that are still running after a renderer reload as tabs (scrollback is lost, by design)
    void window.api.sessions.list().then((list) => {
      // a session spawned before the list answered keeps its row: a tab with no row is not drawn
      setSessions((prev) => [...list, ...prev.filter((s) => !list.some((x) => x.id === s.id))])
      for (const s of list) if (s.status === 'running') { seedSchedState(s.id); seedRollState(s.id) }
      // T13: a tab the owner hid or closed stays out of the tree (its session stays in the list, so its tile stays)
      const closed = new Set(recentlyClosed().map((x) => x.sessionId))
      const tabbed = list.filter((s) => !closed.has(s.id))
      if (tabbed.length === 0) return
      // Every session belongs to exactly one group (invariant 1) — all re-adopted sessions go into the
      // first group, merged into the tabs already there, and a running session (or the first one, if none)
      // becomes the active tab unless the owner picked one before the list answered
      const wanted = (tabbed.find((s) => s.status === 'running') ?? tabbed[0]).id
      const act = adoptSessions(layoutRef.current, activePaneIdRef.current, tabbed.map((s) => s.id), wanted, ownerPickRef.current)
      if (!act) return
      // The mirror tabs a workspace.list that answered first has placed are kept by the merge; any not placed yet go
      // in (fix round 1: they were wiped). setLayout moves the ref at once, so a list that answers after this, before
      // the render, builds on this tree.
      const withMirrors = placeAppTabs(act.root, openSessionIds(mirrorsRef.current), act.paneId)
      setLayout(withMirrors)
      setActivePaneId(act.paneId)
    })
    const offAccounts = window.api.on('accounts:changed', (p) => setAccounts(p.accounts))
    const offGhosts = window.api.on('accounts:ghostsChanged', (p) => setGhostAccounts(p.accounts))
    // Clicking a desktop notification raises the window in main and lands here to activate that
    // session's tab, through the same path a click on the tab bar takes. A session with no tab (one
    // that was closed while the notification sat in the tray) finds no group and is a silent no-op —
    // the window is raised either way, which is the useful half.
    const offNotifyActivate = window.api.on('notify:activate', () => {
      // W9-D: a desktop notice (and the chime's) leads to the Inbox, where the card has "Answer in its console"
      openInbox()
    })
    // W6-B: main showed a notice that needs the owner, silent, and the chime is ours (lib/alertSound.ts)
    const offNotifyChime = window.api.on('notify:chime', () => void playAlertChime())
    const offExit = window.api.on('session:exit', ({ sessionId, exitCode, closedByAstera, closeReason }) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, status: 'exited', exitCode, closedByAstera, closeReason } : s))
      )
      closeAgentTabRef.current(sessionId) // the owner is gone; the tab has nothing to report to
    })
    // Receives sessions main created on its own (orchestration workers) as tabs. The user path builds a
    // tab from the return value of sessions.spawn, but the coordinator path creates the session inside
    // main so that return value never reaches here — this event is the only channel.
    // Placement uses the same place() as spawn but with background=true: placeTab drops it in as a
    // new tab of the active group (intoGroupBackground in core/panes/place.ts) without making it the
    // active tab.
    const offCreated = window.api.on('session:created', (info) => {
      // A session we already know about and still believe is running does nothing — right after a
      // reload, the sessions.list() re-adoption above can overlap with this event. **This is not the
      // guard that prevents a duplicate tab**: intoGroupBackground in place.ts filters on its first
      // line with groupOfTab and makes the second placement a no-op. What this guard buys is not
      // triggering the setSessions and setLayout re-render that comes along with that no-op.
      //
      // **A session we know about and marked exited is a different case, and it has to fall through.**
      // When the channel to the Host drops, every pty handle in main ends and session:exit marks the
      // row exited here (the tab stays, drawn as ended) — but the Host is still running the process,
      // so the reconnect takes the session back under the same id and re-emits this event. Returning
      // early there would leave a live agent drawn as ended, with an 'exited' row, until the next reload.
      const known = sessionsRef.current.find((s) => s.id === info.id)
      if (known && known.status !== 'exited') return
      setSessions((prev) =>
        prev.some((s) => s.id === info.id) ? prev.map((s) => (s.id === info.id ? info : s)) : [...prev, info]
      )
      // background=true: the tab appears but takes neither the active tab nor focus. If a worker
      // appeared while the user was typing into their own session, the keys after that would go into
      // the worker's PTY (a permission prompt in the worker's TUI would consume them as its answer).
      // So orchestration terminals open as inactive background tabs.
      // T13: a hidden tab whose session comes back on a Host reconnect stays hidden
      if (!recentlyClosed().some((x) => x.sessionId === info.id)) place(layoutRef.current, info.id, null, null, true)
      // A session main made on its own can already carry a schedule — the reattach sweep re-arms one
      // from the stored config as it hands the session back.
      seedSchedState(info.id)
      seedRollState(info.id)
    })
    // The campaign verdict comes after the policy lookup — it can arrive later or earlier than the mount, so both paths are taken
    const offCampaign = window.api.update.onCampaign((c) => {
      campaignRef.current = c
      setCampaign(c)
    })
    // In dev the updater block is not wired, so this channel has no handler — the rejection is swallowed (there is no campaign either).
    void window.api.update
      .campaignState()
      .then((c) => {
        if (!c) return
        campaignRef.current = c
        setCampaign(c)
      })
      .catch(() => {})
    // A source build's first statuses go out before this mounts; ask for the latest (no handler outside that channel).
    void window.api.update
      .current()
      .then((s) => setUpdate((cur) => cur ?? { ...s, checkedAt: null }))
      .catch(() => {})
    const offUpdate = window.api.update.onStatus((s) => {
      setUpdate({ ...s, checkedAt: isCheckResult(s.state) ? Date.now() : null })
      // There are two notification points:
      //  - available: only when this app is a campaign target, "a new version is out + [Download]".
      //    With no campaign, the title bar indicator saying so is enough
      //  - downloaded: the install prompt appears regardless of campaigns
      const campaign = campaignRef.current
      if (s.state === 'available' && campaign?.mode === 'notify') {
        if (!shouldNotifyDownloaded(s.version, notifiedUpdateRef.current)) return
        notifiedUpdateRef.current = s.version ?? null
        toast.info(tRef.current('update.toast.available', { version: s.version ?? '' }), {
          action: {
            label: tRef.current('update.toast.download'),
            onClick: () => void window.api.update.download()
          },
          onDismiss: () => void window.api.update.dismissCampaign(campaign.id)
        })
        return
      }
      // A source build announces itself once per target commit, with its change count; a status that carries
      // sourceBuild never takes the releases toast below.
      if (s.sourceBuild) {
        const built = sourceReadyToast(s, notifiedUpdateRef.current)
        if (!built) return
        notifiedUpdateRef.current = built.target
        if (readyToastRef.current !== null) dismiss(readyToastRef.current)
        readyToastRef.current = toast.info(tRef.current(built.message.key, built.message.params), {
          action: { label: tRef.current(built.action), onClick: () => void installUpdate() }
        })
        return
      }
      const ready = readyToast(s)
      if (!ready) return
      // In block mode the gate already shows the same install button — a toast would only hide behind the gate.
      if (campaign?.mode === 'block') return
      if (readyToastRef.current !== null) dismiss(readyToastRef.current)
      readyToastRef.current = toast.info(tRef.current(ready.message.key, ready.message.params), {
        action: {
          label: tRef.current(ready.action),
          onClick: () => void installUpdate()
        }
      })
    })
    // A restart onto a new build announces what came in, once (main hands the record out a single time).
    void (window.api.update as UpdateApi & JustUpdatedApi).justUpdated().then((u) => {
      if (!u) return
      const t = tRef.current
      const shown = u.commits.slice(0, JUST_UPDATED_LISTED).map((c) => `• ${c.subject}`)
      const more = u.commits.length - shown.length
      toast.info([t('update.toast.updatedTo', { sha: u.sha }), ...shown, ...(more > 0 ? [t('update.toast.updatedMore', { count: more })] : [])].join('\n'))
    })
    return () => {
      offAccounts()
      offGhosts()
      offNotifyActivate()
      offNotifyChime()
      offExit()
      offCreated()
      offUpdate()
      offCampaign()
    }
  }, [])

  // Redraws once the minimum display window ends — before that, 'Checking…' stays even if a response has arrived.
  useEffect(() => {
    if (checkClickedAt === null) return
    const id = window.setTimeout(() => setCheckClickedAt(null), MIN_CHECKING_MS)
    return () => window.clearTimeout(id)
  }, [checkClickedAt])

  useEffect(() => {
    // Loads the user's overridden shortcuts. It still works on the default bindings if this fails.
    void window.api.keys
      .get()
      .then(setKeyOverrides)
      .catch(() => {})
    void window.api.win.isMaximized().then(setIsMax)
    const off = window.api.win.onMaximizeChange(setIsMax)
    return () => off()
  }, [])

  // Blocks external (OS) drag and drop — when a file is dropped on the window, Chromium navigates to
  // that file and the app screen is gone (only a restart brings it back). Why it is registered in the
  // capture phase: React 19 attaches listeners to the #root container, and
  // SyntheticEvent.stopPropagation() also calls nativeEvent.stopPropagation(), cutting native
  // propagation at #root (so it never reaches body, document, or window). The explorer tree's
  // dropHandlers call stopPropagation unconditionally on the first line of onDragOver
  // (FileExplorer.tsx) — meaning it is not that the app's own DnD handlers "dodge" this guard, but
  // that a bubble-phase guard could never fire above them at all. Capture runs before #root, so no
  // React handler can hide this guard.
  // Why the no-drop cursor and internal drops still work: preventDefault on dragover in the capture
  // phase only makes that dragover cancellable; the tree's onDragOver, running afterwards, overwrites
  // dropEffect with the final value ('none' for an invalid or external drag, 'copy'/'move' for a valid
  // internal one), and that is what decides the actual drag operation. With dropEffect='none' the
  // no-drop cursor appears and the drop is suppressed; with 'copy'/'move' the tree's onDrop fires
  // normally — both independent of the capture-phase preventDefault.
  // Drag and drop between the OS and the app is a non-goal.
  useEffect(() => {
    const block = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', block, true)
    window.addEventListener('drop', block, true)
    return () => {
      window.removeEventListener('dragover', block, true)
      window.removeEventListener('drop', block, true)
    }
  }, [])

  useEffect(() => {
    if (!showSettings) return
    // What the person changes from here on keeps their value when a read below lands after it (audit UI-7).
    settingsTouched.current.clear()
    void window.api.worktrees.getRoot().then(setWtRoot)
    // Work unit tracking. Nothing outside this modal reads it, so there is no mount-time fetch to keep
    // honest — this is the only read.
    void window.api.settings.getWorkUnitTrackingEnabled().then((v) => settingsTouched.current.unless('workUnits', () => setWorkUnitTrackingEnabled(v)))
    // 권한 모드도 같은 갈래다 — 이 모달 밖에서 읽는 곳이 없으므로 마운트 시점 읽기는 두지 않는다.
    void window.api.settings
      .getAgentPermissionMode()
      .then((m) => settingsTouched.current.unless('agentYolo', () => setAgentYolo(m === 'yolo')))
    void window.api.settings.getAgentBrowserEnabled().then((v) => settingsTouched.current.unless('agentBrowser', () => setAgentBrowserEnabled(v)))
    void window.api.settings.getAgentAppEnabled().then((v) => settingsTouched.current.unless('agentApp', () => setAgentAppEnabled(v)))
    // Re-syncs the new-session default too — the mount-time read above is what it keeps honest.
    void window.api.settings.getDefaultSessionKind().then((v) => settingsTouched.current.unless('defaultKind', () => setDefaultSessionKind(v)))
    // Re-read on open beside the effect below, which is what keeps it current the rest of the time:
    // the Info row wants the freshest answer at the moment it is drawn, and this costs nothing.
    void window.api.host.status().then(setHostStatus)
    // What it is holding is a round trip to the Host, so it is asked beside the status rather than
    // through it: the status answers from inside this app and must not be made to wait on a process
    // that can be slow or gone. Cleared first, because a re-open must not show the previous
    // opening's counts while this answer is in flight. A rejection is impossible on the main side,
    // and if one ever arrived it means the same thing as no answer.
    //
    // **The only fetch here with a cancel token, because it is the only slow one.** This round trip
    // waits up to five seconds for the Host; close and reopen the modal inside that window and the
    // first opening's reply lands into the second's row, putting counts from before on screen with
    // nothing to say they are stale. The same guard, and the same reason, as the terminal list
    // effect's `cancelled`.
    setHostHolding(null)
    let cancelled = false
    void window.api.host
      .holdings()
      .then((h) => {
        if (!cancelled) setHostHolding(h)
      })
      .catch(() => {
        if (!cancelled) setHostHolding(null)
      })
    return () => {
      cancelled = true
    }
  }, [showSettings])

  // Keyboard session tab switching: a global capture listener, so it works regardless of where focus
  // is. Being in the capture phase, it catches keys before xterm and blocks the residual sequence with
  // preventDefault plus stopPropagation. Ctrl+PageUp/Down cycles tabs within the active group, while
  // Ctrl+Shift+arrow moves focus to a neighbouring group. Both wrap around.
  // Switching only changes activeSessionId (or activeFileId); focusing the newly active terminal is
  // done by TerminalView's active effect.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // The bindings come from the registry. Keys the user changed in settings arrive here too, so no
      // key is hardcoded in a condition. Matching is on e.code, so it is unaffected by IME state or Shift.
      const action = findActionForEvent(bindingsRef.current, e, ACTIONS)
      if (!action) return
      if (modalOpenRef.current || isConfirmOpen()) return
      const focusEl = document.activeElement as HTMLElement | null
      const inXterm = !!focusEl?.closest('.xterm')
      // The conversation view's composer is a real <textarea>, so the `editable` guard below caught it
      // and every app shortcut with that guard died the moment a person clicked into it — Ctrl+Shift+E,
      // Ctrl+Tab, Ctrl+Shift+arrow. The guard predates this view: its exceptions name xterm and
      // CodeMirror, the two text surfaces that existed when it was written.
      //
      // The composer is the third, and it plays the part xterm plays in the other view — the place you
      // sit while working, not a form field. So it takes the same deal xterm already took: app
      // navigation wins over the field's own editing (Ctrl+Shift+arrow selects by word in a textarea;
      // the terminal gave that up for pane focus long ago, and a message box is no more precious).
      const inConversation = !!focusEl?.closest('[data-slot="conversation-pane"]')
      const editable =
        !!focusEl &&
        (focusEl.tagName === 'INPUT' ||
          focusEl.tagName === 'TEXTAREA' ||
          focusEl.tagName === 'SELECT' ||
          focusEl.isContentEditable)
      // Each action has its own rule about yielding to the terminal — the registry holds it (so it follows a rebind)
      if (inXterm && ACTIONS.find((a) => a.id === action)?.yieldsToTerminal) return

      // Toggling explorer mode. The exceptions are xterm and CodeMirror. Both are text areas the app
      // owns and neither has this feature inside it, so the mode toggle wins. CM6 sets
      // contenteditable=true on .cm-content for an editable file, so without this exception the toggle
      // would be blocked entirely while the editor has focus.
      if (action === 'explorer.toggleMode') {
        if (editable && !inConversation && !focusEl?.closest('.xterm, .cm-editor')) return
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        toggleExplorer()
        return
      }
      // The two sidebar views the rail can open. Pressed again they close, which is what the rail
      // button does — so the key is the button, not a second way in.
      //
      // Not blocked while a text field has focus, unlike the tab-cycling actions below: the default
      // chords are Ctrl+Shift+J/H, which no input of ours uses, and switching sidebars while reading a
      // file is exactly when it is wanted.
      //
      // Both toggles are recreated on every render and this listener holds the first one, but their
      // bodies are all refs and setters, so a stale closure still acts on the latest state — the same
      // convention toggleExplorer and closeFileTab already rely on.
      // W3-B: the command bar opens (or closes) like a sidebar key; the talk key opens it and toggles recording.
      // W6-F: Ctrl+Alt+N opens the Nth project workspace
      if (action.startsWith('workspace.project')) {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        openWorkspaceSlotRef.current(Number(action.slice('workspace.project'.length)))
        return
      }
      // W9-K: a new window (an All window; its switcher picks the project)
      if (action === 'window.new') {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) window.api.win.openNew(null)
        return
      }
      // T30: the in-app help opens (or closes) like the switcher
      if (action === 'help.open') {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) setHelpOpen((v) => !v)
        return
      }
      // T13: the newest of Recently closed comes back
      if (action === 'tabs.reopenClosed') {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) reopenClosed()
        return
      }
      // W7-F (#84): the quick tab switcher opens (or closes) like the command bar
      if (action === 'tabs.switcher') {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        requestBox('')
        setCommandOpen((v) => !v) // the tab list is quick open's first section
        return
      }
      // W9-E: the New modal opens (or closes) like the switcher
      if (action === 'new.open') {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        setNewOpen((v) => !v)
        return
      }
      if (action === 'command.open' || action === 'search.open' || action === 'command.talk') {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        if (action !== 'command.talk') setCommandOpen((v) => !v)
        else {
          setCommandOpen(true)
          setTalkSignal((n) => n + 1)
        }
        return
      }
      if (action === 'sidebar.home' || action === 'sidebar.jobs' || action === 'sidebar.howItWorks') {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return // holding the key would flap the sidebar
        if (action === 'sidebar.home') toggleSessions()
        else if (action === 'sidebar.jobs') toggleJobs()
        else toggleHiw()
        return
      }
      // DESIGN-W13 §9: the workbench chords. They go through navigation.ts, whose handlers hold the panel's state too.
      if (action.startsWith('activity.')) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) openActivity(action.slice('activity.'.length) as ActivityId)
        return
      }
      if (action === 'sidebar.toggle' || action === 'panel.toggle' || action === 'settings.open') {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        if (action === 'sidebar.toggle') toggleSideBar()
        else if (action === 'panel.toggle') togglePanel()
        else openView('settings')
        return
      }
      // Ctrl+Shift+P is the command palette, Ctrl+P quick open: the same box, started with `>` or empty (command/boxStore.ts)
      if (action === 'palette.open' || action === 'quickOpen') {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        requestBox(action === 'palette.open' ? '>' : '')
        setCommandOpen((v) => !v)
        return
      }
      // Closing a file tab, same as closing a browser tab. When dirty, closeFileTab raises a
      // confirmation modal. The condition is that the active tab is one Ctrl+W may close — a file or a
      // How It Works record. Both are opened and closed freely to read something; a session is not, and
      // closing one kills a process, so it is left out (the tab strip's × still closes all three).
      // A tab lives in a pane now, so whether the explorer sidebar is showing says nothing about it.
      // It is still not intercepted while xterm has focus — in a terminal, Ctrl+W deletes the previous
      // word, which is needed while typing to Claude (see yieldsToTerminal above).
      if (action === 'explorer.closeFileTab') {
        const id = closableTabIdRef.current
        if (!id) return // nothing closable is open — unlike a browser, this does not close the window
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return // stops tabs closing in a chain while the key is held
        // Through the shared closer rather than closeFileTab, so a file still gets its dirty-file
        // confirmation and a record tab takes its own branch (which also clears the remembered scope).
        closeWorkbenchTabRef.current(id)
        return
      }
      // 마크다운 프리뷰 모드 순환. 활성 탭이 .md 일 때만 의미가 있다. 툴바 버튼은 모드를 직접
      // 지정하고 이 키만 순환한다 — 두 진입점의 역할이 다르다.
      // CM6 안에서도 동작해야 한다(explorer.toggleMode 와 같은 예외): 편집하다가 결과를 보려고
      // 누르는 키인데 에디터에 포커스가 있을 때 막히면 쓸 수 없다
      if (action === 'explorer.cyclePreview') {
        const id = activeFileIdRef.current
        if (!id) return
        const tab = fileTabsRef.current.find((tb) => tb.id === id)
        if (!tab || !isMarkdownPath(tab.path)) return
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        const cur = mdModesRef.current[id] ?? defaultMdMode()
        setMdMode(id, cycleViewMode(cur))
        return
      }
      // The run shortcuts. Unlike most branches here there is no `editable` guard: these are F-key
      // combinations that no text field claims, and running the project from inside the terminal is
      // the case they exist for.
      if (action === 'run.run' || action === 'run.stop' || action === 'run.rerun' || action === 'run.selectConfig') {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        if (action === 'run.selectConfig') {
          // Without a project the Run view has no list to focus, and the flag would stay raised until
          // the next project is opened and the list sprang into focus by itself.
          if (!currentProjectRef.current) return
          revealRunConfigs(() => setRunMenuOpen(true))
        } else if (action === 'run.run') runStartRef.current()
        else if (action === 'run.stop') runStopSelectionRef.current()
        else runRerunSelectedRef.current()
        return
      }
      // Pane splitting — by default Ctrl+\ to the right, Ctrl+Shift+\ below. The same place VS Code
      // puts them. Neither the Claude Code nor the Codex TUI uses Ctrl+\, so terminal input is unaffected.
      if (action === 'pane.splitRight' || action === 'pane.splitDown') {
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        const cur = layoutRef.current
        const dir: PaneDir = action === 'pane.splitDown' ? 'col' : 'row'
        if (cur && countLeaves(cur) >= MAX_PANES) {
          toast.info(tRef.current('session.pane.maxReached'))
          return
        }
        // With 2 or more tabs in the active group, the active tab moves into a new group — whichever
        // kind it is. A file on one side and a session on the other is the arrangement this keyboard
        // path exists for, so the tab id goes to the tree unread.
        const target =
          cur && ((activePaneIdRef.current && leafOf(cur, activePaneIdRef.current)) || firstLeaf(cur))
        if (target && target.tabIds.length >= 2) {
          splitActiveRef.current(dir, false, target.activeTabId)
          return
        }
        // With only one tab, splitting would change nothing, so a new session is created first —
        // cancelling leaves the layout untouched. pendingSplitRef is set only when the dialog actually
        // opens: if it does not, no cleanup path runs, the value lingers, and some later unrelated
        // session picks it up and splits unexpectedly.
        if (cliRef.current?.claude.ok === true || cliRef.current?.codex.ok === true) {
          pendingSplitRef.current = dir
          setShowNew(true)
        }
        return
      }
      // The remaining actions are tab cycling (sessionTab.*) and moving focus to a neighbouring pane (pane.focus*).
      const focusMove = action.startsWith('pane.focus')
      const delta = action === 'sessionTab.prev' || action === 'pane.focusLeft' || action === 'pane.focusUp' ? -1 : 1
      const vertical = action === 'pane.focusUp' || action === 'pane.focusDown'
      // Ignored while a normal input field — not a terminal — has focus (preserves its own Ctrl+Shift+arrow selection).
      // Tab cycling is the exception inside our own editor: the tab bar is reachable from the terminal
      // but would otherwise be unreachable from the editor, which is where you sit while reading a file.
      // The exception is scoped to .cm-editor rather than to every input, so a rebind onto an arrow chord
      // still leaves a settings field's own selection alone. Same shape as explorer.toggleMode's exception.
      const tabCycle = action === 'sessionTab.prev' || action === 'sessionTab.next'
      if (editable && !inXterm && !inConversation && !(tabCycle && focusEl?.closest('.cm-editor'))) return
      // With Shift, move focus to a neighbouring group; otherwise cycle tabs within the
      // active group. Global session cycling is gone: sessions are scattered across groups, so there is
      // no such thing as a "global order". To reach a session in another group, move groups with
      // Ctrl+Shift+arrow and pick the tab with Ctrl+PageUp/Down (the same division of labour as
      // IntelliJ's Goto Next Splitter plus Select Next Tab).
      // Only what the open workspace shows: a group or tab hidden in another project's is never reached
      const cur = layoutRef.current && shownLayoutRef.current(layoutRef.current)
      const curPane = activePaneIdRef.current
      if (focusMove && cur && curPane && countLeaves(cur) >= 2) {
        const dir: MoveDir = vertical ? (delta < 0 ? 'up' : 'down') : delta < 0 ? 'left' : 'right'
        const next = findNeighbor(cur, curPane, dir)
        // With no neighbour, do nothing and let it flow through to the terminal — putting
        // preventDefault before the next check would swallow a key like Ctrl+Shift+↓ with no neighbour
        // before it ever reached the terminal
        if (!next) return
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        setActivePaneId(next)
        return
      }
      if (vertical) return // unsplit, there is no cycling up or down
      // Unsplit, there is only one group, so this effectively cycles every session — the same as it always felt
      const tab = cycledTab(cur, curPane, delta)
      if (!tab) return
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      // 종류를 가리지 않고 그 페인의 탭 줄에 그려진 순서대로 돈다 — 파일 탭과 세션 탭 사이에 경계가
      // 없다. 클릭과 같은 경로(selectWorkbenchTab)를 타야 세션 탭을 지날 때 활성 세션도 함께 맞춰진다
      selectWorkbenchTabRef.current(tab)
    }
    window.addEventListener('keydown', onKey, true) // capture
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    // Rolling: swap the session in place in the same tab, plus the progress banner state
    const offRolled = window.api.on('session:rolled', ({ oldSessionId, info }) => {
      sessionBus.discard(oldSessionId)
      setSessions((prev) => prev.map((s) => (s.id === oldSessionId ? info : s)))
      // Swaps only the id while keeping the tab's position, order, and active state — the same function as a restart
      setLayout((cur) =>
        cur ? replaceTabId(cur, sessionTab(oldSessionId), sessionTab(info.id)) : cur
      )
      setRollStates((prev) => {
        const { [oldSessionId]: _dropped, ...rest } = prev
        return rest
      })
      // The new session after a roll is judged afresh from its own OSC — the old id's busy state is discarded
      setBusy((prev) => {
        const { [oldSessionId]: _dropped, ...rest } = prev
        return rest
      })
    })
    const offBusy = window.api.on('session:busy', ({ sessionId, busy: b }) =>
      setBusy((prev) => (prev[sessionId] === b ? prev : { ...prev, [sessionId]: b }))
    )
    const offRollState = window.api.on('session:rollState', (ev) => {
      // A failed auto-resume is announced with a toast. Why not a banner: a banner only disappears once
      // 'none' arrives, and nothing publishes that after stalled, so it would stay forever. And a
      // rolling session with Slack turned off has no record in SlackNotifier (see register in
      // slack.ts), so this is the only path that reaches a person — hook injection was widened to those
      // sessions but the notification was missing.
      // The error kind does not auto-dismiss — missing it leaves a session sitting stopped.
      if (ev.state === 'stalled') {
        // This listener registers once (deps []), so reading sessions directly would capture the empty
        // array from mount time and always stamp a UUID into the title — the latest value comes from a ref
        const title = sessionsRef.current.find((s) => s.id === ev.sessionId)?.title ?? ev.sessionId
        toast.error(t('session.toast.stalled', { title }))
        return // a momentary event, so it is not kept as banner state
      }
      // Marked heard *below* the return above: 'stalled' is momentary and touches no banner state, so
      // recording it would only make a legitimate seed for this session be dropped as stale.
      heardRollRef.current.add(ev.sessionId)
      setRollStates((prev) => {
        if (ev.state === 'none') {
          const { [ev.sessionId]: _dropped, ...rest } = prev
          return rest
        }
        return { ...prev, [ev.sessionId]: ev }
      })
    })
    const offSchedState = window.api.on('session:schedState', (ev) => {
      heardSchedRef.current.add(ev.sessionId)
      setSchedStates((prev) => {
        if (ev.state === 'off') {
          const { [ev.sessionId]: _dropped, ...rest } = prev
          return rest
        }
        return { ...prev, [ev.sessionId]: ev }
      })
    })
    return () => {
      offRolled()
      offBusy()
      offRollState()
      offSchedState()
    }
  }, [])

  // When a shell dies on its own (the user typed exit) its tab is removed — a dead shell tab is noise.
  // If it was the active tab, we go back to Run (the panel itself stays).
  // Receives terminals main took back from the Host as tabs, the way session:created is received
  // above. The user path builds its tab from what terminal.open returned, so only the reattach sweep
  // sends this; without it a panel that was already open showed nothing until the project was
  // reopened. The tab is added but not activated, on the same reasoning session:created uses for
  // background=true: nobody asked for it just now, so it must not take the keys someone is typing.
  // The root is read through the ref because this is registered once at mount (bottomRootRef, not
  // currentProjectRef — with no project those two differ, and the panel shows the home root).
  // A shell the app only lost sight of (a Host handover, a dropped socket) keeps its tab for the Host to give back
  // under the same id; it goes only if nothing does within the grace (terminalsWithExit).
  useEffect(() => {
    const lost = new Map<string, ReturnType<typeof setTimeout>>()
    const drop = (id: string): void => {
      setTerminals((prev) => prev.filter((x) => x.id !== id))
      setBottomTab((cur) => (cur === id ? 'run' : cur))
    }
    const off = window.api.on('terminal:exit', (e) => {
      clearTimeout(lost.get(e.id))
      lost.delete(e.id)
      setTerminals((prev) => terminalsWithExit(prev, e))
      if (e.exitCode === LOST_SIGHT_EXIT_CODE) lost.set(e.id, setTimeout(() => (lost.delete(e.id), drop(e.id)), LOST_TERMINAL_GRACE_MS))
      else setBottomTab((cur) => (cur === e.id ? 'run' : cur))
    })
    const offCreated = window.api.on('terminal:created', (info) => {
      clearTimeout(lost.get(info.id))
      lost.delete(info.id)
      setTerminals((prev) => terminalsWithCreated(prev, info, bottomRootRef.current))
    })
    return () => {
      off()
      offCreated()
      for (const t of lost.values()) clearTimeout(t)
    }
  }, [])

  /** Places a new session. Which group it goes into is decided by placeTab, a pure function in core
   *  (covering four cases: a restart swap, a reserved split, an already-open session, and the active
   *  group), and all this does is move that result into state.
   *  A null paneId leaves the active pane alone — a restart merely inherits the tab's position.
   *  StrictMode can invoke an updater twice, so nothing is computed inside the setLayout callback. */
  const place = (cur: PaneNode | null, sessionId: string, splitDir?: PaneDir | null,
    replaces?: string | null, background?: boolean): void => {
    const res = placeTab(cur, sessionTab(sessionId), {
      activePaneId: activePaneIdRef.current,
      splitDir,
      // 트리에 담기는 값이 탭 id이므로 교체 대상도 같은 형식으로 감싼다 — 날 세션 id를 넘기면
      // 트리에서 찾지 못해 조용히 일반 배치로 떨어지고, 탭이 자기 자리를 잃는다
      replaces: replaces ? sessionTab(replaces) : replaces,
      background
    })
    setLayout(res.root)
    if (res.paneId) setActivePaneId(res.paneId)
    if (res.paneId && !background) ownerPickRef.current = { tabId: sessionTab(sessionId) } // a session the owner opened
    // Only reported when a split was requested but hit the cap and landed in the active group — the
    // case where the target group's only tab makes splitting a no-op is not a failure, so it stays quiet
    if (res.splitFellBack && cur && countLeaves(cur) >= MAX_PANES)
      toast.info(t('session.pane.maxReached'))
  }

  const spawn = async (opts: {
    accountIds: string[]
    cwd: string
    saveDefault: boolean
    kind?: SessionKind
    resumeSessionId?: string
    resumeTranscriptPath?: string
    resumeThreadId?: string // chat only: resume this protocol thread instead of starting one
    takeOverBackground?: boolean // stop the Claude background session holding the conversation first
    roll?: boolean
    rollPrompt?: string
    slackNotify?: boolean
    bypassPermissions?: boolean
    /** chat takeover P8: the New Session dialog's pick for a chat session, forwarded to sessions.spawn
     *  unchanged. Absent for a terminal session, which has no such policy at all. */
    unattendedPermission?: UnattendedPermission
    useWorktree?: boolean
    worktreeName?: string
    worktreeBaseRef?: string
    /** The new-session dialog's id for this creation — its progress and Cancel go by it */
    worktreeOpId?: string
    repoRoot?: string | null
    schedule?: ScheduleConfig
    /** The old session id, for when an existing tab's session id has to be swapped, as on a restart */
    replacesSessionId?: string
  }): Promise<string | null> => {
    // Answers the new session's id (T7 review: Ask AI types its prompt into it), null when nothing started
    // Once creation succeeds, the worktree is not rolled back even if a later step fails (the registry
    // is persistent by design) — kept outside the try so the catch can tell the user it is still there
    let createdWorktreeName: string | null = null
    try {
      let cwd = opts.cwd
      // Splitting off into a worktree: on a creation failure the session is not started
      if (opts.useWorktree && opts.repoRoot) {
        const created = await window.api.worktrees.create({
          repoPath: opts.repoRoot,
          name: opts.worktreeName,
          baseRef: opts.worktreeBaseRef,
          ...(opts.worktreeOpId ? { opId: opts.worktreeOpId } : {})
        })
        createdWorktreeName = created.info.name
        created.warnings.forEach((w) => toast.info(t(w.key, w.params)))
        cwd = created.info.path
        notifyWorktreeCreated() // WorktreePanel in the sidebar is subscribed — tell it now instead of waiting for the next expand or refresh
      }
      // Rolling is on when the roll flag is set (the modal always sets it for multiple accounts; for a
      // single one it is the checkbox). When on, every selected account is passed as rollAccountIds —
      // a single one (auto-resume) is [that account], multiple are [a,b,c].
      // A user-specified resume prompt (rollPrompt) travels with it — empty means main uses the default.
      const rolling = opts.roll === true
      const info = await window.api.sessions.spawn({
        accountId: opts.accountIds[0],
        cwd,
        kind: opts.kind, // default 'terminal'
        resumeSessionId: opts.resumeSessionId,
        resumeTranscriptPath: opts.resumeTranscriptPath, // the transcript copy source when resuming under a different account
        resumeThreadId: opts.resumeThreadId, // chat only: resume this protocol thread instead of starting one
        takeOverBackground: opts.takeOverBackground,
        rollAccountIds: rolling ? opts.accountIds : undefined,
        rollPrompt: rolling ? opts.rollPrompt : undefined,
        slackNotify: opts.slackNotify, // Slack progress notifications
        bypassPermissions: opts.bypassPermissions, // start without permission prompts
        unattendedPermission: opts.unattendedPermission, // chat takeover P8: hold, or deny after 60 s
        schedule: opts.schedule
      })
      // The default account mapping is keyed on the original repo — a worktree path is new every time and mappings must not pile up
      // T1: no account (auto) saves no default
      if (opts.saveDefault && opts.accountIds[0])
        await window.api.projects.setDefaultAccount(opts.repoRoot ?? opts.cwd, opts.accountIds[0])
      // What actually happened to the resume the modal asked for — the rolling guard focused an existing
      // tab instead (its options quietly discarded), or Smart Resume started a blank session carrying a
      // briefing. Both look wrong to the user unless we say so: one drops the chosen account, the other
      // shows an empty window where a conversation was expected. The verdict is made outside the
      // setSessions callback, through sessionsRef: a state updater has to be pure, and StrictMode may run
      // it twice, so raising a toast inside risks firing twice.
      const notice = spawnNotice({
        // A chat resume never sets resumeSessionId — it asks by resumeThreadId instead — so the two
        // are merged here for spawnNotice, which only ever sees one flat id either way.
        requestedResumeSessionId: opts.resumeSessionId ?? opts.resumeThreadId,
        returnedResumeSessionId: info.threadId ?? info.resumeSessionId,
        returnedTabAlreadyOpen: sessionsRef.current.some((s) => s.id === info.id)
      })
      setSessions((prev) => (prev.some((s) => s.id === info.id) ? prev : [...prev, info]))
      if (notice) toast.info(t(`session.spawn.${notice}`))
      const cur = layoutRef.current
      const pending = pendingSplitRef.current
      pendingSplitRef.current = null
      place(cur, info.id, pending, opts.replacesSessionId)
      setShowNew(false)
      setNewSessionCwd(null)
      return info.id
    } catch (err) {
      // If session creation fails while a split is pending, only the dialog closes and the layout stays
      // as it was — no empty pane is left behind
      pendingSplitRef.current = null
      // When a restart has already removed the old session from sessions and the spawn then fails, a
      // dead id would be left in the tree alone. If a group empties, removeTab promotes its sibling
      // (invariant 2) — the cleanup that took 25 lines in the old model is now one.
      const gone = opts.replacesSessionId
      if (gone) {
        const cur = layoutRef.current
        if (cur && !sessionsRef.current.some((s) => s.id === gone)) {
          const next = removeTab(cur, sessionTab(gone))
          if (next) {
            const p = activePaneIdRef.current
            setActivePaneId(p && leafOf(next, p) ? p : firstLeaf(next).id)
            setLayout(next)
          } else {
            setActivePaneId(null)
            setLayout(null)
          }
        }
      }
      const raw = err instanceof Error ? err.message : String(err)
      // Cancelled and fully rolled back: what the person asked for, said as a notice rather than a failure
      if (isWorktreeCancelled(raw)) {
        toast.info(t('worktree.error.cancelled'))
        return null
      }
      const msg = spawnErrorMessage(raw)
      // A Claude background session holds the conversation: say so, and offer to take it over —
      // the same spawn again, stopping that session first.
      if (msg.key.startsWith('session.spawn.inBackground')) {
        const id = toast.error(t(msg.key, msg.params), {
          action: {
            label: t('session.spawn.inBackground.takeOver'),
            onClick: () => {
              dismiss(id)
              void spawn({ ...opts, takeOverBackground: true })
            }
          }
        })
        return null
      }
      const message = t(msg.key, msg.params)
      // On a failure after the worktree was created, the user is also told that it remains, unrolled-back
      toast.error(
        createdWorktreeName
          ? t('session.spawn.failedWorktreeKept', { message, name: createdWorktreeName })
          : t('session.spawn.failed', { message })
      )
      return null
    }
  }

  // Opening a file tab: clicking the same path again focuses the existing tab (VS Code's behaviour).
  // The buffer starts as loading and gets filled by files.read. `at` is a console link's line — the
  // editor moves there once the content is in (FileEditor's reveal effect).
  const openFile = (path: string, at?: { line: number; col?: number }): void => {
    const id = fileTab(path)
    if (fileTabsRef.current.some((t) => t.id === id)) {
      selectWorkbenchTabRef.current(id)
      if (at) {
        requestReveal(id, at)
        // A line number is a source line; the preview has no such line, so a tab showing only the
        // preview switches to the editor. A split already shows the source — leave it, or the link
        // would collapse a view the user set up on purpose. The raw setter, not setMdMode — that one
        // also writes MD_MODE_KEY, and following a link is navigation, not a preference the user
        // expressed for every future markdown file.
        if (isMarkdownPath(path)) {
          const cur = mdModesRef.current[id] ?? defaultMdMode()
          if (cur === 'preview') setMdModes((prev) => ({ ...prev, [id]: 'editor' }))
        }
      }
      return
    }
    const root = currentProjectRef.current
    if (!root) return // 트리가 없는 상태에서는 파일을 열 수 없다 — 열 수단 자체가 트리다
    const title = path.split(/[\\/]/).pop() || path
    setFileTabs((prev) => [...prev, { id, path, title, projectRoot: root }])
    // 파일 탭도 세션 탭과 같은 트리에 들어간다 — 활성 페인의 새 탭으로 열린다. 세션을 놓을 때와 같은
    // 함수를 쓰므로 배치 규칙이 한 벌뿐이다. StrictMode 대비로 setLayout 콜백 밖에서 계산한다
    const placed = placeTab(layoutRef.current, id, { activePaneId: activePaneIdRef.current })
    setLayout(placed.root)
    if (placed.paneId) setActivePaneId(placed.paneId)
    setFileBuffers((prev) => ({ ...prev, [id]: { content: '', savedContent: '', eol: '\n', readOnly: false, loading: true, error: null, conflict: false } }))
    // mdModes 를 여기서 바로 채운다 — fileBuffers 와 같은 자리(탭이 생기는 시점). 그렇지 않으면
    // 이 탭의 모드는 사용자가 그 탭에서 직접 모드를 바꾸기 전까지 mdModes 에 아예 없고, 렌더가
    // `mdModes[f.id] ?? defaultMdMode()` 로 매번 localStorage 를 다시 읽어 "마지막으로 고른 모드"를
    // 대신 쓴다 — 그러면 다른 탭에서 모드를 바꾸는 순간 이 탭도 함께 바뀐 것처럼 보인다(탭별이어야
    // 할 모드가 사실상 전역이 된다). 여기서 한 번 못박아 두면 `??` 는 이 탭이 실제로 아직 없을 때만
    // 쓰이는 안전망으로 되돌아간다.
    if (isMarkdownPath(path))
      setMdModes((prev) => ({
        ...prev,
        [id]: at ? (defaultMdMode() === 'preview' ? 'editor' : defaultMdMode()) : defaultMdMode()
      }))
    if (at) requestReveal(id, at)
    window.api.files.read(path).then(
      (d) => setFileBuffers((prev) => (prev[id] ? { ...prev, [id]: { content: toLf(d.content), savedContent: toLf(d.content), eol: detectEol(d.content), readOnly: d.truncated || d.binary, loading: false, error: d.binary ? t('files.editor.binaryUnsupported') : null, conflict: false } } : prev)),
      (err) => setFileBuffers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], loading: false, error: err instanceof Error ? err.message : String(err) } } : prev))
    )
  }

  /** Opens the media viewer on `path`, or focuses the tab already showing it (placeMediaTab). Needs no
   *  project, unlike openFile: the viewer reads nothing through the project guard, and an agent's
   *  output folder is rarely a project. The path must have come from files.resolveLink or
   *  run.resolveLink — that is what lets main serve it (main/media/allowlist.ts). */
  const openMedia = (path: string): void => {
    const placed = placeMediaTab(layoutRef.current, path, { activePaneId: activePaneIdRef.current })
    setLayout(placed.root)
    if (placed.paneId) setActivePaneId(placed.paneId)
    // A second click on a link to an open file is how the person asks for the new version: its
    // viewer re-reads the stat on the bump and reloads if the file changed
    const reopened = placed.reopened
    if (reopened) setMediaNonces((prev) => ({ ...prev, [reopened]: (prev[reopened] ?? 0) + 1 }))
  }

  /** A resolved path link (a console, a terminal, a SendUserFile row): media goes to the viewer, any
   *  other file to an ordinary file tab at the line the output named. */
  const openLinkedPath = (path: string, at?: { line?: number; col?: number }): void => {
    if (mediaKindOf(path)) {
      openMedia(path)
      return
    }
    openFile(path, at?.line === undefined ? undefined : { line: at.line, col: at.col })
  }

  /** A file the explorer or a Markdown preview opens: an image or a video in the media viewer, as a link would open it,
   *  any other file in a file tab (lib/openPath.ts). Media is admitted through the project guard first
   *  (files.admitMedia), which is what lets the viewer load it. */
  const openProjectFile = (path: string): void => {
    void openPath(path, {
      resolve: (p) => window.api.files.admitMedia(p).then((r) => r?.path ?? null),
      openMedia,
      openFile: (p) => openFile(p)
    })
  }

  /** 에디터가 사라질 때 그 상태를 캐시에 넘겨받는다. 세션 모드로 나가면 .run-host가 통째로
   *  언마운트되므로, 이 경로가 없으면 되돌리기 이력이 거기서 끊긴다(세션 탭은 숨기기만 해서 안 끊긴다).
   *
   *  탭이 아직 열려 있을 때만 보관한다. 탭을 닫는 경로는 이미 cache.drop을 했고 그 뒤에 언마운트가
   *  오므로, 무조건 저장하면 방금 버린 항목이 되살아난다. closeExplorer도 같은 이유로 이 가드에
   *  걸린다 — 거기서는 clear() 뒤에 언마운트가 오고, 그때 fileTabs는 이미 비어 있다. */
  const retireEditorState = (
    path: string,
    state: EditorState,
    scroll: StateEffect<unknown> | null
  ): void => {
    if (!fileTabsRef.current.some((t) => t.path === path)) return
    editorCacheRef.current.save(path, state, scroll)
  }

  const setBufferContent = (id: string, content: string): void => {
    setFileBuffers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], content } } : prev))
    // The ref too, at once: a save or a close that flushed the editor reads it in the same turn (second pass R2-1).
    const cur = fileBuffersRef.current[id]
    if (cur) fileBuffersRef.current = { ...fileBuffersRef.current, [id]: { ...cur, content } }
  }

  const saveFile = (id: string): void => {
    flushPendingEdits()
    const buf = fileBuffersRef.current[id]
    const tab = fileTabsRef.current.find((t) => t.id === id)
    if (!buf || !tab || buf.readOnly || buf.content === buf.savedContent) return
    // 디스크에는 그 파일 본래의 줄바꿈으로 되돌려 쓴다. savedContent는 LF 그대로 둔다 — 버퍼끼리의
    // 비교(더티 판정)는 전부 LF 기준이고, 디스크와의 비교는 읽어 올 때 toLf를 거친다
    window.api.files.write(tab.path, applyEol(buf.content, buf.eol)).then(
      () => setFileBuffers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], savedContent: buf.content, conflict: false } } : prev)),
      (err) => toast.error(t('files.save.failed', { detail: err instanceof Error ? err.message : String(err) }))
    )
  }

  const reloadBufferFromDisk = (id: string): void => {
    const tab = fileTabsRef.current.find((t) => t.id === id)
    if (!tab) return
    window.api.files.read(tab.path).then(
      (d) =>
        setFileBuffers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], content: toLf(d.content), savedContent: toLf(d.content), eol: detectEol(d.content), readOnly: d.truncated || d.binary, conflict: false, error: d.binary ? t('files.editor.binaryUnsupported') : null } } : prev)),
      (err) => toast.error(t('files.reload.failed', { detail: err instanceof Error ? err.message : String(err) }))
    )
  }

  /** 탭 하나를 트리에서 뺀다. 다음에 무엇이 활성이 되는지는 removeTab 이 정한다(세션 탭을 닫을 때와
   *  같은 규칙). 연쇄로 닫힐 때(폴더 삭제) 다음 반복이 렌더 전의 낡은 값을 읽지 않는 것은
   *  setLayout·setActivePaneId 가 ref 를 바로 옮기기 때문이다(lib/writeThrough.ts) — closeFileTab 의
   *  fileTabsRef 미러링과 같은 이유다.
   *  기능 탭이 세 번째 종류로 들어오면서 파일 탭과 이 꼬리를 그대로 나눠 쓰게 되어 함수가 되었다 —
   *  기능 탭에는 버퍼도 죽일 프로세스도 없어 닫기가 이것 하나다. */
  const dropTabFromTree = (id: string): void => {
    const cur = layoutRef.current
    if (!cur || !groupOfTab(cur, id)) return
    const nextLayout = removeTab(cur, id)
    const p = activePaneIdRef.current
    const nextPane = nextLayout ? (p && leafOf(nextLayout, p) ? p : firstLeaf(nextLayout).id) : null
    setActivePaneId(nextPane)
    setLayout(nextLayout)
  }

  const closeFileTab = async (id: string): Promise<void> => {
    // Decided outside the updater — avoids StrictMode double-invocation side effects (the existing convention)
    flushPendingEdits()
    const buf = fileBuffersRef.current[id]
    if (buf && !buf.readOnly && buf.content !== buf.savedContent) {
      const title = fileTabsRef.current.find((t) => t.id === id)?.title
      const ok = await confirmModal({
        title: t('files.unsaved.title'),
        body: title ? t('files.unsaved.bodyWithTitle', { title }) : t('files.unsaved.body'),
        confirmLabel: t('common.close')
      })
      if (!ok) return
    }
    // An await boundary was crossed, so state is read from the ref again
    const closedTab = fileTabsRef.current.find((t) => t.id === id)
    const next = fileTabsRef.current.filter((t) => t.id !== id)
    if (closedTab) editorCacheRef.current.drop(closedTab.path)
    dropReveal(id)
    // Mirrored immediately, before the render — when clean tabs close in a chain (a folder deletion),
    // await only yields a microtask and the React commit (render) does not fit in between, so this
    // stops the ref being read stale on the next iteration
    fileTabsRef.current = next
    setFileTabs(next)
    setFileBuffers((prev) => {
      const { [id]: _drop, ...rest } = prev
      return rest
    })
    setMdModes((prev) => {
      const { [id]: _drop, ...rest } = prev
      return rest
    })
    // 트리에서도 뺀다(dropTabFromTree). 그러면 activeFileId 는 파생값이므로 저절로 따라온다
    if (activeFileIdRef.current === id) activeFileIdRef.current = null
    dropTabFromTree(id)
  }

  /** 탭 줄에서 탭을 골랐다. 종류에 상관없이 트리에서 그 탭을 활성으로 만들고 그 페인에 포커스를 준다 —
   *  다른 페인의 탭을 눌렀을 때 그 페인으로 옮겨 가는 것도 이 한 줄이 한다 */
  /** Opens a session on a paired Runtime in a tab, or brings its open tab forward. */
  const openRemoteSession = (ref: RemoteSessionRef): void => {
    setRemoteSessions((prev) => (prev.some((r) => r.key === ref.key) ? prev.map((r) => (r.key === ref.key ? ref : r)) : [...prev, ref]))
    place(layoutRef.current, ref.key)
  }

  const selectWorkbenchTab = (tabId: string): void => {
    const cur = layoutRef.current
    if (!cur) return
    const act = activateTab(cur, tabId)
    if (!act) return
    ownerPickRef.current = { tabId }
    setLayout(act.root)
    setActivePaneId(act.paneId)
  }
  // 탭 순환 단축키가 클릭과 같은 경로를 타도록 — 이 함수는 매 렌더 새로 만들어지지만 본문이 setter와
  // ref뿐이라 최신 상태에 대해 동작한다(toggleExplorer와 같은 관례)
  selectWorkbenchTabRef.current = selectWorkbenchTab

  /** A file tab closes through its existing path (a confirmation modal when dirty); a session tab
   *  closes through session mode's tab-close path. A record tab is nothing more than dropping it from
   *  the tree — skip that branch here and its id would be read as a session id and flow into
   *  sessions.kill. A browser tab is dropped the same way as a record tab. */
  const closeWorkbenchTab = (tabId: string, how?: CloseHow): void => {
    const ref = parseTab(tabId)
    if (!ref) return
    if (ref.kind === 'file') {
      void closeFileTab(tabId)
      return
    }
    if (ref.kind === 'record') {
      // Drops the remembered scope along with it — same place as clearing a file tab's buffer when
      // it closes. Left alone it would grow for the life of the session, and reopening a closed tab
      // would resurrect a scope the user never set.
      const rec = recordTabs.find((x) => x.id === tabId)
      if (rec)
        setScopedNode((prev) => {
          const { [scopeKey(rec)]: _drop, ...rest } = prev
          return rest
        })
      setRecordTabs((prev) => prev.filter((x) => x.id !== tabId))
      dropTabFromTree(tabId)
      return
    }
    if (ref.kind === 'browser') {
      // A page, not a process: dropping the tab is the whole close. The webview unmounts with its slot.
      setBrowserTabs((prev) => prev.filter((x) => x.id !== tabId))
      setBrowserLoading(({ [tabId]: _l, ...rest }) => rest)
      setBrowserNonce(({ [tabId]: _n, ...rest }) => rest)
      dropTabFromTree(tabId)
      return
    }
    if (ref.kind === 'view') {
      // DESIGN-W13: a document, not a process. What it showed (Start's request, the open plan) is let go by
      // shell/viewTabs.tsx's useViewTabSync when the tab leaves the tree.
      dropTabFromTree(tabId)
      return
    }
    if (ref.kind === 'media') {
      // The tab id is the whole record (tabId's mediaTab): dropping it, and its reload nonce, is the
      // whole close; the viewer's slot unmounts with it
      setMediaNonces(({ [tabId]: _n, ...rest }) => rest)
      dropTabFromTree(tabId)
      return
    }
    if (ref.kind === 'app') {
      // A picture, not a process: dropping the tab is the whole close. The workspace itself is closed
      // only by the pane's Close button (workspace-close). The mirror entry stays, so the next frame of
      // a workspace that is still open does not put the tab back: only a workspace that opens again
      // does (newlyOpened reads a transition, not a presence). Its picture goes (second pass R2-2): a frame still
      // coming brings the next one.
      mirrorFrames.drop([ref.id])
      dropTabFromTree(tabId)
      return
    }
    if (isRemoteSessionKey(ref.id)) {
      // Closing the tab is not ending the session: it keeps running on the Runtime (v1 Remote Session 7, 8). Its
      // view unmounts with its slot, which detaches the stream.
      setRemoteSessions((prev) => prev.filter((r) => r.key !== ref.id))
      setRemoteStatus(({ [ref.id]: _s, ...rest }) => rest)
      dropTabFromTree(tabId)
      return
    }
    // T13: an agent's tab hides, the owner's own running console asks (recentlyClosed.ts closeSessionTab)
    void closeSessionTab(ref.id, how, {
      isAgent: isAgentSession,
      status: (id) => sessionsRef.current.find((s) => s.id === id)?.status,
      pref: ownConsolePref,
      setPref: setOwnConsolePref,
      ask: async () => {
        const a = await confirmModalWithChoices({
          title: t('tabs.close.title'),
          body: t('tabs.close.body'),
          confirmLabel: t('tabs.close.end'),
          cancelLabel: t('tabs.close.keep'),
          choices: [{ id: 'remember', label: t('tabs.close.remember') }],
          cancelKeepsChoices: true
        })
        return { how: a.ok ? 'end' : 'hide', remember: a.checked.includes('remember') }
      },
      hide: hideSession,
      end: closeSession
    })
  }

  /** What Recently closed keeps of a session whose tab goes. */
  const recordSessionClosed = (id: string, ended: boolean): void => {
    const s = sessionsRef.current.find((x) => x.id === id)
    if (!s) return
    recordClosed({
      sessionId: id,
      title: s.title,
      cwd: s.cwd,
      accountId: s.accountId,
      ...(s.kind ? { kind: s.kind } : {}),
      ...(s.bypassPermissions ? { bypassPermissions: true } : {}),
      ...(s.threadId ? { threadId: s.threadId } : {}),
      closedAt: Date.now(),
      ended
    })
  }

  /** T13: the tab goes, the process stays: the pane slot keeps its terminal (PaneGrid mounts every session), so the
   *  tile keeps borrowing it and a reopen puts the same tab back. */
  const hideSession = (id: string): void => {
    if (!layoutRef.current || !groupOfTab(layoutRef.current, sessionTab(id))) return
    recordSessionClosed(id, sessionsRef.current.find((s) => s.id === id)?.status !== 'running')
    dropTabFromTree(sessionTab(id))
  }

  /** Recently closed's reopen: a running session's tab goes back in the tree; an ended one resumes from its
   *  transcript in a new tab (a chat session from its thread), or says why it cannot. */
  const reopenTab = async (entry: ClosedTab): Promise<void> => {
    const s = sessionsRef.current.find((x) => x.id === entry.sessionId)
    if (reopenWayOf(s?.status) === 'attach') {
      dropClosed(entry.sessionId)
      const cur = layoutRef.current
      if (cur && groupOfTab(cur, sessionTab(entry.sessionId))) selectWorkbenchTab(sessionTab(entry.sessionId))
      else place(cur, entry.sessionId)
      return
    }
    // T1: the session's own chain when it is still known (an auto one's is its provider's ranking), so it rolls again;
    // main moves it off a full account (sessions.spawn)
    const opts = { ...chainOf(entry.accountId, s?.rollAccountIds), slackNotify: false, bypassPermissions: entry.bypassPermissions === true }
    if (entry.kind === 'chat') {
      if (!entry.threadId) {
        toast.info(t('tabs.recent.cannotResume', { title: entry.title }))
        return
      }
      dropClosed(entry.sessionId)
      void spawn({ accountIds: opts.accountIds, roll: opts.roll, cwd: entry.cwd, saveDefault: false, kind: 'chat', resumeThreadId: entry.threadId, bypassPermissions: opts.bypassPermissions })
      return
    }
    const tr = await window.api.sessions.transcript(entry.sessionId).catch(() => null)
    if (!tr) {
      toast.info(t('tabs.recent.cannotResume', { title: entry.title }))
      return
    }
    dropClosed(entry.sessionId)
    resumeFromHistory(
      {
        id: `${entry.accountId}:${tr.sessionId}`,
        accountId: entry.accountId,
        sessionId: tr.sessionId,
        projectPath: entry.cwd,
        title: entry.title,
        updatedAt: new Date(entry.closedAt).toISOString(),
        filePath: tr.transcriptPath,
        awaitingReply: false,
        rootUuid: null
      },
      entry.cwd,
      { ...opts, kind: 'terminal' }
    )
  }
  setReopenHandler((entry) => void reopenTab(entry))
  // Ctrl+W 가 이 함수를 타도록 — 위 selectWorkbenchTabRef 와 같은 자리, 같은 이유다
  closeWorkbenchTabRef.current = closeWorkbenchTab

  // Adjusting open tabs after a file operation. A watcher event does not say 'what became what', so the
  // renderer adjusts them itself right after the operation succeeds. A tab id is literally
  // `file:${path}`, so the buffer map's key moves with it.
  const handlePathRenamed = (from: string, to: string): void => {
    // A media tab under the path follows too, as a file tab does (final review of the explorer opening media, I1). The
    // new path is admitted first, or the viewer could not load it; the tab keeps its place and its reload nonce.
    for (const old of mediaTabsUnder(layoutRef.current, from)) {
      const moved = rebasePath(old, from, to)
      void window.api.files.admitMedia(moved).then((r) => {
        const next = r?.path ?? moved
        setLayout((cur) => (cur && groupOfTab(cur, mediaTab(old)) ? replaceTabId(cur, mediaTab(old), mediaTab(next)) : cur))
        setMediaNonces((prev) => {
          if (!(mediaTab(old) in prev)) return prev
          const { [mediaTab(old)]: nonce, ...rest } = prev
          return { ...rest, [mediaTab(next)]: nonce }
        })
      })
    }
    const affected = fileTabsRef.current.filter((t) => isSubPath(from, t.path))
    if (affected.length === 0) return
    const remap = new Map(affected.map((t) => [t.id, `file:${rebasePath(t.path, from, to)}`]))
    setFileTabs((prev) =>
      prev.map((t) => {
        const nid = remap.get(t.id)
        if (!nid) return t
        const npath = nid.slice('file:'.length)
        return { id: nid, path: npath, title: npath.split(/[\\/]/).pop() || npath, projectRoot: t.projectRoot }
      })
    )
    setFileBuffers((prev) => {
      const next: typeof prev = {}
      for (const [k, v] of Object.entries(prev)) next[remap.get(k) ?? k] = v
      return next
    })
    // mdModes도 같은 모양으로 옮긴다 — 옮기지 않으면 이 탭의 모드가 사라져(openFile이 세운 "모든
    // 마크다운 탭은 mdModes 항목을 가진다"는 불변식이 깨짐) 다음 렌더가 `?? defaultMdMode()`로
    // 떨어지고, 방금까지 split/editor였던 탭이 이름만 바뀌었을 뿐인데 모드가 리셋된 것처럼 보인다
    setMdModes((prev) => {
      const next: typeof prev = {}
      for (const [k, v] of Object.entries(prev)) next[remap.get(k) ?? k] = v
      return next
    })
    // A reveal in flight for this tab (a link click's read window) must move with it too — otherwise
    // it is keyed to an id nothing will ever hold again and just sits there unfired.
    setPendingReveal((prev) => {
      const next: typeof prev = {}
      for (const [k, v] of Object.entries(prev)) next[remap.get(k) ?? k] = v
      return next
    })
    // 트리에도 같은 id가 들어 있으므로 함께 갈아끼운다 — 위치·순서·활성 여부가 그대로 유지된다
    // (계정 롤링이 세션 id를 바꿀 때 쓰는 것과 같은 함수). 세션 탭은 remap에 없으므로 건드려지지 않는다
    setLayout((cur) => {
      if (!cur) return cur
      let next = cur
      for (const [from, to] of remap) if (groupOfTab(next, from)) next = replaceTabId(next, from, to)
      return next
    })
  }

  const handlePathDeleted = (deleted: string[]): void => {
    // A media tab of a deleted file goes, as a file tab does (final review of the explorer opening media, I1); it has
    // nothing unsaved to ask about.
    for (const gone of deleted.flatMap((d) => mediaTabsUnder(layoutRef.current, d))) {
      dropTabFromTree(mediaTab(gone))
      setMediaNonces((prev) => {
        if (!(mediaTab(gone) in prev)) return prev
        const { [mediaTab(gone)]: _dropped, ...rest } = prev
        return rest
      })
    }
    // Closes that tab and anything below it. Dirty tabs are confirmed individually by closeFileTab — if
    // the user chooses to keep one, that tab stays along with a 'this file was deleted' banner (from the
    // watcher's unlink). Why they are awaited sequentially: confirmModal returns false immediately when
    // a modal is already open, so calling them in parallel would close the second and later dirty tabs
    // without asking.
    const affected = fileTabsRef.current.filter((t) =>
      deleted.some((d) => isSubPath(d, t.path))
    )
    if (affected.length === 0) return
    void (async () => {
      for (const t of affected) await closeFileTab(t.id)
    })()
  }

  // Subscribing to external changes: only change/add on the paths of open buffers are handled.
  // classifyExternalChange separates our own save (ignore), unmodified (reload), and mid-edit (a
  // conflict banner).
  // The same event also invalidates MarkdownPreview's local-image cache — unconditionally, ahead of the
  // open-buffer check below, since a referenced image is almost never itself an open file tab. A miss is
  // cheap (invalidateImageCache's own comment), so nothing here needs to guess whether c.path is actually
  // an image before calling it.
  useEffect(() => {
    const onChange = (c: FileChange): void => {
      if (c.kind === 'add' || c.kind === 'change' || c.kind === 'unlink') invalidateImageCache(c.path)
      const id = `file:${c.path}`
      const buf = fileBuffersRef.current[id]
      if (!buf) return
      if (c.kind === 'unlink') {
        setFileBuffers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], error: t('files.editor.deletedExternally') } } : prev))
        return
      }
      if (c.kind !== 'change' && c.kind !== 'add') return
      void window.api.files.read(c.path).then(
        (d) => {
          // What is typed but not yet sent counts as edited: a reload must not take it (second pass R2-1).
          flushPendingEdits()
          const b = fileBuffersRef.current[id]
          if (!b) return
          const verdict = classifyExternalChange(toLf(d.content), b.savedContent, b.content !== b.savedContent && !b.readOnly)
          if (verdict === 'ignore') {
            // Clears a lingering 'deleted' notice when the file was deleted and recreated (disk === savedContent)
            if (b.error) setFileBuffers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], error: null } } : prev))
            return
          }
          if (verdict === 'reload')
            setFileBuffers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], content: toLf(d.content), savedContent: toLf(d.content), eol: detectEol(d.content), readOnly: d.truncated || d.binary, conflict: false, error: d.binary ? t('files.editor.binaryUnsupported') : null } } : prev))
          else setFileBuffers((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], conflict: true, error: null } } : prev))
        },
        () => {
          // A failed re-read (permissions, a race) is quietly ignored — the next event retries
        }
      )
    }
    // One message per watcher window; each path appears once in it, with its latest kind (core/files/changeBatch.ts)
    const off = onFileChanges((batch) => {
      for (const c of batch.changes) onChange(c)
    })
    return off
  }, [])

  // Fully closing the explorer — the header ✕. Returns to session mode, clearing file tabs and the pin
  const closeExplorer = async (): Promise<void> => {
    // The header ✕ means a full close. With dirty tabs, confirm once and then clear the file tabs and buffers too
    flushPendingEdits()
    const hasDirty = fileTabsRef.current.some((t) => {
      const b = fileBuffersRef.current[t.id]
      return b && !b.readOnly && b.content !== b.savedContent
    })
    if (
      hasDirty &&
      !(await confirmModal({
        title: t('files.unsaved.title'),
        body: t('explorer.closeConfirm.body'),
        confirmLabel: t('common.close')
      }))
    )
      return
    showActivity('agents') // W9-B: the Files page closes back to Agents
    // 트리에 들어 있는 파일 탭도 함께 뺀다 — 남겨 두면 파일이 없는데 탭만 남는다. 하나씩 빼는 것은
    // removeTab이 빈 그룹 정리와 다음 활성 탭 선택까지 맡고 있기 때문이다
    let nextLayout = layoutRef.current
    for (const tab of fileTabsRef.current)
      if (nextLayout && groupOfTab(nextLayout, tab.id)) nextLayout = removeTab(nextLayout, tab.id)
    const p = activePaneIdRef.current
    const nextPane = nextLayout ? (p && leafOf(nextLayout, p) ? p : firstLeaf(nextLayout).id) : null
    setActivePaneId(nextPane)
    setLayout(nextLayout)
    fileTabsRef.current = []
    setFileTabs([])
    setFileBuffers({})
    setMdModes({})
    setPendingReveal({})
    explorerTreesRef.current.clear()
    explorerClipboardRef.current = null
    // This is the point where the explorer is abandoned entirely, so the undo journal and the per-file
    // EditorState cache are cleared as well — unlike the tree snapshot, no screen remains to reuse them
    // (that is the difference from a plain toggleExplorer). Left behind, the journal would let Ctrl+Z
    // undo operations that are not on screen the next time the explorer opens (possibly on a different
    // project), and the cache would hold every document and undo history of every file ever opened for
    // the lifetime of the process (drop is per file tab, and no tab is left to close).
    explorerUndoRef.current = []
    editorCacheRef.current.clear()
  }

  // 탐색기 토글 — 파일 탭과 루트별 펼침 상태는 그대로 유지된다
  /** 탐색기를 켤 때는 사이드바도 함께 편다. 레일의 탐색기 버튼과 같은 규칙이다 — 켰는데 사이드바가
   *  접혀 있으면 파일 트리가 어디에도 나타나지 않는다.
   *
   *  사이드바의 표시 여부는 sidebarOpen 하나가 정한다. 예전에는 sidebarOpen || explorerOpen 이라
   *  탐색기가 켜져 있는 동안 사이드바 토글이 아무 반응도 없었다 — OR 가 언제나 참이었기 때문이다. */
  /** The side bar's view; the flags the app's effects read (explorerOpen, jobsOpen, hiwOpen) follow it, and it is kept
   *  for the next launch. Whether the side bar shows is the caller's (openActivity shows it, a toggle leaves it). Only owner
   *  actions call it (state/sidebarView.ts): a push or a plan change never moves the view. */
  const showActivity = (id: ActivityId): void => {
    activityRef.current = id
    setActivity(id)
    setExplorerOpen(id === 'explorer')
    setJobsOpen(id === 'plans')
    setHiwOpen(id === 'history')
    storageWrite(ACTIVITY_STORAGE_KEY, id)
  }
  /** The old sidebar views' keys: open the view, or go back to Agents from it. Runs from the keydown listener, which
   *  closes over the first render: hence activityRef. */
  const toggleSidebar = (view: 'explorer' | 'jobs' | 'understanding' | 'sessions'): void => {
    const target: ActivityId = view === 'explorer' ? 'explorer' : view === 'jobs' ? 'plans' : view === 'understanding' ? 'history' : 'agents'
    showActivity(nextActivity(activityRef.current, { kind: 'toggle', activity: target }))
  }
  /** Shows the explorer whatever was showing: a folder link's reveal needs it open, never toggled shut. */
  const showExplorer = (): void => openActivity('explorer')
  const toggleSessions = (): void => toggleSidebar('sessions')
  const toggleExplorer = (): void => toggleSidebar('explorer')
  const toggleJobs = (): void => toggleSidebar('jobs')
  const toggleHiw = (): void => toggleSidebar('understanding')

  // A setState updater can be invoked twice under StrictMode (in development), so setActivePaneId and
  // createGroup are never called inside the setLayout callback — the current values are read from refs
  // to compute the next ones, then setLayout and setActivePaneId are each called once.
  const closeSession = (id: string): void => {
    recordSessionClosed(id, true) // T13: Recently closed can resume it from its transcript
    // State cleanup runs synchronously first — with no await boundary there is no stale closure
    sessionBus.discard(id)
    const rest = sessionsRef.current.filter((s) => s.id !== id)
    setSessions(rest)
    const cur = layoutRef.current
    if (cur) {
      // The session's mirror tab goes with it (fix round 1): left behind, it would name a gone session.
      const next = removeAppTab(removeTab(cur, sessionTab(id)), id)
      if (next) {
        // If the active group is gone, focus moves to the first remaining group
        const p = activePaneIdRef.current
        setActivePaneId(p && leafOf(next, p) ? p : firstLeaf(next).id)
        setLayout(next)
      } else {
        // Under invariant 1, null means "not a single tab is left in the tree" — that is, there are no
        // sessions. The old model had "sessions outside a pane" and needed a fallback group.
        setActivePaneId(null)
        setLayout(null)
      }
    }
    // kill is best-effort in the background — the tab cleanup is already done even if it fails (the same trade-off as before)
    void window.api.sessions.kill(id).catch(() => {})
  }

  /** Splits the active group and moves tabId into the new one. Past the cap, only a toast.
   *  The tab id goes straight to the tree, so a file tab splits exactly as a session tab does. */
  const splitActive = (dir: PaneDir, placeBefore: boolean, tabId: string): void => {
    const cur = layoutRef.current
    if (!cur) {
      const g = createGroup(tabId)
      setLayout(g)
      setActivePaneId(g.id)
      return
    }
    if (countLeaves(cur) >= MAX_PANES) {
      toast.info(t('session.pane.maxReached'))
      return
    }
    const target = (activePaneIdRef.current && leafOf(cur, activePaneIdRef.current)) || firstLeaf(cur)
    const res = splitAndMove(cur, tabId, target.id, dir, placeBefore)
    // null means the group had only one tab — splitting would change nothing. Not a failure, so no toast either
    if (!res) return
    setLayout(res.root)
    setActivePaneId(res.paneId)
  }
  // A ref so onKey (useEffect([])) can call the latest splitActive without a stale closure
  const splitActiveRef = useRef(splitActive)
  splitActiveRef.current = splitActive

  /** A drop aimed at a specific group's body (coming from PaneGrid). The tab id arrives as it is and goes
   *  straight to the tree, so which kind it is does not matter here.
   *  An edge means Split and Move; the centre means Move To Group. */
  const dropOnPane = (paneId: string, zone: DropZone, tabId: string): void => {
    const cur = layoutRef.current
    if (!cur) return
    if (zone === 'center') {
      // Already in that group means nothing happens — moving onto itself is meaningless rather than a failure
      if (groupOfTab(cur, tabId)?.id === paneId) {
        setActivePaneId(paneId)
        return
      }
      const next = moveTab(cur, tabId, paneId)
      if (!next) return
      setLayout(next)
      setActivePaneId(paneId)
      return
    }
    if (countLeaves(cur) >= MAX_PANES) {
      toast.info(t('session.pane.maxReached'))
      return
    }
    const dir: PaneDir = zone === 'left' || zone === 'right' ? 'row' : 'col'
    const before = zone === 'left' || zone === 'up'
    const res = splitAndMove(cur, tabId, paneId, dir, before)
    if (!res) return
    setLayout(res.root)
    setActivePaneId(res.paneId)
  }

  // Either CLI is enough to work with the app — someone who only uses Codex has no reason to install
  // Claude Code. Which of the two an individual session needs depends on its account's provider, and
  // that call belongs to the new-session dialog, which knows the account.
  //
  // Installation, not runnability. This used to read `cli` (a `--version` run in the app's own working
  // directory), which made a CLI that a toolchain manager refuses to run *there* look like a CLI that
  // is not on the machine: the + button went dead and no folder could be picked to prove otherwise.
  // That is the same mistake the new-session dialog's Start gate was caught making, one screen up.
  const anyCliInstalled = cliInstalled?.claude === true || cliInstalled?.codex === true

  /** A group's + button — moves the active group there first so the new session becomes that group's tab.
   *  spawn's placement reads activePaneIdRef, so this one line is enough. */
  // ... or a paired Runtime to start one on: a controller with no CLI of its own still starts remote sessions. Read at
  // the call: the paired list is state declared further down.
  const canStart = (): boolean => canStartSession({ cliInstalled: anyCliInstalled, pairedRuntimes: pairedRuntimes.length })
  const newInGroup = (paneId: string): void => {
    setActivePaneId(paneId)
    if (canStart()) setShowNew(true)
    else toast.error(tRef.current('cliBanner.cannotStart')) // T29: say why instead of doing nothing
  }

  /** A drop on the tab bar — reorder within the same group, or move to that position in another group */
  const dropTabInGroup = (paneId: string, tabId: string, insertBefore: number): void => {
    const cur = layoutRef.current
    if (!cur) return
    const next = moveTab(cur, tabId, paneId, insertBefore)
    if (!next) return
    setActivePaneId(paneId)
    setLayout(next)
  }

  /** Removes that group and merges its tabs into a sibling (IntelliJ's Unsplit). Sessions are not killed.
   *  As with closeSession, it computes from refs without side effects and then calls the two setStates separately. */
  const unsplitPane = (paneId: string): void => {
    const cur = layoutRef.current
    if (!cur) return
    // The group is captured before it is removed — once gone, g.activeTabId is the only way to
    // trace where its tabs were absorbed
    const g = leafOf(cur, paneId)
    const next = unsplit(cur, paneId)
    if (next === cur) return // unsplit — there is no sibling to merge into
    // firstLeaf(next) is the first group of the *whole* tree — unlike closeSession (where the vanished
    // group itself is gone and any group will do), here we have to land on the sibling that absorbed
    // g's tabs. Otherwise, unsplitting G1 in G0 | (G1 / G2) bounces focus to G0 on the left instead of
    // to G2, which absorbed them.
    setActivePaneId((g && groupOfTab(next, g.activeTabId)?.id) ?? firstLeaf(next).id)
    setLayout(next)
  }

  const restart = (old: SessionInfo): void => {
    // A restarted session inherits the tab position the old one held — it neither steals the active
    // group nor leaves a tab pointing at a dead session id
    setSessions((prev) => prev.filter((s) => s.id !== old.id))
    // Task 7 review carry-over: without `kind`, a restarted chat session spawned as a plain terminal
    // one instead — `spawn`'s default. `resumeThreadId` is the thread to pick the conversation back
    // up on; it is omitted (not sent as undefined-but-present) for a session that never reached
    // `ready` and so never got one, the same as any other resume path in this file.
    // T1: the old chain goes with it (main moves the start off a full account, sessions.spawn)
    void spawn({
      ...chainOf(old.accountId, old.rollAccountIds),
      cwd: old.cwd,
      saveDefault: false,
      slackNotify: old.slackNotify,
      bypassPermissions: old.bypassPermissions,
      replacesSessionId: old.id,
      kind: old.kind,
      ...(sessionKindOf(old) === 'chat' && old.threadId !== undefined ? { resumeThreadId: old.threadId } : {})
    })
  }

  const resumeFromHistory = (
    entry: HistoryEntry,
    cwd: string,
    opts: {
      accountIds: string[]
      // Optional (rather than mirroring ResumeDialog's own required onConfirm field) so this keeps
      // typechecking as HistoryBrowser's own onResume prop — untouched by this task — is still declared
      // without it; the dialog always sends one in practice.
      kind?: SessionKind
      roll: boolean
      rollPrompt?: string
      slackNotify: boolean
      bypassPermissions: boolean
      schedule?: ScheduleConfig
    }
  ): void => {
    void spawn({
      // Resume under the selected account — the original account resumes as-is, a different one has the
      // transcript copied by ipc. With rolling on, the chain the modal computed follows [0].
      accountIds: opts.accountIds,
      cwd,
      saveDefault: false,
      kind: opts.kind,
      // The file goes with either kind: resuming under another account copies it into that account's
      // folder first, and the CLI reads the conversation from there whichever way it is driven
      // (spec §8.4). Only the name of the conversation differs — a chat resume gives the protocol
      // thread id the history entry carries as sessionId (chat-sessions design §6.5), a terminal one
      // the pty session id.
      resumeTranscriptPath: entry.filePath,
      ...(opts.kind === 'chat'
        ? { resumeThreadId: entry.sessionId }
        : { resumeSessionId: entry.sessionId }),
      roll: opts.roll,
      rollPrompt: opts.rollPrompt,
      slackNotify: opts.slackNotify,
      bypassPermissions: opts.bypassPermissions,
      schedule: opts.schedule
    })
  }

  // 마지막으로 활성이었던 세션. 그 세션이 이미 닫혔으면 find가 못 찾아 null이 되므로 별도의 청소가 없다
  const active = sessions.find((s) => s.id === (activeSessionId ?? lastSessionIdRef.current)) ?? null
  useEffect(() => setActiveSession(active), [active]) // for the accounts popover's "Use for this tab"
  const runningCount = sessions.filter((s) => s.status === 'running').length
  runningCountRef.current = runningCount // the toast's install button has to see the value at click time
  // A check round trip is around 350ms, so watching only the real state would make 'Checking…' invisible
  const updateChecking = showChecking(update?.state, checkClickedAt, Date.now())

  const dirtyIds = new Set(
    fileTabs.filter((t) => { const b = fileBuffers[t.id]; return b && !b.readOnly && b.content !== b.savedContent }).map((t) => t.id)
  )
  return {
    terminals, setTerminals, bottomTab, setBottomTab, pairedRuntimes, setPairedRuntimes, bottomRootRef,
    isMarkdownPath, openWorkspaceSlotRef, ownerPickRef, shownLayoutRef, closeAgentTabRef, currentProjectRef, spawn, openFile, openLinkedPath,
    openProjectFile, retireEditorState, setBufferContent, saveFile, reloadBufferFromDisk, dropTabFromTree,
    openRemoteSession, selectWorkbenchTab, closeWorkbenchTab, handlePathRenamed, handlePathDeleted, closeExplorer,
    showActivity, toggleSidebar, showExplorer, toggleSessions, toggleExplorer, toggleJobs, toggleHiw, dropOnPane, canStart,
    newInGroup, dropTabInGroup, unsplitPane, restart, resumeFromHistory, active, runningCount, updateChecking,
    dirtyIds
  }
}
