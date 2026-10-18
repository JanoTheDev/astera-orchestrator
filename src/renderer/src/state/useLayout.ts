// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useMemo, useRef, useState } from 'react'
import type { Account, SessionInfo } from '../../../core/types'
import { writeThrough } from '../lib/writeThrough'
import { useI18n } from '../i18n/I18nProvider'
import { leafOf, type PaneNode } from '../../../core/panes/tree'
import { isRemoteSessionKey, parseTab } from '../../../core/panes/tabId'
import { type RemoteFacts, type RemoteSessionRef } from '../lib/remoteSessions'

export function useLayout() {
  const { t, lang, storedLang, systemLang, setLang } = useI18n()
  const [accounts, setAccounts] = useState<Account[]>([])
  // Unregistered config dirs, account-shaped, for history display only. Deliberately a separate state
  // from `accounts`: mixed in, NewSessionDialog would offer them as spawn targets and AccountPanel /
  // AccountSettings would present them as manageable, and every one of those actions fails on a source
  // that cannot authenticate. Only HistoryBrowser and ResumeDialog receive them.
  const [ghostAccounts, setGhostAccounts] = useState<Account[]>([])
  const [sessions, setSessionsState] = useState<SessionInfo[]>([])
  // The session rows are read from this ref the same way the tree is (closeSession, the session:created guard), so
  // they are written through it too: a close during a burst of taken-back sessions once wrote a list made from the old
  // rows over the new ones, and a tab with no row is not drawn (final review of the taken-back tabs fix, minor 1).
  const sessionsRef = useRef(sessions)
  const setSessions = useMemo(() => writeThrough(sessionsRef, setSessionsState), [])
  // The pane layout tree. It replaces the old single split-slot state — up to 4 panes.
  const [layout, setLayoutState] = useState<PaneNode | null>(null)
  const [activePaneId, setActivePaneIdState] = useState<string | null>(null)
  // The tree and the active pane are read from these refs to compute the next ones, and every write goes through
  // writeThrough (lib/writeThrough.ts), which moves the ref before React hears of it: a burst of writes before a
  // render (the Host's sessions taken back after an update) builds on each other instead of overwriting. Nothing
  // moves them at render, where a render that ran ahead of a queued write would have put back the older tree.
  const layoutRef = useRef(layout)
  const activePaneIdRef = useRef(activePaneId)
  const setLayout = useMemo(() => writeThrough(layoutRef, setLayoutState), [])
  const setActivePaneId = useMemo(() => writeThrough(activePaneIdRef, setActivePaneIdState), [])
  // The session whose tab is being dragged (for PaneGrid's drop preview)
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  // Position of the tab context menu
  const [tabMenu, setTabMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)
  // Phase 9b: sessions on paired Runtimes, each in the tab `session:<runtimeId>:<sessionId>` (D1.4). Never in
  // `sessions`: nothing local runs, reads or restarts for them (D1.6), and the explorer never takes their folder
  // (activeTabRoot finds no local session for the key).
  const [remoteSessions, setRemoteSessions] = useState<RemoteSessionRef[]>([])
  /** The Runtime the remote sessions dialog is on, or null while it is closed. */
  const [remoteDialog, setRemoteDialog] = useState<string | null>(null)
  const [remoteStatus, setRemoteStatus] = useState<Record<string, RemoteFacts['status']>>({})
  /** 이름을 고치고 있는 세션 탭. 더블클릭과 우클릭 메뉴가 같은 자리를 연다 */
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  /** 이름 고치기가 끝났다. title 이 null 이면 취소다.
   *
   *  main 이 정규화한 값을 돌려주므로(공백만 남기면 폴더 이름) 화면은 그 값을 받아 적는다. 이름은
   *  탭 라벨이자 Slack 메시지 접두사이자 알림 제목이라, 무엇이 저장됐는지는 main 이 정한다. */
  const endTabRename = (tabId: string, title: string | null): void => {
    setRenamingTabId(null)
    if (title === null) return
    const ref = parseTab(tabId)
    if (ref?.kind !== 'session') return
    void window.api.sessions.rename(ref.id, title).then((next) => {
      if (next === null) return // 그사이 세션이 사라졌다
      setSessions((prev) => prev.map((s) => (s.id === ref.id ? { ...s, title: next } : s)))
    })
  }
  // 지금 보고 있는 탭은 트리가 정한다 — 활성 페인의 활성 탭. 세 종류가 한 트리에 있으므로 별도의
  // activeTabId 상태를 두면 트리와 어긋난다(다른 페인의 탭을 클릭하거나 페인 포커스를 옮기는 순간
  // 갈라진다). 파일 탭 id는 전부터 `file:<path>` 형식이었으므로 파일 관련 코드는 그대로 쓴다
  const activeTabId = (layout && activePaneId ? leafOf(layout, activePaneId)?.activeTabId : null) ?? null
  const activeTab = activeTabId ? parseTab(activeTabId) : null
  /** 활성 탭이 파일일 때만 그 id */
  const activeFileId = activeTab?.kind === 'file' ? activeTabId : null
  const activeSessionId = activeTab?.kind === 'session' ? activeTab.id : null
  /** The active record id when the active tab is a record detail — decides which sidebar row How It
   *  Works keeps lit. Derived from the tab tree for the same reason as activeFileId: a separate piece
   *  of state would drift from the tree the moment another pane's tab is clicked or focus moves. */
  const activeRecordId = activeTab?.kind === 'record' ? activeTab.id : null
  // 활성 탭이 파일일 수 있게 되면서 "지금 보고 있는 것"과 "작업 중인 세션"이 갈라졌다. 세션에 딸린
  // 표시(상태 바, 사용량 폴링)는 마지막으로 활성이었던 세션 탭을 따른다 — 파일을 읽는 동안 상태 바가
  // 비고 컨텍스트·한도 칩이 사라지지 않게. 파일 트리 루트는 여기서 나오지 않고 활성 탭에서 나온다.
  // 렌더 중 갱신은 이 파일의 다른 ref들과 같은 관례이고, 세션이 사라졌는지는 아래 `active`의
  // sessions 조회가 판정하므로 여기서 따로 청소하지 않는다.
  const lastSessionIdRef = useRef<string | null>(null)
  // A remote tab is not a local session: the status bar and usage of the last local one stay as they were (Phase 9b).
  if (activeSessionId && !isRemoteSessionKey(activeSessionId)) lastSessionIdRef.current = activeSessionId
  return {
    t, storedLang, systemLang, setLang, accounts, setAccounts, ghostAccounts, setGhostAccounts, sessions,
    sessionsRef, setSessions, layout, activePaneId, layoutRef, activePaneIdRef, setLayout, setActivePaneId,
    dragTabId, setDragTabId, tabMenu, setTabMenu, remoteSessions, setRemoteSessions, remoteDialog, setRemoteDialog,
    remoteStatus, setRemoteStatus, renamingTabId, setRenamingTabId, endTabRename, activeTabId, activeTab,
    activeFileId, activeSessionId, activeRecordId, lastSessionIdRef
  }
}
