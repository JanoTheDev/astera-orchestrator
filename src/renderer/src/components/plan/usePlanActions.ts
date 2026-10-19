// W11 plan page: the plan's state and commands, shared by its header, waves, forms and journal. Moved out of
// pages/PlanPage.tsx unchanged; every command goes through `door` (orchDoorUse.test.ts).
import { useEffect, useState } from 'react'
import type { Account, JobRow, JobTask, Provider } from '../../../../core/types'
import { accountToDispatchOn } from '../../../../core/accounts/dispatchAccount'
import { providerOf } from '../../../../core/providers/meta'
import { DEFAULT_CONCURRENCY, type Dispatch } from '../../../../core/orchestration/types'
import { runIdToMerge } from '../../../../core/orchestration/snapshot'
import { useI18n } from '../../i18n/I18nProvider'
import { replyNote, type CheckPluginRow, type OrchDoor } from '../../lib/orchDoor'
import { confirmModal, confirmModalWithChoices } from '../../lib/confirm'
import { approvePlan, type ActionUi } from '../../lib/jobActions'
import { toast } from '../../lib/toast'
import { errText } from '../../hooks/useFileOps'
import { jobName } from '../../lib/jobName'

/** busy 가 담는 값은 노드 동작의 대상 Task id 인데, 실행 버튼에는 대상 Task 가 없다. Task id 와
 *  겹칠 수 없는 값을 하나 둔다 — id 는 `tsk_` 로 시작하므로(core/orchestration/types.ts 의 newId)
 *  이 문자열과 같아질 수 없다. UI_CALLER 가 세션 id 와 겹치지 않게 하는 것과 같은 방식이다. */
export const RUN_START = 'run:start'

/** 병합 버튼의 busy 센티넬. RUN_START 와 같은 이유로 Task id 와 겹칠 수 없는 값이다 */
export const RUN_MERGE = 'run:merge'

export type PlanActions = ReturnType<typeof usePlanActions>

export function usePlanActions({ run, runId, door, tasks }: { run: JobRow | undefined; runId: string; door: OrchDoor; tasks: JobTask[] }) {
  const { t } = useI18n()
  // W9-C: the ⋯ menu's actions (lib/jobActions), the same confirmations the Jobs card uses
  const ui: ActionUi = {
    t: (key, params) => (t as (k: string, p?: Record<string, string | number>) => string)(key, params),
    confirm: (o) => confirmModal(o),
    confirmChoices: (o) => confirmModalWithChoices(o),
    error: (m, o) => void toast.error(m, o)
  }
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
  const [runConfigs, setRunConfigs] = useState<{ id: string; name: string }[] | null>(null)
  /** 계정 목록. **두 곳이 쓴다** — Task 짓기 폼의 계정 칸(그 Run 의 provider 것만 걸러 넘긴다)과
   *  아래 필터 줄이 지정된 계정의 **이름**을 적는 자리다. 그래서 폼이 열릴 때만이 아니라 창이 열려
   *  있는 동안 들고 있고, 폼을 열 때마다 다시 받는다(그 사이 계정이 늘거나 지워졌을 수 있다).
   *
   *  **로그인 여부는 묻지 않는다**: 이 목록은 "고를 수 있는 것"이고, 고른 계정을 정말 쓸 수 있는지는
   *  띄우는 순간 accountToDispatchOn 이 본다 — 지금 로그아웃돼 있어도 나중에 로그인하면 되는
   *  것이라, 여기서 숨기면 고를 수 없는 이유가 화면에 남지 않는다. */
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  // 계정 목록은 창이 열려 있는 동안 들고 있고 폼을 열 때 다시 받는다(authoring 이 의존성에 있는
  // 이유). 실행 구성과 **따로 둔 이유**: 그쪽은 폼이 닫히면 비우고 이쪽은 비우지 않는다 — 두
  // 수명을 한 effect 에 넣으면 정리 함수가 갈래마다 생겨 읽을 수 없게 된다.
  useEffect(() => {
    let cancelled = false
    // 거부 팔을 둔다 — 실패해도 폼은 쓸 수 있어야 하므로 빈 목록으로 접는다. 그러면 계정 칸이
    // 그려지지 않고(고를 것이 둘 미만) 지정 없이 Task 를 만드는 길이 남는다.
    void door.accounts().then(
      (list) => {
        if (!cancelled) setAccounts(list)
      },
      () => {
        if (!cancelled) setAccounts([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [authoring, door])
  useEffect(() => {
    if (!authoring) {
      setRunConfigs(null) // 다음에 지을 때 다시 받도록 비운다 — 그 사이 설정이 바뀌었을 수 있다
      return
    }
    let cancelled = false
    // 거부 팔을 반드시 둔다 — main 이 프로젝트를 읽다 던질 수 있고, 그러면 DevTools 에
    // Uncaught (in promise) 가 뜬다. 실패해도 폼은 그대로 쓸 수 있어야 하므로(검증 없이 Task 를
    // 만드는 것도 유효한 선택이다) 빈 목록으로 접는다 — "검증 없음" 하나만 남는다.
    void door.runConfigs(runId).then(
      (configs) => {
        // A compound has no command and no exit code of its own — validation's contract is one
        // command, one exit code (see prepareRun's compoundNotRunnable refusal), so it is excluded
        // here rather than offered and then failed every time it runs.
        if (!cancelled)
          setRunConfigs(configs.filter((c) => c.type !== 'compound').map((c) => ({ id: c.id, name: c.name })))
      },
      () => {
        if (!cancelled) setRunConfigs([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [authoring, door, runId])
  /** This computer's completion check plugins for the form (plugin Phase 5 C6), read beside the run configurations and
   *  apart from them: the Host may be slow or down, and the run configurations are offered without waiting for it. A
   *  Runtime's door offers none (C14). null = not read yet. */
  const [checkPlugins, setCheckPlugins] = useState<CheckPluginRow[] | null>(null)
  useEffect(() => {
    if (!authoring) {
      setCheckPlugins(null)
      return
    }
    let cancelled = false
    void door.checkPlugins().then(
      (list) => {
        if (!cancelled) setCheckPlugins(list)
      },
      () => {
        if (!cancelled) setCheckPlugins([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [authoring, door])
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
  /** 띄우기 버튼을 보일 조건 — **넷 다** 참이어야 한다. 한 자리에 모아 두는 것은 하나만
   *  보고 고치면 나머지 조건을 깨뜨리기 쉬워서다.
   *
   *  1) 이 Run 의 동시 실행 한도(없으면 DEFAULT_CONCURRENCY, JobRow 의 주석과 같다)가 1 이하다.
   *     한도가 2 이상인 Run 은 모든 워커가 각자의 워크트리에서 돌고, 사람이 여기서 하나를 띄우면
   *     그것은 Run 워크트리로 간다(worker-start 의 기본값) — 통합 Task 가 도는 바로 그 폴더다.
   *     "병렬인데 한 폴더"라는 금지된 조합이 되고(coordinator/runScheduler 주석), 그 워커가 합칠
   *     자리에 커밋 안 된 변경을 남기면 나머지 워크트리를 합칠 자리가 없어진다. 렌더러는 Task
   *     워크트리의 이름을 지어 줄 수도 없다 — nameForTask(core/worktrees/naming.ts)가 node:path 를
   *     끌고 와 tsconfig.web.json 에 못 들어간다. 그래서 한도 2 이상인 Run 에서는 버튼 자체를 없앤다
   *     (스케줄러가 거기서 띄우는 것을 대신 맡는다). DEFAULT_CONCURRENCY 가 3 이므로 사이드바가
   *     기본값으로 만든 Run 에는 이 버튼이 나오지 않는다 — 대안(프로젝트 폴더로라도 억지로
   *     띄우기)을 만들지 않기로 한 결정이다.
   *
   *  2) **이 조건은 Task 로 내려갔다.** 예전에는 "이 Run 에 provider 가 있다" 였는데, provider 는
   *     이제 Run 이 아니라 Task 의 계정이 정한다. 그래서 같은 판단이 노드마다 필요하고, 아래
   *     showStart 가 그 Task 에 계정이 있는지 본다 — 계정이 없으면 worker-start 에 --agent 로
   *     지목할 provider 가 없어 눌려도 결코 되지 않는다. **schedule.ts 의 slotsToFill 이 이미 같은
   *     판단을 내려 두었다**(계정 없는 Task 는 고르지 않는다). 버튼을 그대로 두고 실패했을 때
   *     안내로 대신하는 것은 틀렸다 — "로그인된 계정이 없다"는 이 경우 거짓이고(계정은 있을 수
   *     있고, 없는 것은 이 Task 의 지정이다), 원인을 잘못 말하는 문구는 문구가 없는 것보다 나쁘다.
   *
   *  3) 이 Run 이 **예약 템플릿이 아니다.** 템플릿은 자신의 Task 를 돌리지 않는다 — 발화가 만든
   *     회차가 돈다. `worker-start` 가 이 조합을 거절하므로(server.ts) 버튼을 두면 서버가 반드시
   *     거절할 동작을 권하는 것이 되고, 무엇보다 그 거절이 없던 동안에는 눌리는 대로 템플릿의
   *     Task 가 terminal 이 되어 TTL 정리가 예약과 모든 회차를 30일 뒤에 지우는 경로가 열려
   *     있었다(store.ts). 이 창은 템플릿에서 **Task 를 짜는 자리**이고 돌리는 자리가 아니다.
   *     회차에서는 그대로 보인다 — 회차는 templateId 를 갖고 schedule 은 갖지 않는다.
   *
   *  4) 이 Run 이 **이미 시작했다** (`pendingStart` 가 없다). '실행' 버튼이 지키는 게이트가
   *     정확히 이것이다 — 사람이 Task 를 다 짜고 누르기 전까지는 아무것도 돌지 않아야 한다.
   *     pendingStart 인 Run 은 아직 워크트리도 없다(runScheduler 가 첫 슬롯을 채울 때 게으르게
   *     만든다) — 이 자리에서 버튼이 살아 있으면 `worker-start` 가 `--worktree` 없이 불려
   *     app-managed Run 을 워크트리 없이 세운 채 거절당하거나(server.ts 의 새 거절), 그 거절이
   *     없다면 프로젝트 폴더에서 돌았을 것이다 — 두 경우 다 '실행' 을 누르기 전에는 아무 노드
   *     버튼도 없어야 한다는 이 게이트의 존재 이유를 어긴다. */
  const canManualStart =
    (run?.concurrency ?? DEFAULT_CONCURRENCY) <= 1 &&
    run !== undefined &&
    run.schedule === undefined &&
    run.pendingStart !== true
  /** 계정을 고른다 — 스케줄러(src/core/orchestration/exec/dispatchLoop.ts 의 runScheduler)와 같은 방법이다: 계정 목록과
   *  로그인 여부를 병렬로 확인한 뒤 defaultAccountIdOf(그 규칙을 정하는 단 하나의 함수)에게
   *  넘긴다. 로그인 조회를 계정마다 차례로 기다리면 계정 수만큼 느려지므로 Promise.all 로 편다. */
  const accountFor = async (
    provider: Provider,
    assigned?: readonly string[]
  ): Promise<string | null> => {
    const list = await door.accounts()
    const loggedIn = await door.signedInIds(list)
    const picked = accountToDispatchOn({
      ...(assigned !== undefined ? { assigned } : {}),
      provider,
      accounts: list,
      loggedInIds: loggedIn
    })
    return picked.ok ? picked.accountId : null
  }

  /** 실행. **사이드바로 만든 Run 은 사람이 이것을 누를 때까지 돌지 않는다** — 예전에는 Task 를
   *  하나 만드는 순간 돌기 시작해서, 나머지를 짜는 동안 첫 Task 의 워커가 이미 일하고 있었다.
   *  게이트는 Run.pendingStart 이고 이 명령이 그것을 걷는다(server.ts 의 run-start).
   *
   *  **버튼은 pendingStart 일 때만 있다** — 코디네이터가 돌리는 Run 에는 그 칸이 없으므로 나타나지
   *  않는다. 앱이 그쪽 Run 을 함께 돌리면 같은 ready Task 를 두고 경합한다(Run.autoDispatch 주석).
   *
   *  실패는 toast 다 — 폼이 없는 단발 액션의 관례(startTask 와 같다). */
  const startRunNow = async (): Promise<void> => {
    setBusy(RUN_START)
    try {
      // W5-C (#40): the Jobs view's "Approve & execute" path: asked first (workers spend quota), and a plan that does
      // not hold is refused with its `problems`
      await approvePlan(door, runId, run ? jobName(run) : runId, ui)
    } catch {
      toast.error(t('jobs.run.startFailed'))
    } finally {
      setBusy(null)
    }
  }

  /** 워커들이 워크트리에 남긴 일을 프로젝트 폴더로 합친다.
   *
   *  **자동으로 하지 않는 것이 이 버튼의 존재 이유다.** 병합은 사용자가 체크아웃해 둔 브랜치의
   *  작업 트리를 바꾸고, 사용자가 그 폴더에서 일하는 중일 수도 있다 — 충돌하면 그 트리가 반쯤
   *  병합된 상태로 남는다. 그래서 그 순간을 사람이 고른다.
   *
   *  성공해도 워크트리를 지우지 않는다(명령 쪽 주석). 폴더 정리는 삭제 모달의 체크박스다.
   *
   *  **`merged` 가 비면 다른 문구를 보인다.** 이 버튼은 `run.worktrees`(발행 cwd 를 센 값, 폴더가
   *  없어져도 줄지 않는다)로 나타나므로, 예약 회차가 걷혔거나 삭제 때 폴더가 이미 지워진 뒤에도
   *  눌릴 수 있다 — 그때 명령은 200 을 내지만 `merged: []` 다(server.ts 의 run-merge). 아무것도
   *  합치지 않았는데 "합쳤습니다" 토스트를 보이면 그 자체가 결함이다. */
  const mergeRunNow = async (): Promise<void> => {
    // **묻고 나서 합친다.** 이것은 사용자가 체크아웃해 둔 브랜치의 작업 트리를 바꾸는 유일한 버튼이고,
    // 되돌리려면 git 을 직접 써야 한다 — 버튼 하나 거리에 두기에는 너무 먼 결과다. 무엇이 일어나는지
    // (워크트리 몇 개가, 어느 자리로, 푸시는 하지 않는다는 것)를 그 자리에서 말한다.
    const count = (run?.worktrees ?? []).length
    if (
      !(await confirmModal({
        title: t('jobs.run.mergeConfirmTitle'),
        body: t('jobs.run.mergeConfirmBody', { count }),
        confirmLabel: t('jobs.run.merge')
      }))
    )
      return
    setBusy(RUN_MERGE)
    try {
      // A Job row's id is the Job's; run-merge needs the Run whose worktrees the button counted.
      const reply = await door.command('run-merge', { run: runIdToMerge(run, runId) })
      if (reply.status >= 400) {
        const reason =
          typeof reply.body === 'object' && reply.body !== null && 'error' in reply.body
            ? String((reply.body as { error: unknown }).error)
            : String(reply.status)
        toast.error(replyNote(reply, t as never, t('jobs.run.mergeFailed', { reason })))
        return
      }
      const merged =
        typeof reply.body === 'object' && reply.body !== null && 'merged' in reply.body
          ? (reply.body as { merged: unknown }).merged
          : undefined
      // **몇 개를 합쳤는지 말한다.** 병합은 화면에 아무 변화를 남기지 않는다(워크트리도 Run 도 그대로
      // 다) — "합쳤습니다" 만으로는 눌린 것인지 확인할 수 없어 사람이 같은 버튼을 여러 번 누른다.
      // 실제로 그랬다. 수는 명령이 돌려준 것이다(사라진 폴더를 건너뛴 뒤의 수), 넘긴 수가 아니다.
      const mergedCount = Array.isArray(merged) ? merged.length : count
      toast.success(
        mergedCount === 0
          ? t('jobs.run.mergeNothing')
          : t('jobs.run.merged', { count: mergedCount })
      )
      // **커밋되지 않은 변경은 합쳐지지 않았다.** git 은 커밋만 옮긴다 — 워커가 파일을 고쳐 놓고
      // 커밋하지 않았으면 그 일은 워크트리에만 있고, 병합을 성공으로 읽은 사람이 폴더를 지우는
      // 순간 사라진다. 앱은 워커에게 커밋을 지시하지만 지켰는지 확인하지 않으므로, 이 자리가 그
      // 사실이 사람에게 닿는 유일한 곳이다.
      //
      // 성공 토스트와 **따로** 띄운다. toast 는 error 만 스스로 사라지지 않으므로(lib/toast) 놓쳐서는
      // 안 되는 쪽을 그것으로 보낸다 — 문구가 실패가 아니라 남은 것을 말한다.
      const uncommitted =
        typeof reply.body === 'object' && reply.body !== null && 'uncommitted' in reply.body
          ? (reply.body as { uncommitted: unknown }).uncommitted
          : 0
      if (typeof uncommitted === 'number' && uncommitted > 0)
        toast.error(t('jobs.run.mergeUncommitted', { count: uncommitted }))
      // git status did not answer for these worktrees — their uncommitted changes are unknown, not 0,
      // and the same folder-deletion risk applies, so this is said just as loudly.
      const unchecked =
        typeof reply.body === 'object' && reply.body !== null && 'uncommittedUnchecked' in reply.body
          ? (reply.body as { uncommittedUnchecked: unknown }).uncommittedUnchecked
          : undefined
      if (Array.isArray(unchecked) && unchecked.length > 0)
        toast.error(t('jobs.run.mergeUncommittedUnknown', { count: unchecked.length }))
    } catch {
      toast.error(t('jobs.run.mergeFailed', { reason: '' }))
    } finally {
      setBusy(null)
    }
  }

  /** 띄우기. ready·pending 에서만 보이고(Graph.node), canManualStart 가 아니면 버튼 자체가 없다.
   *  **worktree 를 보내지 않는다** — 이 버튼은 워커가 어디서 도는지를 정하지 않는다. 그 결정은
   *  Run 의 것이고 worker-start 안에 산다(server.ts 의 기본값: 이 Run 의 워크트리). */
  const startTask = async (taskId: string): Promise<void> => {
    setBusy(taskId)
    try {
      // **이 Task 에 지정된 계정을 지킨다.** 스케줄러와 같은 판정을 쓴다(accountToDispatchOn) —
      // 두 경로가 다른 계정을 고르면 같은 Task 가 누가 띄웠는지에 따라 다른 계정에서 돌게 된다.
      // 지정이 목록이면 그 첫 계정으로 띄운다(판정이 그렇게 답한다) — 갈아탈 순서는 이 명령이
      // 정하지 않는다: worker-start 를 받은 배선이 Task.accountIds 로 체인을 만든다(ipc.ts).
      //
      // **provider 도 그 첫 계정에서 나온다**(Task.accountIds). 계정 없는 Task 는 showStart 가
      // 이미 버튼을 지워 이 자리에 닿지 못한다 — 아래 확인은 그 상태가 불가능함을 다시 강제하는
      // 것이 아니라, 페인트와 클릭 사이에 스냅숏이 바뀌는 좁은 창에 대한 방어다.
      const assigned = tasks.find((tk) => tk.id === taskId)?.accountIds
      const first = assigned?.length ? (accounts ?? []).find((a) => a.id === assigned[0]) : undefined
      const provider = first ? providerOf(first) : null
      const accountId = provider ? await accountFor(provider, assigned) : null
      if (!provider || !accountId) {
        // 폼이 없는 단발 액션의 실패라 toast 로 보낸다(gateError 의 주석과 같은 규칙) —
        // 계정을 못 찾은 경우도 같은 안내다(worker-start 를 부를 수 없다는 결과가 같다).
        toast.error(t('session.resume.noLoggedInAccounts'))
        return
      }
      const reply = await door.command('worker-start', {
        taskId,
        agent: provider,
        account: accountId
      })
      if (reply.status >= 400) toast.error(replyNote(reply, t as never, t('jobs.node.failed')))
    } catch {
      toast.error(t('jobs.node.failed'))
    } finally {
      setBusy(null)
    }
  }

  /** 멈추기. **worker-stop 은 Task id 가 아니라 Dispatch id 를 요구한다**(server.ts 의
   *  `str(args.dispatch)`) — 그래서 dispatch-show 로 이 Task 의 열린 Dispatch 를 먼저 찾는다.
   *  dispatch-show 는 읽기만 하는 명령이지만 "UI 는 orch.command 만 부른다" 규칙과 부딪히지
   *  않는다 — 그 규칙은 오케스트레이션 상태를 바꾸는 통로에 대한 것이고, 이 조회는 CLI 도 쓰는
   *  같은 명령 표면을 그대로 쓸 뿐 새 통로를 열지 않는다. */
  const stopTask = async (taskId: string): Promise<void> => {
    setBusy(taskId)
    try {
      const shown = await door.command('dispatch-show', { task: taskId })
      if (shown.status >= 400) {
        toast.error(t('jobs.node.failed'))
        return
      }
      const open = (shown.body as Dispatch[]).find((d) => !d.outcome && !d.endedAt)
      // 멈추기 버튼은 열린 Dispatch 가 있을 때만 보이므로(provider 의 유무로 안다) 보통은
      // 반드시 찾는다 — 그 사이 워커가 스스로 끝났을 수는 있으니 방어적으로만 확인한다.
      if (!open) {
        toast.error(t('jobs.node.failed'))
        return
      }
      const reply = await door.command('worker-stop', { dispatch: open.id })
      // The refusal's own words, not only "could not": a stop refused because the worker is still
      // starting, or because the Host could not confirm the kill, says what to do next.
      if (reply.status >= 400) {
        const why = (reply.body as { error?: unknown } | null)?.error
        toast.error(replyNote(reply, t as never, typeof why === 'string' ? t('jobs.node.stopFailed', { detail: why }) : t('jobs.node.failed')))
      }
    } catch (err) {
      toast.error(t('jobs.node.stopFailed', { detail: errText(err) }))
    } finally {
      setBusy(null)
    }
  }

  /** 자동 수정 중지 (설계 §4.1 의 V3). 명세 §29 의 `Stop Auto-Fix` 다.
   *
   *  **묻고 나서 멈춘다.** 되돌릴 수 없다 — 서버에 `--convergence on` 이 없다("Task 는 Run 을
   *  따른다"). 되돌릴 수 없는 버튼을 클릭 한 번 거리에 두지 않는 것은 위 mergeRunNow 와 같은
   *  규칙이고, 확인 창이 그 사실을 말하는 것이 이 창이 있는 이유다. 함께 말하는 둘째: 지금 도는
   *  수리는 끝까지 가고 그 판정이 Gate 로 온다 — 누르는 순간 워커가 죽는 것이 아니다. */
  const stopConvergence = async (taskId: string): Promise<void> => {
    if (
      !(await confirmModal({
        title: t('jobs.convergence.stopConfirmTitle'),
        body: t('jobs.convergence.stopConfirmBody'),
        confirmLabel: t('jobs.convergence.stop')
      }))
    )
      return
    setBusy(taskId)
    try {
      const reply = await door.command('task-update', {
        id: taskId,
        convergence: 'off'
      })
      if (reply.status >= 400) toast.error(replyNote(reply, t as never, t('jobs.node.failed')))
    } catch {
      toast.error(t('jobs.node.failed'))
    } finally {
      setBusy(null)
    }
  }

  /** 다시 띄우기. task-update 로 상태를 ready 로 되돌린다 — 전이표(dispatched 에는 dispatched 가
   *  없다)를 일부러 우회하는 사람의 손보기 명령이다. **대가:** consecutiveFailures 도 함께 0 으로
   *  돌아간다 — task-update 가 회로 차단을 여는 유일한 길이라 그렇게 만들어져 있다. 실패 횟수를
   *  건드리지 않고 상태만 되돌리려면 명령 표면을 나눠야 하고, 이 슬라이스는 그것을 하지 않는다. */
  const restartTask = async (taskId: string): Promise<void> => {
    setBusy(taskId)
    try {
      const reply = await door.command('task-update', {
        id: taskId,
        status: 'ready'
      })
      if (reply.status >= 400) toast.error(replyNote(reply, t as never, t('jobs.node.failed')))
    } catch {
      toast.error(t('jobs.node.failed'))
    } finally {
      setBusy(null)
    }
  }

  /** 물어보기의 제출. asking 이 성공했을 때만 null 로 돌아간다 — NewTaskModal.onCreated 와 같은
   *  관례로, 실패하면 폼(과 이미 쓴 질문)이 그대로 남아야 사람이 다시 쓰지 않아도 된다. 이
   *  실패만 인라인(gateError)이다 — 이 액션에는 폼이 있고, 나머지 셋에는 없다. */
  const askQuestion = async (): Promise<void> => {
    const taskId = asking
    const trimmed = question.trim()
    if (taskId === null || !trimmed) return
    setBusy(taskId)
    setGateError(null)
    try {
      const reply = await door.command('gate-create', {
        task: taskId,
        question: trimmed
      })
      if (reply.status >= 400) {
        setGateError(replyNote(reply, t as never, t('jobs.node.failed')))
        return
      }
      setAsking(null)
      setQuestion('')
    } catch {
      setGateError(t('jobs.node.failed'))
    } finally {
      setBusy(null)
    }
  }

  /** 물어보기 폼을 닫는다(취소든 배경 클릭이든) — busy 인 동안은 막는다. NewTaskModal.tsx 의
   *  `!busy && onClose()` 와 같은 관례다: 제출이 도는 동안 닫으면 그 요청이 끝났을 때 아무도
   *  결과를 보지 못한다. */
  const cancelAsk = (): void => {
    if (busy !== null) return
    setAsking(null)
    setQuestion('')
  }

  /** Gate 에 답한다. **선택지 버튼도 이것을 부른다** — 그 버튼은 라벨이 아니라 선택지 값을 resolution 으로
   *  보낸다(GateAnswer: a check-unavailable or exhausted choice is shown in this app's words, and sent as its option).
   *
   *  풀린 뒤 Task 를 어디로 보낼지는 core 가 이미 정해 두었다(resolveGate) — blocked 에서 곧바로
   *  ready 로 올리지 않고 pending 으로 내린 뒤 recomputeReady 가 판단한다. 여기서 그 판단을
   *  다시 하지 않는다.
   *
   *  askQuestion 과 같은 관례: 성공했을 때만 폼을 닫는다. 실패하면 쓴 답이 남아야 다시 쓰지 않는다. */
  const resolveGate = async (gateId: string, resolution: string): Promise<void> => {
    const taskId = answering
    const trimmed = resolution.trim()
    if (taskId === null || !trimmed) return
    setBusy(taskId)
    setGateError(null)
    try {
      const reply = await door.command('gate-resolve', {
        id: gateId,
        resolution: trimmed
      })
      if (reply.status >= 400) {
        setGateError(replyNote(reply, t as never, t('jobs.node.failed')))
        return
      }
      // 설계 §5(V4): 소진 Gate 에 "한 번 더 수정" 으로 답했는데 그 수정을 열지 못하는 경우가 있다 —
      // 이 Task 를 막는 다른 Gate 가 이미 열려 있으면 repairOnce 는 아무것도 열지 못한다. 서버는 이
      // Gate 자체는 정상적으로 풀렸으므로 200 을 주고, 그 사실을 본문에만 싣는다(server.ts 의
      // gate-resolve). 그 본문을 여기서 버리던 동안, 사람이 누른 버튼은 아무 일도 하지 않은 채
      // 성공한 것처럼 보였다 — 이 화면이 지금 하는 유일한 거짓말이었다.
      //
      // Gate 는 실제로 풀렸으므로 answering 은 닫는다. 남기면 이미 없는 Gate 에 다시 답하라고
      // 내미는 꼴이 된다. 실패는 그 옆에 남는 줄로 말한다.
      const body = reply.body as { retryOnceFailed?: unknown } | null
      const retryFailed = typeof body?.retryOnceFailed === 'string' ? body.retryOnceFailed : null
      setAnswering(null)
      setAnswer('')
      if (retryFailed !== null) {
        setGateError(t('jobs.convergence.retryOnceFailed', { reason: retryFailed }))
        return
      }
    } catch {
      setGateError(t('jobs.node.failed'))
    } finally {
      setBusy(null)
    }
  }

  const cancelAnswer = (): void => {
    if (busy !== null) return
    setAnswering(null)
    setAnswer('')
  }
  /** The graph's "Ask" and "Answer" buttons open their form; nothing is sent until it is submitted. */
  const openAsk = (taskId: string): void => {
    setAsking(taskId)
    setQuestion('')
    setGateError(null)
  }
  const openAnswer = (taskId: string): void => {
    setAnswering(taskId)
    setAnswer('')
    setGateError(null)
  }

  return {
    ui, accounts, runConfigs, checkPlugins, authoring, setAuthoring, asking, question, setQuestion, answering, answer, setAnswer,
    busy, gateError, authoringOpen, formOpen, canManualStart,
    startRunNow, mergeRunNow, startTask, stopTask, stopConvergence, restartTask,
    askQuestion, cancelAsk, resolveGate, cancelAnswer, openAsk, openAnswer
  }
}
