// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useEffect, useRef, useState } from 'react'
import type { RollStateEvent, SchedStateEvent, SessionUsage, InstallOutcome } from '../../../core/types'
import { type BrowserTab, type FileTab, type RecordTab } from '../components/WorkbenchTabs'
import type { AgentPointerState } from '../components/agentOverlay'
import type { EditorView } from '@codemirror/view'
import { EditorStateCache } from '../lib/editorStateCache'
import { type Mirrors } from '../lib/workspaceMirror'
import { mirrorFrames } from '../lib/mirrorFrames'
import { type ExplorerTreeState } from '../components/FileExplorer'
import { dropKeys } from '../lib/dropKeys'
import { forgetDrafts } from '../components/conversation/drafts'
import type { OpenSessionTask } from '../../../core/types'
// core/types.ts imports this for UnderstandingApi but does not re-export it (unlike the block above),
// so it comes from its own module — the same import UnderstandingView.tsx uses.
import type { ProjectUnderstanding } from '../../../core/understanding/types'
import { installOutcomeNotice } from '../../../core/update/manualInstallNotice'
import { type Eol } from '../../../core/files/edit'
import { isMdViewMode, type MdViewMode } from '../../../core/files/markdownView'
import type { UndoEntry } from '../../../core/files/undo'
import { dismiss, toast } from '../lib/toast'
import { confirmModal } from '../lib/confirm'
import { updateConfirmBody } from '../lib/quitConfirm'
import { leaves, type PaneDir } from '../../../core/panes/tree'
import type { useLayout } from './useLayout'
import type { useHost } from './useHost'
import type { useSettings } from './useSettings'
import { openSettings } from '../components/shell/navigation'

/** Whether this renderer has shown the astera command offer (see where it is used). Module scope,
 *  not a ref: StrictMode's dev-only remount would reset a ref and show a second toast. */
let cliOfferedThisRun = false
/** Whether this renderer has asked about the user Path repair at start, for the same StrictMode reason. */
let cliPathRepairAskedThisRun = false
export interface FileBuffer {
  /** 항상 LF다. CodeMirror가 문서를 LF로 정규화하므로 버퍼도 같은 모양이어야 에디터 상태와 비교되고
   *  재사용된다. 디스크의 줄바꿈은 eol에 따로 들고 있다가 쓸 때 되돌린다 */
  content: string
  savedContent: string
  /** 이 파일이 디스크에서 쓰는 줄바꿈. 저장할 때 되돌려 주지 않으면 CRLF 파일이 첫 저장에 LF로 바뀌고
   *  git에는 전 줄이 변경으로 잡힌다 */
  eol: Eol
  readOnly: boolean
  loading: boolean
  error: string | null
  conflict: boolean
}

export type WorkbenchStateDeps = Pick<ReturnType<typeof useLayout>,
    'accounts' | 'activeFileId' | 'activeTab' | 'activeTabId' | 'layout' | 'remoteSessions' | 'sessions' |
    'setRemoteStatus' | 't'> &
  Pick<ReturnType<typeof useHost>,
    'cli' | 'showNew'> &
  Pick<ReturnType<typeof useSettings>,
    'showSettings'>

export function useWorkbenchState(deps: WorkbenchStateDeps) {
  const {
    accounts, activeFileId, activeTab, activeTabId, cli, layout, remoteSessions, sessions, setRemoteStatus,
    showNew, showSettings, t
  } = deps
  // Whether the Jobs sidebar view is showing — same convention as explorerOpen (toggleJobs mirrors
  // toggleExplorer below), just for the read-only orchestration view instead of the file tree.
  const [jobsOpen, setJobsOpen] = useState(false)
  // Read by toggleJobs for the same reason explorerOpenRef exists: the keydown listener is registered
  // once with [] and closes over the first render, so a toggle that reads the render value would always
  // compute the same direction from the keyboard.
  const jobsOpenRef = useRef(jobsOpen)
  jobsOpenRef.current = jobsOpen
  // Whether the How It Works sidebar view is showing — same convention as jobsOpen (toggleHiw mirrors
  // toggleJobs below), unlike Jobs there is no feature flag gating it off the rail.
  const [hiwOpen, setHiwOpen] = useState(false)
  const hiwOpenRef = useRef(hiwOpen) // see jobsOpenRef
  hiwOpenRef.current = hiwOpen
  // The current project's understanding, loaded by the effect near currentProject below (it cannot sit
  // here — that effect depends on currentProject, declared much later, and a dependency array is
  // evaluated during render, so it would throw a TDZ ReferenceError this early). null covers both "no
  // project" and "never analyzed" — UnderstandingView draws the same empty state for either.
  //
  // **The root rides along with it.** The cache holds only one project's data, so the data alone
  // cannot say which project it belongs to. Without the root, every place that needs to ask "is this
  // the right project?" would ask the proxy question `rec.projectRoot !== currentProject` instead —
  // which only compares a tab record against the current project, not the cache itself. Between
  // switching projects and the IPC round trip finishing, the two are out of sync, and in that window
  // two projects sharing the same record id would attach A's status and A's explanation to B's tab.
  // With the root sitting here, the consumers below can ask directly instead of through that proxy.
  /** 이해를 다시 읽게 하는 신호. 분석이 끝났을 때 올린다 — 아래 effect 는 프로젝트가 바뀔
   *  때만 도는데, 분석은 프로젝트를 바꾸지 않으면서 그 값을 바꾼다. */
  const [understandingSeq, setUnderstandingSeq] = useState(0)
  const [understanding, setUnderstanding] = useState<{
    root: string
    data: ProjectUnderstanding | null
  } | null>(null)
  /** How It Works screen's open-task section — same shape as `understanding` just above, right down
   *  to why the root rides along with it (that comment applies here unchanged) and why a second
   *  sequence number exists (a completed/cancelled task's own IPC call does not change
   *  `currentProject`, so the loading effect would never re-run without one). */
  const [sessionTasksSeq, setSessionTasksSeq] = useState(0)
  const [openTasks, setOpenTasks] = useState<{ root: string; data: OpenSessionTask[] } | null>(null)
  const [isMax, setIsMax] = useState(false)
  const [usage, setUsage] = useState<SessionUsage | null>(null)
  const [rollStates, setRollStates] = useState<Record<string, RollStateEvent>>({})
  const [schedStates, setSchedStates] = useState<Record<string, SchedStateEvent>>({}) // the schedule banner
  const [busy, setBusy] = useState<Record<string, boolean>>({}) // whether each session is working — the tab spinner
  // A session that went takes its marks with it (performance audit, renderer): the working mark, the roll and schedule
  // banners and the composer draft were kept for every session the app ever showed. Only ids that were in the list and
  // left it: a mark can arrive for a new session before the list names it.
  const shownSessionIds = useRef<ReadonlySet<string>>(new Set())
  // W9-A: declared here, ahead of where App's body had them, because effects and handlers in this hook
  // (or an earlier one) read them; they are state and refs, so moving them up changes nothing that runs.
  const [mirrors, setMirrors] = useState<Mirrors>({})
  const mirrorsRef = useRef<Mirrors>({})
  useEffect(() => {
    const now = new Set(sessions.map((s) => s.id))
    const gone = new Set([...shownSessionIds.current].filter((id) => !now.has(id)))
    shownSessionIds.current = now
    if (gone.size === 0) return
    setBusy((p) => dropKeys(p, gone))
    setRollStates((p) => dropKeys(p, gone))
    setSchedStates((p) => dropKeys(p, gone))
    forgetDrafts(gone)
    // Their workspace mirrors and pictures too (second pass R2-2: kept for every session that ever opened one).
    const mirrorsLeft = dropKeys(mirrorsRef.current, gone)
    if (mirrorsLeft !== mirrorsRef.current) {
      mirrorsRef.current = mirrorsLeft
      setMirrors(mirrorsLeft)
    }
    mirrorFrames.drop(gone)
  }, [sessions])
  const shownRemoteKeys = useRef<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const now = new Set(remoteSessions.map((r) => r.key))
    const gone = new Set([...shownRemoteKeys.current].filter((k) => !now.has(k)))
    shownRemoteKeys.current = now
    if (gone.size > 0) setRemoteStatus((p) => dropKeys(p, gone))
  }, [remoteSessions])
  // Every session whose roll-state / schedule push listener has decided banner state at least once. A
  // seed reply is dropped for a session already in the set: an invoke reply and a push have no order
  // between them, so a push — including an 'off'/'none' that removed the banner — is always the fresher
  // fact. This replaces the old "already in state" presence guard, which could not tell a removal from a
  // never-seeded session and so let a just-disabled banner be re-seeded. A push that decides nothing is
  // not recorded: 'stalled' is a toast and leaves the banner alone, so marking it heard would drop a
  // seed that is still the only thing that knows what the banner should say.
  const heardRollRef = useRef<Set<string>>(new Set())
  const heardSchedRef = useRef<Set<string>>(new Set())
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]) // file viewer tabs
  // How It Works record detail tabs. Kept in a separate list for the same reason as file tabs — a
  // `record:<id>` tab id carries neither the project nor the title, so this tab could not be drawn,
  // and this tab's project could not be answered, from the tree string alone (see RecordTab's comment
  // in WorkbenchTabs.tsx).
  const [recordTabs, setRecordTabs] = useState<RecordTab[]>([])
  /** Media tab id → reload nonce (openMedia bumps it when a link names an already-open file) */
  const [mediaNonces, setMediaNonces] = useState<Record<string, number>>({})
  /** Preview (browser) tabs. Renderer-only, like fileTabs; the page state lives in the mounted webview */
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([])
  const browserTabsRef = useRef(browserTabs)
  browserTabsRef.current = browserTabs
  /** Browser tab id → loading. Chip state, not tab identity */
  const [browserLoading, setBrowserLoading] = useState<Record<string, boolean>>({})
  /** Sessions whose agent tab has a script running — the chip's ring. Keyed by session id. */
  const [agentBusy, setAgentBusy] = useState<Record<string, boolean>>({})
  /** The agent's last acted point per session, for BrowserPane's pointer. `seq` increments per event
   *  so a repeat at the same point still animates. Cleared when the session's next run starts: the
   *  point kept from the last run belongs to a page that may be gone, and a helper that outlived a
   *  Stop can add one after the run ended. */
  const [agentPointer, setAgentPointer] = useState<Record<string, AgentPointerState>>({})
  /** Browser tab id → how many times openBrowserTab reused it. BrowserPane reloads when it changes */
  const [browserNonce, setBrowserNonce] = useState<Record<string, number>>({})
  // The flow step picked on a record tab. Keyed by scopeKey — project and record together, because a
  // tab id (`record:<recordId>`) has no project in it, and keying on that alone would let two
  // projects sharing a record id leak each other's scoping. The tab record already has both, so this
  // costs nothing extra.
  // Cleared when its tab closes (closeWorkbenchTab) — left alone it would grow for the life of the
  // session, and reopening a closed tab would resurrect a scope the user never set.
  const [scopedNode, setScopedNode] = useState<Record<string, string | null>>({})
  const [fileBuffers, setFileBuffers] = useState<Record<string, FileBuffer>>({}) // file buffers — editing, saving, external changes
  /** Per file tab, the line a console link asked to see (Task: run console). Consumed once by
   *  FileEditor; dropped when the user clicks or edits in that tab first, or when the tab closes. */
  const [pendingReveal, setPendingReveal] = useState<Record<string, { line: number; col?: number; nonce: number }>>({})
  const revealNonceRef = useRef(0)
  const requestReveal = (tabId: string, at: { line: number; col?: number }): void => {
    revealNonceRef.current += 1
    setPendingReveal((prev) => ({ ...prev, [tabId]: { ...at, nonce: revealNonceRef.current } }))
  }
  const dropReveal = (tabId: string): void =>
    setPendingReveal((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  /** 파일 탭별 마크다운 뷰 모드. fileTabs·fileBuffers 와 같은 자리에 두는 이유는 탭이 닫힐 때
   *  함께 지워져야 하기 때문이다. 마지막으로 고른 모드는 localStorage 에 남아 새로 여는 .md 탭의
   *  기본값이 된다 — cm.sidebarWidth 와 같은 관례다 */
  const [mdModes, setMdModes] = useState<Record<string, MdViewMode>>({})
  const mdModesRef = useRef(mdModes)
  mdModesRef.current = mdModes
  /** 페인별 EditorView — 파일 탭별이 아니다. FileEditor 는 페인 하나당 하나이고 그 페인 안에서
   *  파일이 바뀌어도(같은 마크다운 파일 사이든, 마크다운·비-마크다운 사이든) 재사용되며, onViewChange
   *  는 그 인스턴스의 마운트·언마운트에서만 불린다 — 파일 탭 id 로 저장했다면 한 페인에서 두 번째로
   *  여는 마크다운 파일은 영원히 null 을 받았을 것이다(뷰는 그대로인데 map 의 키만 새 파일 것이길
   *  기다리므로). 뷰가 생기는 시점은 FileEditor 의 마운트라 ref 로는 렌더가 다시 돌지 않는다 —
   *  그래서 상태다. */
  const [mdViews, setMdViews] = useState<Record<string, EditorView | null>>({})
  // 죽은 페인의 항목을 지운다 — PaneGrid 의 lastFileOfPane 이 자기 것을 정리하는 것과 같은 이유
  // (그 파일의 주석 참고)다. FileEditor 의 언마운트가 이미 onViewChange(null) 을 부르므로 이 정리가
  // 없어도 죽은 참조가 남지는 않지만(destroy() 된 EditorView 를 계속 붙잡지는 않는다), 다시 쓰이지
  // 않을 페인 id 키가 사라진 페인마다 하나씩 map 에 영원히 쌓이는 것은 그것과는 별개의 문제라 이
  // effect 로 정리한다.
  useEffect(() => {
    const livePanes = new Set(layout ? leaves(layout).map((l) => l.id) : [])
    setMdViews((prev) => {
      let changed = false
      const next: Record<string, EditorView | null> = {}
      for (const [paneId, view] of Object.entries(prev)) {
        if (livePanes.has(paneId)) next[paneId] = view
        else changed = true
      }
      return changed ? next : prev
    })
  }, [layout])
  // W9-B: the sidebar's width (cm.sidebarWidth) went with the sidebar (DESIGN.md §13)

  // A reference to the latest value for keyboard tab switching — the global listener registers once and reads without going stale
  // (sessionsRef is declared with its state above: it moves with every write, not here at render)
  const activeFileIdRef = useRef(activeFileId)
  activeFileIdRef.current = activeFileId
  const MD_MODE_KEY = 'cm.md.viewMode'
  const defaultMdMode = (): MdViewMode => {
    const stored = localStorage.getItem(MD_MODE_KEY)
    return isMdViewMode(stored) ? stored : 'split'
  }
  const setMdMode = (tabId: string, mode: MdViewMode): void => {
    localStorage.setItem(MD_MODE_KEY, mode)
    setMdModes((prev) => ({ ...prev, [tabId]: mode }))
  }
  const modalOpenRef = useRef(false)
  modalOpenRef.current = showNew || showSettings
  const fileTabsRef = useRef(fileTabs)
  fileTabsRef.current = fileTabs
  // 탭 순환이 쓰는 것 — 클릭과 같은 경로를 타야 종류에 상관없이 같은 일이 일어난다
  const selectWorkbenchTabRef = useRef<(tabId: string) => void>(() => {})
  /** The id of the tab Ctrl+W may close. **Sessions are excluded** — that key must not kill a
   *  process. Files and records are both lightweight, read-only tabs that open and close freely, so
   *  both belong here. Browser tabs too — closing one closes a page, not a process. */
  const closableTabIdRef = useRef<string | null>(null)
  // 탭 트리에서 파생시킨다 — activeFileId 와 같은 이유다: 따로 상태를 두면 다른 페인의 탭을
  // 누르는 순간 트리와 갈라진다
  closableTabIdRef.current =
    activeTab?.kind === 'file' || activeTab?.kind === 'record' || activeTab?.kind === 'browser' || activeTab?.kind === 'app' || activeTab?.kind === 'media'
      ? activeTabId
      : null
  /** The close function itself. `closeWorkbenchTab` is recreated every render and its body reads
   *  render-time values (via closeFileTab), so a key listener registered once that called a captured
   *  stale closure would act on outdated tabs — same place, same reason as selectWorkbenchTabRef. */
  const closeWorkbenchTabRef = useRef<(tabId: string) => void>(() => {})
  // The run shortcuts (Task 9). Same reason as the two refs above: the keydown effect is registered
  // once with no dependencies, so it would otherwise close over the first render's runStart/runStop/
  // selectedRunId. Assigned once those exist, further down.
  const runStartRef = useRef<() => void>(() => {})
  const runStopSelectionRef = useRef<() => void>(() => {})
  const runRerunSelectedRef = useRef<() => void>(() => {})
  const fileBuffersRef = useRef(fileBuffers) // keeps the external-change handler from going stale
  fileBuffersRef.current = fileBuffers
  // 파일별 에디터 상태 캐시. FileEditor보다 오래 살아야 하므로 여기서 소유한다 (editorStateCache.ts의 주석)
  const editorCacheRef = useRef(new EditorStateCache())
  // onKey is registered once at mount, so values and callbacks recreated on every render are read through refs
  const tRef = useRef(t)
  tRef.current = t

  // The astera command, offered (2026-09-30): while this app holds an account and the command is not
  // installed, a toast says sessions and Jobs can be run from a terminal too, even with the app closed,
  // and opens Settings → CLI, where Install and its PATH checkbox are. **Settled by the person, not
  // by being shown**: the mark is written when they close it or press the button (or the command turns
  // out installed), so a renderer reload right after it appeared does not lose it for good (measured in
  // the dev app). `cliOfferedThisRun` keeps StrictMode's second run from showing a second one.
  useEffect(() => {
    if (accounts.length === 0 || cliOfferedThisRun) return
    const settle = (): void => {
      try {
        localStorage.setItem('cm.cliOffered', '1')
      } catch {
        /* storage refused: it may be offered again, which is the lesser harm */
      }
    }
    try {
      if (localStorage.getItem('cm.cliOffered') === '1') return
    } catch {
      return
    }
    cliOfferedThisRun = true
    void window.api.cli
      .status()
      .then((s) => {
        if (s.installed) return settle()
        const id = toast.info(tRef.current('settings.cli.offer'), {
          onDismiss: settle,
          action: {
            label: tRef.current('settings.cli.offer.open'),
            onClick: () => {
              settle()
              dismiss(id)
              openSettings('integrations', 'cli') // W9-E: the CLI row of Integrations
            }
          }
        })
      })
      .catch(() => {
        cliOfferedThisRun = false
      })
  }, [accounts.length])
  // win32: the start took the astera folder off the user Path because it made that Path too long for
  // new shells (main/userPath.ts takeOffUserPathIfItBreaks). Said once, with the way back in Settings.
  useEffect(() => {
    if (cliPathRepairAskedThisRun) return
    cliPathRepairAskedThisRun = true
    void window.api.cli
      .pathRepairedAtStart()
      .then((removed) => {
        if (!removed) return
        const id = toast.info(tRef.current('settings.cli.pathRepaired.toast'), {
          action: {
            label: tRef.current('settings.cli.offer.open'),
            onClick: () => {
              dismiss(id)
              openSettings('integrations', 'cli') // W9-E: the CLI row of Integrations
            }
          }
        })
      })
      .catch(() => {})
  }, [])
  const cliRef = useRef(cli)
  cliRef.current = cli
  // The install button on the toast is pressed later — it has to see the real number of running sessions at that moment
  const runningCountRef = useRef(0)

  /** Installs the update right away. The app quits immediately, so it asks first when sessions are still running.
   *
   *  What quitting costs is counted, not assumed, for the same reason the close button counts it
   *  (closeWindow above): the Host keeps its own sessions running through the quit, and it takes a
   *  moment to start, so at boot some of the running sessions are the app's own children and some are
   *  not. `updateConfirmBody` turns the two counts into the sentence true of both halves — and, unlike
   *  the close button's, one that stops short of promising the sessions come back, since only the
   *  version being installed knows whether it retires this Host. Nothing kept, on a failure, is the
   *  safe reading here too: it promises the person nothing survives. */
  const installUpdate = async (): Promise<void> => {
    const running = runningCountRef.current
    if (running > 0) {
      const [kept, hostSurvives] = await Promise.all([
        window.api.host.sessionsOutlivingApp().catch(() => 0),
        // Nothing survives, on a failure: the safe reading here is the one that promises least.
        window.api.host.survivesUpdate().catch(() => false)
      ])
      const body = updateConfirmBody(running, kept, hostSurvives)
      const ok = await confirmModal({
        title: tRef.current('update.confirm.title'),
        body: tRef.current(body.key, body.params),
        confirmLabel: tRef.current('update.toast.installNow')
      })
      if (!ok) return
    }

    // **The outcome is read now, because on macOS the app does not always leave.** Squirrel.Mac
    // refuses a build whose signature it cannot match against the running app's, and on an
    // ad-hoc-signed release that refusal is permanent (src/main/manualInstall.ts). Before this,
    // main answered nothing and the renderer waited for a quit that never came: the button was
    // indistinguishable from a dead one. A rejection is folded into the same shape rather than
    // thrown away — an updater that failed to load never registers this handler at all.
    let outcome: InstallOutcome
    try {
      outcome = await window.api.update.install()
    } catch (e) {
      outcome = { mode: 'failed', message: (e as Error)?.message ?? String(e) }
    }
    const notice = installOutcomeNotice(outcome)
    if (!notice) return // the automatic path — the app is already on its way out

    if (outcome.mode === 'failed') {
      await confirmModal({
        title: tRef.current('update.manual.title'),
        body: tRef.current(notice.key, notice.params),
        confirmLabel: tRef.current('common.close')
      })
      return
    }
    // Quitting is confirmed rather than done: the new app is sitting in Finder, and a window that
    // vanished on its own would take the only explanation of what to do next with it.
    const move = await confirmModal({
      title: tRef.current('update.manual.title'),
      body: tRef.current(notice.key, notice.params),
      confirmLabel: tRef.current('update.manual.quit')
    })
    if (move) window.api.app.quit()
  }
  // When Ctrl+\ had no spare session and opened the new-session dialog instead, the split goes in this
  // direction once creation succeeds. Cancelling the dialog discards it, so no empty pane is left.
  const pendingSplitRef = useRef<PaneDir | null>(null)
  // Per-root tree snapshots. Toggling the explorer unmounts FileExplorer, and the tree root is about to
  // follow the active tab, so it will change far more often than it does today — a map keyed by root
  // means each project's expansion comes back with it instead of collapsing on every switch.
  const explorerTreesRef = useRef<Map<string, ExplorerTreeState>>(new Map())
  // The clipboard exists precisely to cross project boundaries, so it is not kept inside the per-root
  // map above — it is its own ref so pasting across projects keeps working.
  const explorerClipboardRef = useRef<ExplorerTreeState['clipboard']>(null)
  // The Ctrl+Z undo journal. It is deliberately not inside ExplorerTreeState — that holds a per-root
  // tree snapshot and is rightly cleared on every root change (the [root] effect in FileExplorer),
  // whereas the journal's lifetime differs (it has to survive an explorer toggle, and is cleared
  // separately on a full close — see closeExplorer below).
  const explorerUndoRef = useRef<UndoEntry[]>([])
  return {
    jobsOpen, setJobsOpen, jobsOpenRef, hiwOpen, setHiwOpen, hiwOpenRef, understandingSeq, setUnderstandingSeq,
    understanding, setUnderstanding, sessionTasksSeq, setSessionTasksSeq, openTasks, setOpenTasks, isMax, setIsMax,
    usage, setUsage, rollStates, setRollStates, schedStates, setSchedStates, busy, setBusy, mirrors, setMirrors,
    mirrorsRef, heardRollRef, heardSchedRef, fileTabs, setFileTabs, recordTabs, setRecordTabs, mediaNonces,
    setMediaNonces, browserTabs, setBrowserTabs, browserTabsRef, browserLoading, setBrowserLoading, agentBusy,
    setAgentBusy, agentPointer, setAgentPointer, browserNonce, setBrowserNonce, scopedNode, setScopedNode,
    fileBuffers, setFileBuffers, pendingReveal, setPendingReveal, requestReveal, dropReveal, mdModes, setMdModes,
    mdModesRef, mdViews, setMdViews, activeFileIdRef, defaultMdMode,
    setMdMode, modalOpenRef, fileTabsRef, selectWorkbenchTabRef, closableTabIdRef, closeWorkbenchTabRef, runStartRef,
    runStopSelectionRef, runRerunSelectedRef, fileBuffersRef, editorCacheRef, tRef, cliRef, runningCountRef,
    installUpdate, pendingSplitRef, explorerTreesRef, explorerClipboardRef, explorerUndoRef
  }
}
