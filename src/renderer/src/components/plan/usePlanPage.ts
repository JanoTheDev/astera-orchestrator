// The plan page's shared state and effects (moved out of pages/PlanPage.tsx). The commands that change the plan are
// planCommands.ts'; the sections draw from what this returns.
import { useEffect, useState } from 'react'
import { invalidate, useCachedRead } from '../../lib/readCache'
import type { Account, JobRow, RunDetail as RunDetailData } from '../../../../core/types'
import { runningCount } from '../../../../core/orchestration/running'
import { useI18n } from '../../i18n/I18nProvider'
import type { CheckPluginRow, OrchDoor } from '../../lib/orchDoor'
import { confirmModal, confirmModalWithChoices } from '../../lib/confirm'
import type { ActionUi } from '../../lib/jobActions'
import { toast } from '../../lib/toast'
import { useSummaries } from '../../state/useSummaries'
import { planAccountsKey, planCheckPluginsKey, planRunConfigsKey } from './planReadKeys'
import { planCommands } from './planCommands'
import { canManualStartOf, headCountsOf, waveStatusOf } from './planPage'
import { wavesOf } from './planBoard'
import { usePlanLive } from './usePlanLive'

/** 한 Run 의 상세 창 — 위가 의존 그래프, 아래가 이벤트다. **더 이상 읽기 전용이 아니다** — Task 8 이
 *  여기서 Task 를 짓게 했고(`task-create`), Task 9 가 노드에서 `띄우기`·`멈추기`·`물어보기`·
 *  `다시 띄우기`(`worker-start`·`worker-stop`·`gate-create`·`task-update`)를 열었다. 이 계획이
 *  초안될 때는 이 파일이 쓰는 쪽이 될 줄 몰랐고, 그 반전은 `knowledge/decisions/ADR-004`에 있다.
 *  **Gate 에 답하는 것도 이제 여기다**(`답하기` → `gate-resolve`). 한때 이 주석은 그것이 "아직
 *  Slack 제어면의 몫"이라고 적었는데, 그 절반이 참인 동안 앱은 Gate 를 **열고 보여 주기만 하고
 *  푸는 곳이 아무 데도 없었다** — 로드맵 5번이 그래서 "Slack 에 제어면을 만든다"에서 "Gate 를
 *  앱에서 푼다"로 좁아졌다. 사람이 앱에서 일을 만들게 해 놓고 그 일이 던지는 질문은 다른 데서
 *  답하라는 것은 앞뒤가 맞지 않고, `물어보기` 로 연 Gate 는 애초에 사람이 스스로 쓴 질문이다.
 *  Slack 은 알림으로 남는다.
 *
 *  **그래프는 장식이 아니라 필터다.** 노드를 누르면 아래가 그 Task 의 이벤트만 남는다 — "왜 저게
 *  안 도나"(위)와 "저기서 무슨 일이 있었나"(아래)가 한 화면에서 이어지고, 이벤트가 수십 줄이 되는
 *  문제도 같이 풀린다(가려진 개수는 맨 아래에 적는다).
 *
 *  두 칸을 옆이 아니라 위아래로 두는 이유는 자라는 방향이다: 그래프는 한 층에 Task 가 늘수록
 *  **가로로** 자라고, 이벤트는 세로로 자란다. 옆에 세우면 그래프가 창의 절반도 못 쓰고 넷만 나란히
 *  서도 잘린다. 스크롤은 둘 다 자기 칸 안에서만 돈다(styles.css 의 min-height: 0).
 *
 *  이 컴포넌트에는 테스트가 없다(렌더러에 jsdom 이 없다). 그래서 판정은 전부 core 에 있고 —
 *  이벤트는 orchestration/timeline.ts, 층은 graph.ts, 노드의 좌표는 graphLayout.ts — 여기는 건네받은
 *  것을 그리기만 한다. */
export function usePlanPage({
  run,
  detail,
  runId,
  door
}: {
  run: JobRow | undefined
  detail: RunDetailData | null
  runId: string
  door: OrchDoor
}) {
  const { t } = useI18n()
  /** Why the controls are off: a read-only pairing (Phase 7). They are drawn disabled with it as their title, and it
   *  is said under the head, so the reason is on screen rather than a button that does nothing. */
  const lockedReason = door.readOnlyReason ?? undefined
  // W9-C: the ⋯ menu's actions (lib/jobActions), the same confirmations the Jobs card uses
  const ui: ActionUi = {
    t: (key, params) => (t as (k: string, p?: Record<string, string | number>) => string)(key, params),
    confirm: (o) => confirmModal(o),
    confirmChoices: (o) => confirmModalWithChoices(o),
    error: (m, o) => void toast.error(m, o)
  }
  /** 고른 노드 = 아래 이벤트의 필터. 같은 노드를 다시 누르면 풀린다 */
  const [selected, setSelected] = useState<string | null>(null)
  /** The journal lines opened to their body; kept here so switching sections does not fold them. */
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string): void =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  /** Task 를 짓는 중인가. **한때 string[] | null 이었다** — 그래프 노드를 눌러 의존을 골랐으므로
   *  이 상태가 "폼이 열렸다"와 "무엇을 골랐다"를 겸했다. 의존이 폼의 셀렉트로 가면서 고른 값은
   *  NewTaskModal 이 소유하고, 여기 남는 것은 열렸는가 하나다.
   *
   *  **필터(selected)는 건드리지 않는다.** 짓는 동안에도 그대로 남아 있다가 끝나면(성공이든 취소든)
   *  그대로 돌아온다 — 지우거나 감추면, 이미 한 Task 로 걸러서 그 사정을 보던 사람이 + Task 를
   *  누른 순간 그 맥락을 잃는다. 짓는 동안 아래 칸(.detail-events)이 폼으로 바뀌어 그 필터 줄
   *  자체는 잠깐 보이지 않지만, 상태는 그대로 있으므로 폼을 닫으면 원래 걸러 보던 화면이 다시
   *  나온다. */
  const [authoring, setAuthoring] = useState(false)
  /** 계정 목록. **두 곳이 쓴다** — Task 짓기 폼의 계정 칸(그 Run 의 provider 것만 걸러 넘긴다)과
   *  아래 필터 줄이 지정된 계정의 **이름**을 적는 자리다. 그래서 폼이 열릴 때만이 아니라 창이 열려
   *  있는 동안 들고 있고, 폼을 열 때마다 다시 받는다(그 사이 계정이 늘거나 지워졌을 수 있다).
   *
   *  **로그인 여부는 묻지 않는다**: 이 목록은 "고를 수 있는 것"이고, 고른 계정을 정말 쓸 수 있는지는
   *  띄우는 순간 accountToDispatchOn 이 본다 — 지금 로그아웃돼 있어도 나중에 로그인하면 되는
   *  것이라, 여기서 숨기면 고를 수 없는 이유가 화면에 남지 않는다. */
  const accountsRead = useCachedRead(planAccountsKey(door), () => door.accounts())
  // 거부 팔: 실패해도 폼은 쓸 수 있어야 하므로 빈 목록으로 접는다. 그러면 계정 칸이 그려지지 않고(고를 것이 둘 미만)
  // 지정 없이 Task 를 만드는 길이 남는다.
  const accounts: Account[] | null = accountsRead.data ?? (accountsRead.error ? [] : null)
  // The cache keeps the lists across opens (a plan reopens at once); the form asks again when it opens, since accounts,
  // configurations and plugins may have changed meanwhile.
  useEffect(() => {
    if (!authoring) return
    invalidate(planAccountsKey(door))
    invalidate(planRunConfigsKey(door, runId))
    invalidate(planCheckPluginsKey(door))
  }, [authoring, door, runId])
  /** Task 짓기 폼의 검증 구성 목록. null 은 아직 안 온 것 — NewTaskModal 의 prop 문서와 같은 뜻이다.
   *
   *  **run.list 로 받는다. orch.command(..., 'run-configs', ...) 가 아니다.** run-configs 명령은
   *  latestOrdinaryRun(s) — 템플릿도 예약 회차도 아닌 것 중 가장 최근 Run — 을 위해 답하고 어느 Run
   *  을 위한 것인지 받는 인자가 아예 없다(server.ts 의 'run-configs' case). 이 창은 프로젝트마다
   *  열릴 수 있고 그 Run 이 이 창의 프로젝트에 속한다는 보장이 없으므로, 그 명령을 쓰면 다른
   *  프로젝트의 실행 구성 목록이 뜰 수 있다. **예약이 생긴 뒤로는 더 그렇다** — 발화가 Run 을
   *  만들므로 그 "가장 최근"이 사람의 동작 없이도 움직인다. run.list(projectPath) 는 프로젝트로 직접 물어보고
   *  (assertAllowedPath 를 거친다) 오케스트레이션 상태를 바꾸지 않는 프로젝트 설정 조회이므로 "UI 는
   *  orch.command 만 부른다" 규칙과 부딪히지 않는다 — 그 규칙은 오케스트레이션 상태를 바꾸는
   *  통로에 대한 것이다. listRunConfigs(ipc.ts, run-configs 가 쓰는 것)와 run.list 핸들러는 똑같이
   *  loadRunConfigs({projectPath, stored, assertAllowedPath})를 부르므로 id 가 갈라지지 않는다 —
   *  여기서 고른 id 가 곧 validateConfigId 로 저장되고 TaskValidator 가 나중에 그 id 로 찾아낼 그
   *  설정이다. */
  const runConfigsRead = useCachedRead(authoring ? planRunConfigsKey(door, runId) : null, async () =>
    // A compound has no command and no exit code of its own — validation's contract is one
    // command, one exit code (see prepareRun's compoundNotRunnable refusal), so it is excluded
    // here rather than offered and then failed every time it runs.
    (await door.runConfigs(runId)).filter((c) => c.type !== 'compound').map((c) => ({ id: c.id, name: c.name }))
  )
  // 거부 팔을 반드시 둔다 — 실패해도 폼은 그대로 쓸 수 있어야 하므로(검증 없이 Task 를 만드는 것도 유효한 선택이다)
  // 빈 목록으로 접는다 — "검증 없음" 하나만 남는다.
  const runConfigs: { id: string; name: string }[] | null = runConfigsRead.data ?? (runConfigsRead.error ? [] : null)
  /** This computer's completion check plugins for the form (plugin Phase 5 C6), read beside the run configurations and
   *  apart from them: the Host may be slow or down, and the run configurations are offered without waiting for it. A
   *  Runtime's door offers none (C14). null = not read yet. */
  const pluginsRead = useCachedRead<CheckPluginRow[]>(authoring ? planCheckPluginsKey(door) : null, () => door.checkPlugins())
  const checkPlugins: CheckPluginRow[] | null = pluginsRead.data ?? (pluginsRead.error ? [] : null)
  /** 물어보기(Gate)의 질문을 쓰는 중인 Task id. null 이면 안 쓰는 중이다 — authoring 과 같은 자리에
   *  서는 세 번째 모습이다(그래프는 그대로, .detail-events 만 바뀐다). authoring 처럼 selected(필터)는
   *  건드리지 않는다. */
  const [asking, setAsking] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  /** Gate 에 답을 쓰는 중인 Task id. asking 의 짝이다 — 저쪽은 질문을 만들고 이쪽은 그 질문을 푼다.
   *  **둘은 동시에 열리지 않는다**(아래 formOpen 이 둘 다 잠근다) 그래서 gateError 를 함께 쓴다. */
  const [answering, setAnswering] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  /** 지금 도는 노드 동작(띄우기·멈추기·물어보기·다시 띄우기)의 대상 Task id, 없으면 null.
   *
   *  **하나뿐이고 Task 별로 나누지 않는다** — 그래서 무언가 도는 동안에는 그래프의 모든 노드
   *  버튼이 함께 숨는다. 이 창은 한 번에 하나만 다루는 것이 보통의 쓰임이고, Task 마다 따로 두면
   *  "다른 Task 의 명령이 도는 동안 이 버튼은 눌러도 되는가"를 버튼마다 다시 정해야 한다.
   *
   *  authoring·asking 과 따로 두는 이유: 그 둘은 "폼이 열려 있다"를 말하지만 띄우기·멈추기·다시
   *  띄우기에는 폼이 없다 — 버튼 하나가 곧 명령이라, 명령이 오가는 동안을 표시할 값이 그 셋에는
   *  따로 필요하다(물어보기는 asking 이 그 구간도 이미 덮는다 — 성공했을 때만 asking 을 null 로
   *  돌리므로). */
  const [busy, setBusy] = useState<string | null>(null)
  /** 물어보기(gate-create) 제출이 실패했을 때의 안내 — 이 폼(asking)과 함께 살고 죽는다.
   *  NewTaskModal 이 자기 에러를 자기 폼 안에 두는 것과 같은 자리다. **띄우기·멈추기·다시
   *  띄우기는 이 값을 쓰지 않는다** — 그 셋에는 폼이 없어서 실패를 인라인으로 보여 줄 자리가
   *  없고, 이 앱은 그런 폼 없는 단발 액션의 실패를 이미 toast.error 로 보낸다(App.tsx 의
   *  run.start.failed·files.save.failed 등과 같은 관례). 하나의 배너에 넷을 몰아넣는 것은 "폼이
   *  있으면 인라인, 없으면 토스트"라는 이 저장소의 규칙 옆에 같은 일을 하는 두 번째 장치를
   *  세우는 것이라 고르지 않았다. */
  const [gateError, setGateError] = useState<string | null>(null)
  /** 아래 칸이 폼에 내준 동안 — Task 를 짓거나, 질문을 쓰거나, 답을 쓰는 중이다.
   *
   *  **`busy` 와 갈라 두는 이유가 이 값의 존재 이유다.** 둘 다 formOpen 을 참으로 만들지만 버튼
   *  줄에게는 다른 상황이다: 폼이 열리면 그 줄이 자리를 내주는 것이 맞고(아래 `.detail-graph-head`
   *  의 주석), 명령이 도는 동안은 **남아서 무엇이 도는지 말해야 한다**. 한 값으로 겸하게 했더니
   *  실행을 누르는 순간 Task 추가·실행·병합이 통째로 사라졌다가 몇 초 뒤 다른 구성으로 돌아왔고,
   *  그 사이 화면에는 아무 표시가 없어 멈춘 것으로 보고됐다 — 그 몇 초는 대개 `git worktree add`
   *  의 체크아웃이다(server.ts 의 run-start 가 코디네이터보다 워크트리를 먼저 만든다). */
  const authoringOpen = authoring || asking !== null || answering !== null
  /** 그래프의 노드 버튼이 무언가를 조용히 버릴 수 있는 동안 — 위의 폼들에 더해 명령이 도는 중이다.
   *  이 동안은 노드 버튼(↗ 포함)을 전부 숨기고 배경 클릭으로 창을 닫지도 않는다: 다른 버튼을
   *  누르면 지금 쓰던 것을 잃고, 배경을 눌러 창을 닫으면 도는 명령의 결과를 아무도 보지 못한다
   *  (이 창을 새로 열지 않는 한 다시 알 길이 없다). */
  const formOpen = authoringOpen || busy !== null
  const canManualStart = canManualStartOf(run)

  const tasks = run?.tasks ?? []
  // W2-C plan board: the graph or the board in the upper half; the overview sits above either.
  // W6-E: the board (by wave) opens first, as the place a plan run is watched, and a files tab joins them
  // W9-C: the board and the graph are the Waves section; files is its own section
  // T8: the steps and Needs you are always on the plan tab, so the live read always runs while it is open
  const [view, setView] = useState<'graph' | 'board'>('board')
  const live = usePlanLive(door, true, runId)
  const summaries = useSummaries(door, runId) // W9-I: the board's lines and "What happened so far"
  // 고른 Task 가 스냅샷에서 사라졌으면 필터도 없다 — 걸러 낸 목록이 영원히 비는 대신 전체를 그린다
  const selectedTask = tasks.find((tk) => tk.id === selected)
  const events = detail?.events ?? null
  const running = runningCount(tasks)
  const counts = headCountsOf(tasks)
  const waveStatus = waveStatusOf(run, wavesOf(tasks, detail?.layers ?? []))

  /** 그래프 노드 클릭은 필터 하나만 뜻한다 — 같은 노드를 다시 누르면 풀린다.
   *
   *  **예전에는 뜻이 둘이었다**: 짓는 중이면 의존을 고르고, 아니면 필터였다. 의존이 폼의 셀렉트로
   *  가면서 그 분기가 없어졌고, 함께 없어진 것이 하나 더 있다 — 같은 노드가 "걸러 놓은 것"과
   *  "고른 의존" 두 표시를 동시에 달 수 있던 상태다(청록 링과 체크 글리프). 뜻이 하나면 표시도
   *  하나다.
   *
   *  **폼이 열려 있는 동안에는 클릭을 통째로 무시한다.** 노드 버튼들이 이 동안 전부 숨는 것
   *  (node() 의 `!formOpen &&`)과 같은 규칙이다 — 버튼만 숨기고 노드 자신의 onClick 을 그대로
   *  두면, 폼을 쓰는 중에 다른 노드를 눌러 필터 링을 조용히 옮길 수 있는 구멍이 남는다. 이 판단을
   *  Graph 안에 두지 않고 여기 두는 것은 Graph 는 그리기만 한다는 파일 머리말의 규칙이다. */
  const onNodeClick = (id: string): void => {
    if (formOpen) return
    setSelected((prev) => (prev === id ? null : id))
  }

  const commands = planCommands({
    t, ui, door, run, runId, tasks, accounts, asking, question, answering,
    busy, setBusy, setGateError, setAsking, setQuestion, setAnswering, setAnswer
  })

  return {
    ...commands,
    lockedReason, ui, selected, setSelected, open, toggle, authoring, setAuthoring, runConfigs, accounts, checkPlugins,
    asking, setAsking, question, setQuestion, answering, setAnswering, answer, setAnswer, busy, gateError, setGateError,
    authoringOpen, formOpen, canManualStart, tasks, view, setView, live, summaries, selectedTask, events, running,
    counts, waveStatus, onNodeClick
  }
}

export type PlanPageState = ReturnType<typeof usePlanPage>
