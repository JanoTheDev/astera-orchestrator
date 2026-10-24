// Moved out of App.tsx unchanged (W9-A): App calls this hook and passes its result on.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Account, HostDriverReport } from '../../../core/types'
import { createReplyGate } from '../lib/replyGate'
import { LOCAL, isRemoteRuntime, remoteDetailKey } from '../lib/remoteJobs'
import { openRunCheck, pendingAfterOpen, pendingRunStep } from './planSelection'
import { localDoor, remoteDoor, type OrchDoor } from '../lib/orchDoor'
import { pauseRun, restartCoordinator as restartRunCoordinator, resumeRun, type ActionUi } from '../lib/jobActions'
// W3-B command bar and voice
import { approvePlan } from '../lib/jobActions'
import { jobName } from '../lib/jobName'
import type {
  OrchHostGate,
  OrchSnapshot,
  // 컴포넌트 이름과 겹친다 — 이 창이 그리는 값의 타입이고, 그리는 것은 위의 RunDetail 이다
  RunDetail as RunDetailData
} from '../../../core/types'
import { findRun, runDetailKey } from '../../../core/orchestration/snapshot'
import * as sticky from '../lib/stickyProject'
import { toast } from '../lib/toast'
import { confirmModal, confirmModalWithChoices } from '../lib/confirm'
import * as hiddenProjects from '../lib/hiddenProjects'
import { replaceTabId } from '../../../core/panes/tree'
import { sessionTab } from '../../../core/panes/tabId'
import { followAction, remoteCall, type RemoteSessionRef } from '../lib/remoteSessions'
import { useRemoteSessionWatch } from '../hooks/useRemoteSessionWatch'
import { folderLinkAction, type FolderReveal } from '../lib/folderLink'
import { errText } from '../hooks/useFileOps'
import type { useLayout } from './useLayout'
import type { useWorkbenchState } from './useWorkbenchState'
import type { useWorkbench } from './useWorkbench'
import type { useRunPanel } from './useRunPanel'
import type { useHost } from './useHost'
/** 저널이 바빠 상세가 마지막으로 읽은 줄을 받았을 때, 다시 묻기까지 기다리는 시간(stage 3 T1) */
const DETAIL_BUSY_RETRY_MS = 2_000

/** The selection after the probe of `probed` failed with `err`: dropped when that folder is gone and still selected. */
export const scopeAfterProbe = (current: string | null, probed: string, err: unknown): string | null =>
  current === probed && errText(err).includes('ENOENT') ? null : current

/** The top bar's selection once the folder `droppedRoot` is gone: a selection on that folder moves to the project the
 *  app falls back to (`fallbackRoot`, the active tab's folder), or to All projects (null) when that is no project. Others stay. */
export function selectionAfterDrop(
  selectedId: string | null, tree: ReadonlyArray<{ id: string; path: string }>, droppedRoot: string | null, fallbackRoot: string | null
): string | null {
  if (!droppedRoot || tree.find((r) => r.id === selectedId)?.path !== droppedRoot) return selectedId
  if (!fallbackRoot || fallbackRoot === droppedRoot) return null
  return tree.find((r) => r.path === fallbackRoot)?.id ?? null
}

export type JobsDeps = Pick<ReturnType<typeof useLayout>,
    'activeTab' | 'activeTabId' | 'remoteSessions' | 'sessions' | 'setLayout' | 'setRemoteSessions' |
    'setRemoteStatus' | 't'> &
  Pick<ReturnType<typeof useWorkbenchState>,
    'browserTabs' | 'fileTabs' | 'modalOpenRef' | 'recordTabs'> &
  Pick<ReturnType<typeof useWorkbench>,
    'currentProjectRef' | 'dropTabFromTree' | 'pairedRuntimes' | 'setPairedRuntimes' | 'showExplorer'> &
  Pick<ReturnType<typeof useRunPanel>,
    'managerFor'> &
  Pick<ReturnType<typeof useHost>,
    'showNew'>

export function useJobs(deps: JobsDeps) {
  const {
    activeTab, activeTabId, browserTabs, currentProjectRef, dropTabFromTree, fileTabs, managerFor, modalOpenRef,
    pairedRuntimes, recordTabs, remoteSessions, sessions, setLayout, setPairedRuntimes, setRemoteSessions,
    setRemoteStatus, showExplorer, showNew, t
  } = deps
  // The Jobs sidebar snapshot for the open project — orch.list's initial payload, then every
  // 'orch:state' push after it (see the subscription effect below). null until orch.list first resolves.
  const [orchSnapshot, setOrchSnapshot] = useState<OrchSnapshot | null>(null)
  const orchSnapshotRef = useRef(orchSnapshot)
  orchSnapshotRef.current = orchSnapshot
  // **A paired Runtime in the Jobs view** (remote runtime design Phase 6, D1.4, D1.5). Every value here is its own:
  // the remote project never becomes `currentProject`, and the remote snapshot never mixes with `orchSnapshot`, so
  // with "This computer" selected every local path, call and push is what it was.
  const [jobsRuntime, setJobsRuntime] = useState<string>(LOCAL)
  /** Bumped when Settings pairs or removes a Runtime: the paired list is read again (review minor). */
  const [pairedChanged, setPairedChanged] = useState(0)
  /** Which Runtime `remoteProject` is a project of: the poll never asks one Runtime for another's (review minor). */
  const [remoteProjectFor, setRemoteProjectFor] = useState<string | null>(null)
  const [remoteProjects, setRemoteProjects] = useState<Array<{ id: string; name: string | null; path: string | null }> | null>(null)
  const [remoteProject, setRemoteProject] = useState<string | null>(null)
  const [remoteSnapshot, setRemoteSnapshot] = useState<OrchSnapshot | null>(null)
  /** Drops a remote reply whose Runtime is no longer selected, or that a newer one overtook (X1-11). */
  const replyGate = useRef(createReplyGate()).current
  const jobsRuntimeRef = useRef(jobsRuntime)
  jobsRuntimeRef.current = jobsRuntime
  /** Why the Jobs sidebar has nothing to draw, when the Host is the reason — null in the ordinary
   *  case. **Kept apart from the snapshot above, and that separation is the fix for ruling F41.** The
   *  snapshot is per project and this state deliberately substitutes an empty one whenever there is
   *  none open; a gate carried inside it was therefore erased in exactly the window that needs it —
   *  a fresh install, or any window before its first session. */
  const [orchHostGate, setOrchHostGate] = useState<OrchHostGate | null>(null)
  /** Who drives Jobs, as the Host last said it (limits L3) — null when nothing is known. With
   *  `hostStatus` it tells the Jobs sidebar why nothing moves (jobsStall). One fact about the app's
   *  Host, like the gate above, so it is not carried in the snapshot either. */
  const [hostDriver, setHostDriver] = useState<HostDriverReport | null>(null)
  /** When this window first saw the Host parked with no gate read yet (S6-11), null otherwise. A first
   *  settings read that hangs past JOBS_STALL_READING_MS then shows as "still reading" (jobsStall). */
  const [parkedSinceMs, setParkedSinceMs] = useState<number | null>(null)
  /** Bumped when that threshold comes due, so the sidebar draws again with no other change. */
  const [, setStallTick] = useState(0)
  /** 상세 창이 열려 있는 Run. null 이면 닫혀 있다.
   *
   *  **runId 만 들지 않고 프로젝트를 함께 든다.** 프로젝트가 바뀌는 커밋에서는 리셋 효과의
   *  setOpenRun(null) 이 그 렌더의 값을 바꾸지 못하므로(효과 단계다) 재조회는 옛 runId 로 한 번
   *  발사되고, 그러면 main 이 `run X does not belong to Y` 를 orchLog 에 쓴다 — 진짜 크로스 프로젝트
   *  접근 시도가 남기는 줄과 한 글자도 다르지 않아 그 로그를 감사에 쓸 수 없게 된다. 짝을 한 값으로
   *  들면 재조회가 발사 지점에서 스스로 거를 수 있다(효과 선언 순서를 바꾸는 것으로는 고쳐지지 않는다). */
  /** `runtimeId` for a paired Runtime's Run (Phase 6): `projectPath` is then that Runtime's project key, never a path here. */
  const [openRun, setOpenRun] = useState<{ projectPath: string; runId: string; runtimeId?: string } | null>(null)
  /** 그 Run 의 이벤트와 의존 그래프. null 은 아직 도착하지 않았다는 뜻이고 빈 배열과 다르다 — 모달은
   *  전자에 아무것도 그리지 않고 후자에만 빈 상태를 그린다. 읽는 효과는 currentProject 선언 아래에 있다. */
  const [detail, setDetail] = useState<RunDetailData | null>(null)
  /** 상세 창이 저널 줄을 몇 쪽까지 읽는가(stage 3 T1) — "이전 저널 기록 더 보기" 가 한 쪽씩 늘린다.
   *  runId 와 함께 든다: 다른 Run 을 열면 따로 되돌리지 않아도 1 쪽에서 시작한다. */
  const [journalPagesFor, setJournalPagesFor] = useState<{ runId: string; pages: number } | null>(null)
  /** 저널이 바빠 마지막으로 읽은 줄을 받았을 때 다시 묻는 횟수 — 바뀔 때마다 아래 효과가 상세를 다시
   *  부른다. 스냅샷이 움직이지 않는 Run 이면 그것 말고는 다시 물을 계기가 없다. */
  const [detailRetry, setDetailRetry] = useState(0)
  /** 홈 디렉터리 — 프로젝트가 없을 때 아래쪽 패널의 터미널이 열릴 자리. 프로세스 수명 동안 바뀌지
   *  않으므로 한 번만 읽는다. 도착하기 전에는 null 이고, 그동안 패널은 그려지지 않는다. */
  const [homeDir, setHomeDir] = useState<string | null>(null)
  useEffect(() => {
    void window.api.system.homeDir().then(setHomeDir, () => setHomeDir(null))
  }, [])

  /** Run 콘솔의 자리. 리사이저가 --run-panel-h 를 이 노드에 직접 쓴다 */
  const runHostRef = useRef<HTMLDivElement>(null)

  /** 예약을 세운다. **한 곳에 둔다** — 사이드바의 아이콘과 상세 창의 아이콘이 같은 동작이므로 확인
   *  문구도 409 의 갈래도 같아야 한다. 두 벌로 두면 한쪽만 고쳐지는 날 같은 버튼이 다른 말을 한다.
   *
   *  묻는 이유: 지금 일하는 워커가 멈추고, 멈춘 회차는 이어지지 않는다(다시 실행하면 다음 예약
   *  시각의 새 회차다). 되돌릴 수 없는 쪽은 아니지만 잃는 것이 있다.
   *
   *  409 를 문구로 가른다 — 붙잡아 둔 세션에는 "다시 해 보세요" 가 틀린 안내다(놓아 주는 것이
   *  답이다). 삭제 흐름이 같은 자리에서 같은 방식으로 가른다. */
  /** What the Job actions (lib/jobActions.ts) ask and show through. `hide` is this computer's history list, so only
   *  a local door gets it (remoteActionUi leaves it out). */
  const actionUi: ActionUi = {
    t: (key, params) => (t as (k: string, p?: Record<string, string | number>) => string)(key, params),
    confirm: (o) => confirmModal(o),
    confirmChoices: (o) => confirmModalWithChoices(o),
    error: (m, o) => void toast.error(m, o),
    hide: (paths) => {
      for (const p of paths) hiddenProjects.hide(p)
    }
  }
  const remoteActionUi: ActionUi = { t: actionUi.t, confirm: actionUi.confirm, confirmChoices: actionUi.confirmChoices, error: actionUi.error }
  const pauseScheduleRun = (runId: string): void => {
    if (currentProject) void pauseRun(localDoor(window.api, currentProject), runId, actionUi)
  }

  /** 세워 둔 예약을 다시 돌린다 — 칸을 걷는 것뿐이라 묻지 않는다(잃는 것이 없다). 무장은 이 순간부터
   *  다시 잡히므로 첫 회차는 **다음 예약 시각**이다(firesDue).
   *
   *  run-start 가 아니라 run-resume 다. 그쪽은 "아직 시작하지 않았다" 를 걷고 이쪽은 "세워 뒀다" 를
   *  걷는다 — 상세 창의 '실행' 과 이 '▶' 는 다른 버튼이다(Run.paused 의 주석). */
  const resumeScheduleRun = (runId: string): void => {
    if (currentProject) void resumeRun(localDoor(window.api, currentProject), runId, actionUi)
  }

  /** 관리자가 사라진 Run 에 코디네이터를 다시 붙인다. **`run-start` 를 다시 부른다** — 그 명령의
   *  뜻이 "이 Run 에 관리자가 있게 하라" 이고, 이미 붙어 있으면 아무것도 하지 않는다(command.ts).
   *  그래서 새 명령을 만들지 않았다.
   *
   *  `runId` 는 그 줄의 id 다: 펼치지 않은 Job 줄이면 Job 의 id(그 최신 회차를 뜻한다), 펼쳐진 회차
   *  줄이면 회차의 id 다(view.ts 의 rowFor). run-start 는 둘 다 받는다 — 한때 Job id 만 받아서
   *  예약 회차 줄과, 회차가 둘 이상인 Job 의 회차 줄에서 이 버튼이 언제나 실패했다.
   *
   *  앱이 스스로 되띄우지 않는 이유는 Run.coordinatorSessionId 의 주석에 있다 — 탭을 닫는 것은
   *  사람의 결정이고, 곧바로 다시 여는 것은 그 결정을 무시하는 일이다. 그래서 되돌리는 자리가
   *  사람의 손에 있다. */
  const restartCoordinator = (runId: string): void => {
    if (currentProject) void restartRunCoordinator(localDoor(window.api, currentProject), runId, actionUi)
  }
  /** W3-B: "Approve & execute" asks first (approvePlan): approving starts workers and spends quota. */
  const approve = (door: OrchDoor, snapshot: OrchSnapshot | null, runId: string, ui: ActionUi): void => {
    const row = snapshot ? findRun(snapshot, runId) : undefined
    void approvePlan(door, runId, row ? jobName(row) : runId, ui)
  }

  /** The root the active tab names: a file, record or browser tab's project, a session tab's cwd; null with no tab.
   *  T12: it no longer stands in for the current project. useWorkspace moves the title bar to its project instead, and
   *  a dropped selection falls back to it (selectionAfterDrop). */
  const activeTabRoot =
    (activeTab?.kind === 'file'
      ? fileTabs.find((t) => t.id === activeTabId)?.projectRoot
      : activeTab?.kind === 'record'
        ? // A record tab names its own project too. Without this branch the session lookup below
          // would search for a session by the record id and come up empty, and currentProject would
          // silently fall back to stickyRoot — so viewing A's record tab and then clicking B's session
          // tab would drop this tab from the list, with no way left to close it.
          recordTabs.find((t) => t.id === activeTabId)?.projectRoot
        : activeTab?.kind === 'browser'
          ? // A browser tab names its project the same way a file tab does
            browserTabs.find((t) => t.id === activeTabId)?.projectRoot
          : activeTab?.kind === 'app' || activeTab?.kind === 'session'
            ? sessions.find((s) => s.id === activeTab.id)?.cwd
            : undefined) ?? null

  /** T12: the folder of the project the top bar's switcher has selected, set by useWorkspace (projectScopeOf); null for
   *  All projects and Other. The active tab never overrides it: a tab of another project moves the switcher instead. */
  const [scopeRoot, setScopeRoot] = useState<string | null>(null)
  /** The folder the last drop removed from scopeRoot. The top bar's switcher reads it: its selection still names that
   *  project, and it shows the fallback instead. Cleared when a root is picked again. */
  const [droppedRoot, setDroppedRoot] = useState<string | null>(null)
  useEffect(() => {
    if (scopeRoot) sticky.write(scopeRoot)
    if (scopeRoot) setDroppedRoot(null)
  }, [scopeRoot])
  // A selected project whose folder is gone is dropped (back to "All projects"): checked when it is picked and when
  // the window regains focus, the moment a folder deleted outside the app is noticed. Only ENOENT drops it.
  useEffect(() => {
    if (!scopeRoot) return
    const probe = (): void => {
      void window.api.files.list(scopeRoot).then(
        () => {},
        (err: unknown) => {
          if (scopeAfterProbe(scopeRoot, scopeRoot, err) !== null) return
          // the remembered folder is the gone one: forget it too, or the next launch restores it
          if (sticky.read() === scopeRoot) sticky.clear()
          setDroppedRoot(scopeRoot)
          setScopeRoot((prev) => scopeAfterProbe(prev, scopeRoot, err))
        }
      )
    }
    probe()
    window.addEventListener('focus', probe)
    return () => window.removeEventListener('focus', probe)
  }, [scopeRoot])
  const currentProject = scopeRoot

  /** NewRunModal 이 열려 있는지. currentProject 아래에 두는 것은 이 파일이 지켜 온 자리 규칙이다 —
   *  바로 아래 두 효과의 주석이 기록하듯, 이 파일은 currentProject 보다 위에서 그 값을 참조해 TDZ
   *  ReferenceError 로 죽은 전례가 있고(타입체크는 잡지 못한다) 그 사고를 되풀이하지 않으려는
   *  자리다. onNewRun 콜백(아래 JobsView 호출부)과 JobsView 의 hasProject 가드가 이제 이 값을
   *  currentProject 없이는 절대 true 로 만들지 않으므로, "프로젝트가 없는데 열림" 은 정상 경로로는
   *  일어나지 않는다.
   *
   *  **한 번은 일어났다.** 프로젝트가 없을 때도 Jobs 사이드바의 빈 상태는 그려지고(`setOrchSnapshot(currentProject === null ? { runs: [] } : null)` 이
   *  orchSnapshot 을 `{ runs: [] }` 로 채운다) 그 안의 "+ 새 작업" 버튼이 가드 없이 이 값을 세운
   *  적이 있었다 — 그때 이 값은 "프로젝트를 잃어 조용히 닫힌 것"이 아니었다: 모달을 그릴 자리가
   *  없을 뿐 이 값 자체는 true 로 남아 modalOpenRef 체인에 걸리고(onKey 의 `modalOpenRef.current || isConfirmOpen()` 가드), 전역 키보드
   *  단축키가 아무 안내도 없이 전부 죽었다. 그리고 나중에 프로젝트를 열면 아무도 누르지 않은
   *  모달이 그제서야 튀어나왔다. 그 경로를 이전 리뷰는 "stickyRoot 는 한 번 정해지면 null 로
   *  돌아가지 않는다"는 이유로 도달 불가능이라 판단했지만, 새로 설치한 상태의 stickyRoot 는
   *  처음부터 비어 있어 정확히 그 경로에 닿았다 — 그 판단은 틀렸다. */
  const [newRunOpen, setNewRunOpen] = useState(false)
  /** The "+ From a source" window (plugin Phase 4 J20): the project it was opened in, this machine's only, or null.
   *  The project is kept rather than read live, so a tab change while it is open does not move the Job elsewhere (4c
   *  final review M17). */
  const [sourceJobOpen, setSourceJobOpen] = useState<string | null>(null)

  // A remote Run's detail: read from the latest remote snapshot, asked again only when its key changes.
  const remoteSnapshotRef = useRef(remoteSnapshot)
  remoteSnapshotRef.current = remoteSnapshot
  const remoteRowKey = openRun?.runtimeId ? remoteDetailKey(remoteSnapshot, openRun.runId) : ''
  const localRowKey =
    openRun && !openRun.runtimeId ? runDetailKey(orchSnapshot, openRun.runId, sessions.map((s) => s.id)) : ''
  /** A paired Runtime's permission as this app was told at pairing; an unknown one is read only (controllerGate). */
  const permissionOf = (runtimeId: string): string => pairedRuntimes.find((r) => r.runtimeId === runtimeId)?.permission ?? 'read-only'
  const readOnlyReason = t('jobs.runtime.readOnlyReason')
  const runtimeName = (runtimeId: string): string => pairedRuntimes.find((r) => r.runtimeId === runtimeId)?.name ?? runtimeId
  const remoteReadOnly = (runtimeId: string): boolean => permissionOf(runtimeId) !== 'full-control'
  /** A remote tab's own name, as its tab and its notification show it. */
  const remoteTitleOf = (r: RemoteSessionRef): string => `${r.title ?? r.sessionId} · ${runtimeName(r.runtimeId)}`
  // The paired Runtimes, for a remote tab's name and permission: read when the first remote tab opens.
  const anyRemoteTab = remoteSessions.length > 0
  // ... when the new session dialog opens, for its choice of where the session runs; and once at start, so a
  // controller with no CLI of its own can open that dialog at all (canStart). A local file read, nothing remote.
  useEffect(() => {
    void window.api.remote.list().then(setPairedRuntimes, () => {})
  }, [anyRemoteTab, showNew, pairedChanged])
  useRemoteSessionWatch({
    refs: remoteSessions,
    onUpdate: (next) => setRemoteSessions((prev) => prev.map((r) => (r.key === next.key ? next : r))),
    // A roll replaced the session while this tab watched it, or while the link was down (X1-11): the tab moves to
    // the new session in its place, and its view starts again from the new pty's checkpoint.
    onFollow: (fromKey, to) => {
      // The new session already has a tab of its own (opened meanwhile): the old tab goes rather than becoming a second
      // tab of it (review M4).
      if (followAction(remoteSessions.map((r) => r.key), fromKey, to.key) === 'drop') {
        setRemoteSessions((prev) => prev.filter((r) => r.key !== fromKey))
        dropTabFromTree(sessionTab(fromKey))
        return
      }
      setRemoteSessions((prev) => prev.map((r) => (r.key === fromKey ? to : r)))
      setLayout((cur) => (cur ? replaceTabId(cur, sessionTab(fromKey), sessionTab(to.key)) : cur))
    },
    onStatus: (key, status) => setRemoteStatus((prev) => (prev[key] === status ? prev : { ...prev, [key]: status })),
    onWaiting: (ref) => window.api.notify.remoteWaiting({ key: ref.key, title: remoteTitleOf(ref) })
  })
  const stopRemoteSession = async (ref: RemoteSessionRef): Promise<void> => {
    const ok = await confirmModal({ title: t('remote.session.stopTitle'), body: t('remote.session.stopBody'), confirmLabel: t('remote.session.stop') })
    if (!ok) return
    const r = await remoteCall(ref.runtimeId, 'sessions-stop', { id: ref.sessionId })
    if (r.status !== 200) toast.error(t('remote.session.failed', { message: String((r.body as { error?: unknown } | null)?.error ?? r.status) }))
  }
  /** Bumped when a change on a paired Runtime went through: the remote list is read again now (it is not pushed). */
  const [remoteRefresh, setRemoteRefresh] = useState(0)
  const onRemoteChanged = useRef(() => setRemoteRefresh((n) => n + 1)).current
  /** Where the open detail's commands, accounts and run configurations go (lib/orchDoor.ts, Phase 7). */
  const detailPermission = openRun?.runtimeId ? permissionOf(openRun.runtimeId) : ''
  const detailDoor = useMemo<OrchDoor | null>(() => {
    if (!openRun) return null
    if (!openRun.runtimeId) return localDoor(window.api, openRun.projectPath)
    return remoteDoor(window.api, { runtimeId: openRun.runtimeId, projectKey: openRun.projectPath, permission: detailPermission, readOnlyReason, onChanged: onRemoteChanged })
  }, [openRun?.runtimeId, openRun?.projectPath, detailPermission, readOnlyReason])
  /** The remote Jobs view's door: the selected Runtime and its project (Phase 7). */
  const remoteViewPermission = isRemoteRuntime(jobsRuntime) ? permissionOf(jobsRuntime) : ''
  const remoteViewDoor = useMemo<OrchDoor | null>(
    () =>
      isRemoteRuntime(jobsRuntime) && remoteProject !== null
        ? remoteDoor(window.api, { runtimeId: jobsRuntime, projectKey: remoteProject, permission: remoteViewPermission, readOnlyReason, onChanged: onRemoteChanged })
        : null,
    [jobsRuntime, remoteProject, remoteViewPermission, readOnlyReason]
  )
  /** A new Job on a paired Runtime: its form is open, and the Runtime's accounts once they came. */
  const [remoteNewRunOpen, setRemoteNewRunOpen] = useState(false)
  const [remoteAccounts, setRemoteAccounts] = useState<Account[] | null>(null)
  useEffect(() => {
    if (!remoteNewRunOpen || !remoteViewDoor) return
    let alive = true
    setRemoteAccounts(null)
    void remoteViewDoor.accounts().then((list) => {
      if (alive) setRemoteAccounts(list)
    })
    return () => {
      alive = false
    }
  }, [remoteNewRunOpen, remoteViewDoor])
  // Another Runtime or project is not the one the form was opened for.
  useEffect(() => setRemoteNewRunOpen(false), [jobsRuntime, remoteProject])
  // 기록 모달이 열려 있는 동안 이벤트를 다시 읽는다. **이 자리에 있어야 한다** — 의존성 배열은
  // 렌더 중에 평가되므로, currentProject 선언보다 위에 두면 TDZ ReferenceError 로 죽는다(타입체크는
  // 잡지 못한다).
  //
  // orchSnapshot 을 의존성에 두는 것이 요점이다: 그 값이 바뀌는 것이 곧 "이 프로젝트의 오케스트레이션
  // 상태가 움직였다"이고, JobRow.eventCount 가 스냅샷에 실려 있으므로 Task 상태를 하나도 옮기지 않는
  // 메시지도 그 신호에 포함된다. 폴링을 두지 않는 이유가 그것이다.
  useEffect(() => {
    // 짝이 맞지 않으면 부르지 않는다 — 프로젝트 A→B 커밋에서 이 효과는 아직 A 의 runId 를 들고
    // 돌지만, 그 조합은 main 이 거부할 조합이다. 여기서 거르면 orchLog 에 접근 위반과 똑같이 생긴
    // 줄이 남지 않는다. 모달을 닫는 것은 아래의 리셋 효과다(이 가드는 로그만 지킨다).
    if (!openRun) return
    // A paired Runtime's Run is read from that Runtime and its own snapshot; a local one keeps its project guard.
    const detailSnapshot = openRun.runtimeId ? remoteSnapshotRef.current : orchSnapshotRef.current
    if (!openRun.runtimeId && openRun.projectPath !== currentProject) return
    // 스냅샷에 없는 Run 도 부르지 않는다 — worktree 제거나 astera reset 으로 Run 이 사라지면
    // 프로젝트는 그대로인데 main 은 접근 위반과 똑같이 생긴 `run X does not belong to Y` 를 로그에
    // 남긴다. orchSnapshot 이 아직 null 이면(안 왔다) 없다고 단정하지 않는다 — 그때는 부르는 쪽이
    // 맞다. Run 이 사라진 뒤에 창을 닫는 것은 아래의 새 효과다.
    // **findRun 이어야 한다**(snapshot.ts): 예약 회차는 최상위 runs 에서 빠져 children 에 있으므로
    // `runs.some` 은 회차를 늘 "없다"고 답하고, 그러면 상세 창이 영원히 비어 있다.
    if (detailSnapshot !== null && !findRun(detailSnapshot, openRun.runId)) return
    let cancelled = false
    // 거부 팔을 반드시 둔다 — 위의 가드가 걸러도 main 은 저장소를 읽다 던질 수 있고, 그러면
    // DevTools 에 Uncaught (in promise) 가 뜬다. 빈 모양으로 접으면 모달은 빈 상태를 그린다.
    const journalPages = journalPagesFor?.runId === openRun.runId ? journalPagesFor.pages : 1
    void window.api.orch.runDetail(openRun.projectPath, openRun.runId, { journalPages }, openRun.runtimeId).then(
      (d) => {
        if (!cancelled) setDetail(d)
      },
      () => {
        if (!cancelled) setDetail({ events: [], layers: [], deps: {}, cyclic: [] })
      }
    )
    return () => {
      cancelled = true
    }
    // A remote Run's detail is asked again on its own row and the Runtime's reach (remoteDetailKey), not on each poll; a
    // local one on its own row (runDetailKey), not on every push of the project's snapshot (performance audit R5).
  }, [openRun, currentProject, localRowKey, remoteRowKey, journalPagesFor, detailRetry])
  // 저널이 바빴다(stage 3 T1) — main 은 기다리지 않고 마지막으로 읽은 줄을 줬다. 잠시 뒤에 다시 묻는다.
  // 답이 여전히 바쁘면 다음 답이 또 한 번을 잡는다. 창을 닫거나 답이 바뀌면 타이머를 걷는다.
  useEffect(() => {
    if (!detail?.journal?.busy) return
    const timer = setTimeout(() => setDetailRetry((n) => n + 1), DETAIL_BUSY_RETRY_MS)
    return () => clearTimeout(timer)
  }, [detail])
  // 프로젝트가 바뀌면 닫는다 — 다른 프로젝트의 Run 을 열어 둔 채로 둘 이유가 없다
  useEffect(() => {
    setOpenRun(null)
    setDetail(null)
  }, [currentProject])
  // Run 이 스냅샷에서 사라지면 닫는다 — 프로젝트는 그대로인데 Run 만 사라지면(worktree 제거,
  // astera reset) 위의 효과는 반응하지 않고, 창은 제목 없이 열린 채 "아직 아무 일도 없었습니다"를
  // 그린다(App.tsx 의 openRun 렌더가 orchSnapshot 에 없는 Run 을 undefined 로 넘긴다). 이 자리에
  // 두는 이유는 openRun·orchSnapshot 선언보다 아래여야 하기 때문이다 — 위로 옮기면 TDZ
  // ReferenceError 로 죽는다(타입체크는 못 잡는다). 여기서도 orchSnapshot === null 은 "없다"가
  // 아니다 — 아직 첫 조회가 오지 않았을 뿐이면 닫지 않는다.
  // W7-C (#72): a Run asked to open from the needs-input list, opened once its project is the current one. After the
  // close-on-project-change effect above, so the switch that brings the project does not close it again.
  // Dropped on a switch elsewhere or another plan opened (pendingRunStep, pendingAfterOpen): otherwise a later switch to
  // its project turned it into openRun and stole focus to that old plan's tab.
  const [pendingRun, setPendingRun] = useState<{ projectPath: string; runId: string } | null>(null)
  const pendingProjectRef = useRef(currentProject)
  useEffect(() => {
    const step = pendingRunStep(pendingRun, currentProject, pendingProjectRef.current)
    pendingProjectRef.current = currentProject
    if (step === 'open') setOpenRun(pendingRun)
    if (step !== 'wait') setPendingRun(null)
  }, [pendingRun, currentProject])
  useEffect(() => setPendingRun((p) => pendingAfterOpen(p, openRun)), [openRun])
  // Whether the open detail's Run has been in its list since it opened (detailRunGone).
  const openRunSeen = useRef(false)
  useEffect(() => {
    openRunSeen.current = false
  }, [openRun?.runId, openRun?.runtimeId])
  useEffect(() => {
    if (!openRun) return
    // A paired Runtime's Run just made there is not in the list until the next read: not closed for that (openRunCheck).
    const check = openRunCheck({ openRun, currentProject, snap: openRun.runtimeId ? remoteSnapshot : orchSnapshot, seen: openRunSeen.current })
    if (check.found) openRunSeen.current = true
    if (check.close) setOpenRun(null)
  }, [openRun, currentProject, orchSnapshot, remoteSnapshot])

  // Whether RunConfigManager is actually on screen — gates both its render below and the shortcut
  // suppression right after it. The dialog is pinned to the project (and context) it was opened
  // with, not the live currentProject, so this is just "was it opened" — managerFor going null on
  // close drops the suppression in the same render as the unmount.
  const runManagerVisible = managerFor !== null
  // OR-ed onto the value the other modals already set above — runManagerVisible depends on
  // currentProject, which is not computed yet at that point in the component. The history modal joins
  // the same chain: while it is open the shortcuts must not reach the workbench behind it.
  // newRunOpen joins for the same reason — it has a text input (objective), and without this a global
  // shortcut key would reach the workbench behind the modal while that field has focus.
  // DESIGN-W13: an open plan is an editor tab now, not a window over the workbench, so it no longer holds the keys.
  modalOpenRef.current = modalOpenRef.current || runManagerVisible || newRunOpen || remoteNewRunOpen || sourceJobOpen !== null
  currentProjectRef.current = currentProject

  /** A folder a terminal link named (D2, 2026-10-14). The explorer shows the current project, so a folder under it is
   *  revealed there; any other opens in the system file manager (files.openFolder, which opens folders only). */
  const [explorerReveal, setExplorerReveal] = useState<FolderReveal | null>(null)
  const revealSeqRef = useRef(0)
  const openLinkedFolder = (folder: string): void => {
    const action = folderLinkAction(folder, currentProjectRef.current)
    if (action.kind === 'explorer' && currentProjectRef.current) {
      showExplorer()
      revealSeqRef.current += 1
      setExplorerReveal({ root: currentProjectRef.current, segments: action.segments, seq: revealSeqRef.current })
      return
    }
    void window.api.files.openFolder(folder).catch((err: unknown) => toast.error(errText(err)))
  }
  return {
    orchSnapshot, setOrchSnapshot, jobsRuntime, setJobsRuntime, pairedChanged, setPairedChanged, remoteProjectFor,
    setRemoteProjectFor, remoteProjects, setRemoteProjects, remoteProject, setRemoteProject, remoteSnapshot,
    setRemoteSnapshot, replyGate, jobsRuntimeRef, orchHostGate, setOrchHostGate, hostDriver, setHostDriver,
    parkedSinceMs, setParkedSinceMs, setStallTick, openRun, setOpenRun, detail, setDetail, setJournalPagesFor,
    homeDir, runHostRef, actionUi, remoteActionUi, pauseScheduleRun, resumeScheduleRun, restartCoordinator, approve,
    activeTabRoot, setScopeRoot, droppedRoot, currentProject, newRunOpen, setNewRunOpen, sourceJobOpen, setSourceJobOpen, runtimeName,
    remoteReadOnly, stopRemoteSession, remoteRefresh, detailDoor, remoteViewPermission, remoteViewDoor,
    remoteNewRunOpen, setRemoteNewRunOpen, remoteAccounts, setPendingRun, explorerReveal, setExplorerReveal,
    openLinkedFolder
  }
}
