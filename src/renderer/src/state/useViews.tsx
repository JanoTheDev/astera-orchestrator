// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useRef } from 'react'
import { type BrowserTab, type RecordTab } from '../components/WorkbenchTabs'
import { BrowserPane, type BrowserStatePatch } from '../components/BrowserPane'
import { AppMirrorPane } from '../components/AppMirrorPane'
import { FileEditor } from '../components/FileEditor'
import { MarkdownSplit } from '../components/MarkdownSplit'
import { newlyOpened, placeAppTabs, type Mirrors } from '../lib/workspaceMirror'
import { RecordDetailHost } from '../components/RecordDetail'
// core/types.ts imports this for UnderstandingApi but does not re-export it (unlike the block above),
// so it comes from its own module — the same import UnderstandingView.tsx uses.
import type { RecordStatus } from '../../../core/understanding/types'
import * as sessionBus from '../lib/sessionBus'
import { toast } from '../lib/toast'
import { groupOfTab } from '../../../core/panes/tree'
import { browserTab, parseTab, recordTab, sessionTab } from '../../../core/panes/tabId'
import { placeTab } from '../../../core/panes/place'
import { linkDestination, normalizeUrl, previewTargetOf } from '../../../core/preview/url'
import { isWaitingOnDialog, POST_PASTE_SUBMIT_DELAY_MS } from '../../../core/preview/pick/send'
import type { useLayout } from './useLayout'
import type { useWorkbenchState } from './useWorkbenchState'
import type { useWorkbench } from './useWorkbench'
import type { useJobs } from './useJobs'
import type { useSidebar } from './useSidebar'
import type { useSettings } from './useSettings'
import type { useRunPanel } from './useRunPanel'
import { scopeKey } from './appConstants'

export type ViewsDeps = Pick<ReturnType<typeof useLayout>,
    'activePaneId' | 'activePaneIdRef' | 'layout' | 'layoutRef' | 'sessions' | 'setActivePaneId' | 'setLayout' | 't'> &
  Pick<ReturnType<typeof useWorkbenchState>,
    'agentBusy' | 'agentPointer' | 'browserNonce' | 'browserTabs' | 'browserTabsRef' | 'busy' | 'defaultMdMode' |
    'dropReveal' | 'editorCacheRef' | 'fileBuffers' | 'fileTabs' | 'fileTabsRef' | 'hiwOpen' | 'jobsOpen' |
    'mdModes' | 'mdViews' | 'mirrors' | 'mirrorsRef' | 'pendingReveal' | 'recordTabs' | 'scopedNode' |
    'setBrowserLoading' | 'setBrowserNonce' | 'setBrowserTabs' | 'setFileBuffers' | 'setMdMode' | 'setMdViews' |
    'setMirrors' | 'setRecordTabs' | 'setScopedNode' | 'understanding'> &
  Pick<ReturnType<typeof useWorkbench>,
    'closeAgentTabRef' | 'closeWorkbenchTab' | 'currentProjectRef' | 'isMarkdownPath' | 'openFile' |
    'openProjectFile' | 'reloadBufferFromDisk' | 'retireEditorState' | 'saveFile' | 'selectWorkbenchTab' |
    'setBufferContent'> &
  Pick<ReturnType<typeof useJobs>,
    'currentProject'> &
  Pick<ReturnType<typeof useSidebar>,
    'explorerOpen'> &
  Pick<ReturnType<typeof useSettings>,
    'mirrorSizes'> &
  Pick<ReturnType<typeof useRunPanel>,
    'runs'>

export function useViews(deps: ViewsDeps) {
  const {
    activePaneId, activePaneIdRef, agentBusy, agentPointer, browserNonce, browserTabs, browserTabsRef, busy,
    closeAgentTabRef, closeWorkbenchTab, currentProject, currentProjectRef, defaultMdMode, dropReveal,
    editorCacheRef, explorerOpen, fileBuffers, fileTabs, fileTabsRef, hiwOpen, isMarkdownPath, jobsOpen, layout,
    layoutRef, mdModes, mdViews, mirrorSizes, mirrors, mirrorsRef, openFile, openProjectFile, pendingReveal,
    recordTabs, reloadBufferFromDisk, retireEditorState, runs, saveFile, scopedNode, selectWorkbenchTab, sessions,
    setActivePaneId, setBrowserLoading, setBrowserNonce, setBrowserTabs, setBufferContent, setFileBuffers, setLayout,
    setMdMode, setMdViews, setMirrors, setRecordTabs, setScopedNode, t, understanding
  } = deps

  // 탭 줄은 이제 페인마다 있고 그 내용은 트리(leaf.tabIds)가 정한다 — 전역 한 줄과 그 폴백은 사라졌다.
  // 어떤 프로젝트의 세션인지로 거르지도 않는다: 페인에 담긴 것이 곧 그 페인이 보여주는 것이다.

  /** 페인 하나의 에디터 본문. PaneGrid가 페인마다 슬롯을 잡고 그 안에 이것을 그린다.
   *
   *  에디터는 페인당 하나다 — 같은 페인에서 파일 탭을 오갈 때 이 FileEditor가 재사용되고, path만
   *  바뀐다. 되돌리기와 스크롤을 이어 주는 EditorStateCache는 App이 계속 소유하므로 페인이 여럿이어도
   *  캐시는 하나다.
   *
   *  FileEditor는 로딩·오류 중에도 언마운트되면 안 된다 — 언마운트는 EditorView를 destroy하고 되돌리기
   *  이력을 지운다. 그래서 오버레이는 위에 덮을 뿐이고, 활성 탭이 세션으로 바뀔 때도 슬롯이 display로만
   *  숨는다(PaneGrid의 lastFileOfPane). */
  /** paneId 를 쓰는 이유: FileEditor 는 파일 탭이 아니라 페인 하나당 하나이고(위 주석), path 만
   *  바뀌며 그 페인 안에서 재사용된다 — onViewChange 는 그 인스턴스의 마운트·언마운트에서만 불리고
   *  파일이 바뀔 때는 다시 불리지 않는다. 그래서 이 뷰를 파일 탭 id 로 저장하면(예전 코드) 한 페인에서
   *  두 번째로 여는 마크다운 파일은 영원히 null 을 받는다 — 뷰는 첫 파일에서 그대로인데 map 의 키는
   *  새 파일 것이길 기대하기 때문이다. 페인 id 로 저장하면 "이 페인의 지금 뷰"가 항상 맞다.
   */
  const renderEditor = (paneId: string, fileTabId: string, focused: boolean): React.ReactNode => {
    const f = fileTabs.find((t) => t.id === fileTabId)
    const buf = fileBuffers[fileTabId]
    if (!f || !buf) return null
    const editor = (
      <FileEditor
        path={f.path}
        content={buf.content}
        readOnly={buf.readOnly}
        cache={editorCacheRef.current}
        focused={focused}
        onRetire={retireEditorState}
        onViewChange={(view) => setMdViews((prev) => ({ ...prev, [paneId]: view }))}
        // Taken by its path, whatever the pane shows by now (second pass R2-1, final review m1): the editor sends its text
        // a moment after the keys, and reads the text and its path together, so the pair is always one file's.
        onChange={(fromPath, next) => {
          const target = fileTabsRef.current.find((t) => t.path === fromPath)
          if (!target) return
          dropReveal(target.id)
          setBufferContent(target.id, next)
        }}
        onSave={(fromPath) => {
          const target = fileTabsRef.current.find((t) => t.path === fromPath)
          if (target) saveFile(target.id)
        }}
        // Only once the buffer has loaded successfully — a request for a file still being read waits
        // here, and one whose read failed has no content to reveal into
        reveal={buf.loading || buf.error ? undefined : pendingReveal[f.id]}
        onRevealed={() => dropReveal(f.id)}
        onInteract={() => dropReveal(f.id)}
        projectPath={currentProject ?? undefined} // W8-B: the blame gutter
      />
    )
    return (
      <div className="workbench-body">
        <div className="file-editor-wrap">
          {buf.readOnly && !buf.loading && !buf.error && (
            <div className="file-truncated">{t('files.editor.readOnlyReason')}</div>
          )}
          {buf.conflict && (
            <div className="file-conflict">
              {t('files.editor.conflictChanged')}
              <button onClick={() => reloadBufferFromDisk(f.id)}>{t('files.editor.reload')}</button>
              <button onClick={() => setFileBuffers((prev) => (prev[f.id] ? { ...prev, [f.id]: { ...prev[f.id], conflict: false } } : prev))}>{t('files.editor.keepMine')}</button>
            </div>
          )}
          {/* markdown=false 여도 MarkdownSplit 은 항상 렌더된다 — {md ? <MarkdownSplit/> : editor}
              삼항연산자였을 때는 이 자리의 엘리먼트 타입이 파일을 오갈 때마다 MarkdownSplit↔FileEditor
              로 바뀌어, 같은 페인에서 .md 파일과 비-.md 파일 사이를 전환하기만 해도 리액트가 FileEditor
              를 언마운트·재마운트해 되돌리기 이력을 지웠다(MarkdownSplit.tsx 상단 주석 참고). 이제
              이 위치는 항상 <MarkdownSplit> 이고, 툴바·리사이저·프리뷰를 그리는지는 그 컴포넌트 내부의
              markdown 프롭이 결정한다. */}
          <MarkdownSplit
            markdown={isMarkdownPath(f.path)}
            mode={mdModes[f.id] ?? defaultMdMode()}
            onModeChange={(mode) => setMdMode(f.id, mode)}
            text={buf.content}
            docPath={f.path}
            onOpenFile={openProjectFile}
            onSave={() => saveFile(f.id)}
            editor={editor}
            editorView={mdViews[paneId] ?? null}
          />
          {buf.loading && <div className="file-overlay">{t('files.editor.loading')}</div>}
          {!buf.loading && buf.error && <div className="file-overlay">{buf.error}</div>}
        </div>
      </div>
    )
  }

  /** Picked a record from the How It Works sidebar. If it is already open, activates that tab; if
   *  not, opens it as a new tab in the active pane — the two cases are not split here because
   *  placeTab's intoGroup already does "activate it if it's in the tree, don't reinsert it" itself.
   *
   *  **Builds a tab record along with it** — same place, same reason as openFile building a FileTab.
   *  The title and the project are pinned into that record, so moving to another project does not
   *  cost this tab its name or its ×, and clicking it again returns to its own project.
   *
   *  **Why the declaration sits here**: the body reads currentProject. This file has a history of
   *  that reference dying to a TDZ error when declared above that const (see the comment on the two
   *  effects above), so everything that reads it stays below. */
  const openRecordTab = (recordId: string): void => {
    // Only looked up in the current project's understanding. If the project was just switched and the
    // cache is still the previous one, this would pick up A's record and produce a tab whose
    // projectRoot is B alone — a tab no cached understanding would ever draw
    const record =
      understanding?.root === currentProject
        ? understanding.data?.records.find((r) => r.id === recordId)
        : undefined
    // Reached from a sidebar row's click, so in the normal path both exist. Without either this would
    // be a tab with no name and no project, so do nothing — the same choice openFile makes when it
    // has no root
    if (!currentProject || !record) return
    const id = recordTab(recordId)
    const tab: RecordTab = { id, recordId, title: record.request, projectRoot: currentProject }
    // Reopening the same tab id replaces it. `record:<id>` carries no project, so two projects
    // sharing a record id would share one tab — keeping the earlier record would let a tab just
    // opened from B draw A's explanation. The one just pressed wins.
    setRecordTabs((prev) =>
      prev.some((x) => x.id === id) ? prev.map((x) => (x.id === id ? tab : x)) : [...prev, tab]
    )
    const placed = placeTab(layoutRef.current, id, { activePaneId: activePaneIdRef.current })
    setLayout(placed.root)
    if (placed.paneId) setActivePaneId(placed.paneId)
  }

  /** Opens a preview tab on `url` in the current project, or reuses the one already showing it.
   *
   *  Reuse navigates: a second click on the console link after a dev server restart should show a
   *  fresh page, not a second tab and not a dead one. The address is compared normalised (the
   *  preview design, decision 8). `awaitRunId` marks the run whose server the page waits for (§4);
   *  a reuse without one clears it — a manual click must not keep waiting on an old run. */
  const openBrowserTab = (url: string, opts?: { awaitRunId?: string }): void => {
    const root = currentProjectRef.current
    if (!root) return
    const target = normalizeUrl(url)
    if (!target) return
    const existing = browserTabsRef.current.find(
      (b) => b.projectRoot === root && normalizeUrl(b.url) === target
    )
    if (existing) {
      setBrowserTabs((prev) =>
        prev.map((b) => (b.id === existing.id ? { ...b, url: target, awaitRunId: opts?.awaitRunId } : b))
      )
      setBrowserNonce((prev) => ({ ...prev, [existing.id]: (prev[existing.id] ?? 0) + 1 }))
      selectWorkbenchTab(existing.id)
      return
    }
    const id = browserTab(crypto.randomUUID())
    setBrowserTabs((prev) => [...prev, { id, url: target, title: '', projectRoot: root, awaitRunId: opts?.awaitRunId }])
    const placed = placeTab(layoutRef.current, id, { activePaneId: activePaneIdRef.current })
    setLayout(placed.root)
    if (placed.paneId) setActivePaneId(placed.paneId)
  }
  // The run:status subscription (registered once) opens previews through this — same reason as runStartRef
  const openBrowserTabRef = useRef(openBrowserTab)
  openBrowserTabRef.current = openBrowserTab

  /** Main asks for a session's agent tab on its first open(). One per session, found by session; a
   *  request for a session that already has one is a no-op. Placed in the background: the agent
   *  appearing must not take the tab or the focus the user is on. */
  const openAgentTab = (sessionId: string, cwd: string, url: string): void => {
    if (browserTabsRef.current.some((b) => b.agentSessionId === sessionId)) return
    const id = browserTab(crypto.randomUUID())
    setBrowserTabs((prev) => [...prev, { id, url, title: '', projectRoot: cwd, agentSessionId: sessionId }])
    const placed = placeTab(layoutRef.current, id, { activePaneId: activePaneIdRef.current, background: true })
    setLayout(placed.root)
  }
  const openAgentTabRef = useRef(openAgentTab)
  openAgentTabRef.current = openAgentTab
  /** The Host showed workspaces for these sessions: their mirror tabs, placed once and in the
   *  background, the openAgentTab rule (the agent's work must not take the tab the person is on). The
   *  ref moves with the tree (setLayout is write-through), so two workspaces that open before a render
   *  both keep their tab (fix round 1: the second placement overwrote the first). */
  const openAppTabs = (sessionIds: string[]): void => {
    const root = placeAppTabs(layoutRef.current, sessionIds, activePaneIdRef.current)
    if (root === layoutRef.current) return
    setLayout(root)
  }
  const openAppTabsRef = useRef(openAppTabs)
  openAppTabsRef.current = openAppTabs
  const takeMirrors = (next: Mirrors, prev: Mirrors): void => {
    // A frame for an open workspace changes nothing here: it went to mirrorFrames (second pass R2-3).
    if (next === prev) return
    mirrorsRef.current = next
    setMirrors(next)
    const opened = newlyOpened(prev, next)
    if (opened.length > 0) openAppTabsRef.current(opened)
  }
  const closeAgentTab = (sessionId: string): void => {
    const b = browserTabsRef.current.find((x) => x.agentSessionId === sessionId)
    if (b) closeWorkbenchTab(b.id)
  }
  closeAgentTabRef.current = closeAgentTab

  /** The one link rule (core/preview/url.ts): a loopback address opens in a preview tab, anything else
   *  in the system browser, and Ctrl (Cmd on macOS) inverts. Every xterm's URL link and the guest's
   *  popups land here. */
  const openUrl = (url: string, ev?: { ctrlKey: boolean; metaKey: boolean }): void => {
    const modifier = !!ev && (ev.ctrlKey || ev.metaKey)
    if (linkDestination(url, { modifier }) === 'preview') openBrowserTab(previewTargetOf(url))
    else void window.api.system.openExternal(url)
  }
  const openUrlRef = useRef(openUrl)
  openUrlRef.current = openUrl

  /** What BrowserPane reports. Split across the two states so a page title update does not touch the
   *  loading map and vice versa. */
  const onBrowserState = (tabId: string, patch: BrowserStatePatch): void => {
    if (patch.loading !== undefined) {
      const loading = patch.loading
      setBrowserLoading((prev) => (prev[tabId] === loading ? prev : { ...prev, [tabId]: loading }))
    }
    if (patch.url !== undefined || patch.title !== undefined || patch.clearAwait) {
      setBrowserTabs((prev) =>
        prev.map((b) => {
          if (b.id !== tabId) return b
          const next: BrowserTab = { ...b }
          if (patch.url !== undefined) next.url = patch.url
          if (patch.title !== undefined) next.title = patch.title
          if (patch.clearAwait) delete next.awaitRunId
          return next
        })
      )
    }
  }

  /** Asks for one record's explanation to be written again — the sidebar row's and the pane head's
   *  [Write it up again].
   *
   *  **Does not wait.** The result comes back through the store and then 'understanding:changed'
   *  (subscribed below), and until then the row's status simply reads "Writing up". What is caught
   *  here is the IPC call itself being rejected — an out-of-allowlist path, say — swallowing that
   *  would leave a button that does nothing when pressed. */
  const regenerateRecord = (projectRoot: string, recordId: string): void => {
    void window.api.understanding
      .regenerate(projectRoot, recordId)
      .catch((err) =>
        toast.error(
          t('hiw.record.regenerateFailed', { detail: err instanceof Error ? err.message : String(err) })
        )
      )
  }

  /** [완료] on an open-task row — closes it with `source: 'user'`, active or interrupted either way.
   *  The write-up starts on main's side of this call, not before: nothing here creates it directly.
   *  Does not wait for the redraw — 'sessionTasks:changed' (subscribed above) does that once main's
   *  onTasksChanged fires, the same shape as [Write it up again] above.
   *
   *  **`recorded: false` is not an error.** `finish` (collector.ts) drops a unit with no write
   *  evidence or no changed files instead of turning it into a record (spec §12) — the row still
   *  disappears, but silently that reads as a bug: the person pressed a button on a row that had
   *  been waiting for them and it vanished with no explanation. `hiw.open.completeEmpty` says what
   *  happened without reading as a failure, since dropping empty work is the correct outcome. */
  const completeOpenTask = (projectRoot: string, id: string): void => {
    void window.api.sessionTasks
      .complete(projectRoot, id)
      .then((r) => {
        if (!r.recorded) toast.info(t('hiw.open.completeEmpty'))
      })
      .catch((err) =>
        toast.error(
          t('hiw.open.completeFailed', { detail: err instanceof Error ? err.message : String(err) })
        )
      )
  }

  /** [취소] on an open-task row — closes it with nothing written up; the row simply disappears. */
  const cancelOpenTask = (projectRoot: string, id: string): void => {
    void window.api.sessionTasks
      .cancel(projectRoot, id)
      .catch((err) =>
        toast.error(t('hiw.open.cancelFailed', { detail: err instanceof Error ? err.message : String(err) }))
      )
  }

  /** Clicked an implementation reference. Its path is repository-relative (understanding/types.ts),
   *  so it is joined onto the current project into an absolute path and opened through the usual file
   *  tab — putting the source beside the explanation is what this screen is for. The separator
   *  follows the root's own (the same convention as core/files/paths.ts's resolveRelative). */
  const openRecordPath = (relPath: string): void => {
    const root = currentProjectRef.current
    if (!root) return
    const sep = root.includes('\\') ? '\\' : '/'
    // Also filters out `..` — main's assertAllowedPath already resolves paths lexically and rejects
    // an escape from the project today, but this path string will soon come from the model, and
    // filtering before joining is cheaper than after
    const parts = relPath.split(/[/\\]/).filter((p) => p !== '' && p !== '.' && p !== '..')
    if (parts.length === 0) return
    openFile(`${root}${sep}${parts.join(sep)}`)
  }

  /** Record tab id → that record's current status. The tab bar's glyph reads this — status is a live
   *  value, so it is not pinned into the tab record (pinning it would leave the glyph stale after a
   *  fresh regeneration).
   *
   *  **Only entered when the understanding held right now belongs to that tab's project.** A record
   *  id can repeat across projects, so without this check B's tab could pick up A's status. The cache
   *  carries its own root, so this asks it directly — comparing against currentProject instead would
   *  be out of sync between switching projects and the IPC round trip finishing. A tab left out of
   *  this map still draws with a name and no glyph (see the comment on the record slot in PaneGrid) —
   *  better than disappearing.
   *  Same split as dirtyIds: the judgment is made here, the grid only looks it up. */
  const recordStatuses: Record<string, RecordStatus> = {}
  for (const rec of recordTabs) {
    if (!understanding || rec.projectRoot !== understanding.root) continue
    const r = understanding.data?.records.find((x) => x.id === rec.recordId)
    if (r) recordStatuses[rec.id] = r.status
  }

  /** A record tab's body. Same split as renderEditor — the pane grid only claims a slot, App builds
   *  what goes in it.
   *
   *  **Only drawn when the understanding held right now belongs to this tab's project.** A record id
   *  can repeat across projects, so without this check the tab just activated for A could flash B's
   *  still-lingering explanation for one frame. The cache carries its own root, so this asks it
   *  directly (see the comment on the understanding declaration).
   *
   *  **A mismatch draws a reason, not a blank.** In a split view, another project's record tab can be
   *  the active tab of an unfocused pane — its slot still claims its place, and returning null there
   *  would cover the pane body with an unexplained blank that reads as broken. The cache is one per
   *  project, so this state can persist for as long as that pane stays alive (unlike the one frame
   *  during a project switch). No explanation yet just means `explanation` is undefined, and
   *  RecordDetail draws that guidance on its own. */
  const renderRecord = (recordTabId: string): React.ReactNode => {
    const rec = recordTabs.find((x) => x.id === recordTabId)
    if (!rec) return null
    const u = understanding && rec.projectRoot === understanding.root ? understanding.data : null
    const r = u ? u.records.find((x) => x.id === rec.recordId) : undefined
    // Wrapped once in .workbench-body — the same class RecordDetailHost wraps its own body in. The
    // pane slot is a flex box, so without this the guidance would not fill the pane, only as wide as
    // its own text
    if (!u || !r)
      return (
        <div className="workbench-body">
          <div className="hiw-pane hiw-pane-empty">{t('hiw.pane.notInProject')}</div>
        </div>
      )
    // The scoping memory's key — carries the project and the record together (scopeKey's comment)
    const key = scopeKey(rec)
    return (
      <RecordDetailHost
        record={r}
        scopedNodeId={scopedNode[key] ?? null}
        onPickStep={(id) => setScopedNode((m) => ({ ...m, [key]: id }))}
        onOpenPath={openRecordPath}
        onRegenerate={() => regenerateRecord(rec.projectRoot, rec.recordId)}
      />
    )
  }

  /** An app mirror tab's body (AppMirrorPane). The session's title names it; Stop and Close go to the
   *  Host through main. */
  const renderApp = (appTabId: string): React.ReactNode => {
    const ref = parseTab(appTabId)
    if (ref?.kind !== 'app') return null
    const s = sessions.find((x) => x.id === ref.id)
    const fail = (err: unknown): void => {
      toast.error(t('workspace.pane.failed', { detail: err instanceof Error ? err.message : String(err) }))
    }
    return (
      <AppMirrorPane
        sessionTitle={s?.title ?? ref.id}
        mirror={mirrors[ref.id] ?? null}
        onStop={() =>
          void window.api.workspace
            .stop(ref.id)
            .then((stopped) => {
              if (!stopped) toast.info(t('workspace.pane.nothingToStop'))
            })
            .catch(fail)
        }
        onClose={() =>
          void window.api.workspace
            .close(ref.id)
            .then((closed) => {
              if (!closed) toast.info(t('workspace.pane.nothingToClose'))
            })
            .catch(fail)
        }
        sessionId={ref.id}
        sizes={mirrorSizes}
      />
    )
  }
  const appTabInfo = (sessionId: string): { title: string; running: boolean; open: boolean } | null => {
    const s = sessions.find((x) => x.id === sessionId)
    const m = mirrors[sessionId]
    if (!s && !m) return null
    return { title: s?.title ?? sessionId, running: m?.running === true, open: m?.open === true }
  }

  /** A browser tab's body. `serverPending` is derived from this project's runs — the tab's run is
   *  still alive — so the pane knows whether a refused connection means "not up yet" or "gone". */
  const renderBrowser = (browserTabId: string): React.ReactNode => {
    const b = browserTabs.find((x) => x.id === browserTabId)
    if (!b) return null
    const serverPending =
      b.awaitRunId !== undefined && runs.some((r) => r.runId === b.awaitRunId && r.status !== 'exited')
    // Esc cancels the agent only on the tab the user is looking at: the agent's tab is drawn behind
    // other tabs while a script runs, and a key pressed there is theirs.
    const group = layout ? groupOfTab(layout, b.id) : null
    const agentTabFocused = group !== null && group.activeTabId === b.id && group.id === activePaneId
    return (
      <BrowserPane
        tab={b}
        serverPending={serverPending}
        navigateNonce={browserNonce[b.id] ?? 0}
        agentRunning={b.agentSessionId !== undefined && agentBusy[b.agentSessionId] === true}
        agentTabFocused={agentTabFocused}
        pointer={b.agentSessionId !== undefined ? agentPointer[b.agentSessionId] : undefined}
        onState={(patch) => onBrowserState(b.id, patch)}
        onFocusPane={() => {
          const cur = layoutRef.current
          const pane = cur ? groupOfTab(cur, b.id) : null
          if (pane) setActivePaneId(pane.id)
        }}
        onOpenExternal={(url) => void window.api.system.openExternal(url)}
        sessions={sessions
          .filter((s) => s.cwd === b.projectRoot && s.status !== 'exited')
          .map((s) => ({ id: s.id, title: s.title, busy: busy[s.id] === true }))}
        onSendToSession={(sessionId, text) => {
          // A session showing a dialog swallows the paste and answers the dialog with the Enter that
          // follows it, leaving no sign the batch was ever sent. Checked before anything is written.
          const screen = sessionBus.screenOf(sessionId)
          if (screen !== null && isWaitingOnDialog(screen)) return 'waiting'
          // Through the terminal's own paste, never sessions.write — see sessionBus.registerPaste
          if (!sessionBus.pasteInto(sessionId, text)) return 'no-terminal'
          // The paste has to be through the terminal and into the agent's input box before the Enter
          // lands, or the Enter submits an empty prompt.
          window.setTimeout(() => sessionBus.submitInto(sessionId), POST_PASTE_SUBMIT_DELAY_MS)
          selectWorkbenchTab(sessionTab(sessionId))
          return 'sent'
        }}
      />
    )
  }

  // 사이드바에 그릴 뷰 하나 — 네 갈래 삼항보다 이 값 하나가 어느 뷰가 열려 있는지를 더 분명히 읽힌다.
  // 탐색기·Jobs·How It Works는 서로 배타적이다(toggleExplorer/toggleJobs/toggleHiw가 나머지를 끈다).
  //
  // **아래 효과들과 Run 콘솔의 렌더가 이 값을 공유한다.** 그래서 선언이 렌더 본문 끝이 아니라 여기에
  // 있다 — 효과의 의존성 배열은 렌더 중에 평가되므로 선언이 그보다 아래면 TDZ 로 터진다.
  // 세 자리에 `explorerOpen || jobsOpen || hiwOpen` 을 각각 쓰면 사이드바가 실제로 보여주는 것과
  // 어긋날 수 있다.
  const sidebarPane: 'explorer' | 'jobs' | 'understanding' | 'sessions' = explorerOpen
    ? 'explorer'
    : jobsOpen
      ? 'jobs'
      : hiwOpen
        ? 'understanding'
        : 'sessions'
  return {
    renderEditor, openRecordTab, openBrowserTab, openBrowserTabRef, openAgentTabRef, takeMirrors, openUrl,
    openUrlRef, regenerateRecord, completeOpenTask, cancelOpenTask, recordStatuses, renderRecord, renderApp,
    appTabInfo, renderBrowser, sidebarPane
  }
}
