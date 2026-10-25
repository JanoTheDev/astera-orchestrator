// The plan page's commands (moved out of pages/PlanPage.tsx): approve and start, merge, and the graph nodes' start,
// stop, ask, answer, restart and stop-auto-fix. Each goes through the door; the state they set is usePlanPage's.
import type { Account, JobRow, JobTask, Provider } from '../../../../core/types'
import type { MessageKey, MessageParams } from '../../../../core/i18n'
import { accountToDispatchOn } from '../../../../core/accounts/dispatchAccount'
import { providerOf } from '../../../../core/providers/meta'
import type { Dispatch } from '../../../../core/orchestration/types'
import { runIdToMerge } from '../../../../core/orchestration/snapshot'
import { replyNote, type CommandReply, type OrchDoor } from '../../lib/orchDoor'
import { confirmModal } from '../../lib/confirm'
import { approvePlan, type ActionUi } from '../../lib/jobActions'
import { toast } from '../../lib/toast'
import { errText } from '../../hooks/useFileOps'
import { jobName } from '../../lib/jobName'
import { openConsole } from '../shell/navigation'
import { RUN_MERGE, RUN_START } from './planPage'
import { askAboutTask } from './taskConsole'

/** What `run-integrate-all` answered (command.ts): delivered, stopped with the delivery's error, handed its conflicts to the
 *  AI merge Task `taskId`, or refused (a 409 names the worktrees it could not merge). */
export type IntegrateAllOutcome =
  | { state: 'delivered' }
  | { state: 'stopped'; error?: string }
  | { state: 'fixing-conflicts'; taskId: string }
  | { state: 'refused'; error?: string }

/** The owner's way out of a stuck Task: Continue a Task held for them (blocked with no Gate: dispatchLoop holdForOwner),
 *  Retry a failed one, Restart one whose agent was stopped (dispatched with no running Dispatch: `provider` is only set
 *  while one runs, as PlanGraph reads it). A blocked Task with a Gate keeps its Answer flow. All go through restartTask. */
export function taskActionOf(task: Pick<JobTask, 'status' | 'gate' | 'provider'>): 'continue' | 'retry' | 'restart' | undefined {
  if (task.status === 'failed') return 'retry'
  if (task.status === 'blocked' && task.gate === undefined) return 'continue'
  if (task.status === 'dispatched' && task.provider === undefined) return 'restart'
  return undefined
}

/** The button label of a taskActionOf action; Restart shares the graph node's label. */
export function taskActionKey(action: 'continue' | 'retry' | 'restart'): MessageKey {
  return action === 'restart' ? 'jobs.node.restart' : `plan.task.${action}`
}

/** "Ask about this task" (the row's button and the Plans tree's menu): a chat session on the finished Task, its tab opened,
 *  or a toast saying why not. */
export async function askAboutTaskWithToast(door: Pick<OrchDoor, 'command'>, runId: string, taskId: string, t: (key: MessageKey, params?: MessageParams) => string): Promise<void> {
  const r = await askAboutTask(door, runId, taskId, (id) => {
    // shortcut: the tab arrives through session:created, which can land after the reply; openConsole ignores a tab it
    // does not have yet, so it is tried twice, not awaited (as RunConfigManager does).
    setTimeout(() => openConsole(id), 300)
    setTimeout(() => openConsole(id), 1500)
  })
  if (!r.ok) toast.error(t('plan.done.askFailed', { detail: r.error }))
}

export function integrateAllOutcomeOf(reply: CommandReply): IntegrateAllOutcome {
  const b = (reply.body ?? {}) as { state?: unknown; taskId?: unknown; error?: unknown }
  const error = typeof b.error === 'string' ? b.error : undefined
  if (b.state === 'fixing-conflicts' && typeof b.taskId === 'string') return { state: 'fixing-conflicts', taskId: b.taskId }
  if (b.state === 'stopped') return { state: 'stopped', ...(error ? { error } : {}) }
  if (reply.status < 400) return { state: 'delivered' }
  return { state: 'refused', ...(error ? { error } : {}) }
}

type T = (key: MessageKey, params?: MessageParams) => string

/** Builds the commands over the page's state. Not a hook: it holds no state of its own. */
export function planCommands({
  t,
  ui,
  door,
  run,
  runId,
  tasks,
  accounts,
  asking,
  question,
  answering,
  busy,
  setBusy,
  setGateError,
  setAsking,
  setQuestion,
  setAnswering,
  setAnswer
}: {
  t: T
  ui: ActionUi
  door: OrchDoor
  run: JobRow | undefined
  runId: string
  tasks: readonly JobTask[]
  accounts: Account[] | null
  asking: string | null
  question: string
  answering: string | null
  busy: string | null
  setBusy: (v: string | null) => void
  setGateError: (v: string | null) => void
  setAsking: (v: string | null) => void
  setQuestion: (v: string) => void
  setAnswering: (v: string | null) => void
  setAnswer: (v: string) => void
}) {
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
  return { startRunNow, mergeRunNow, startTask, stopTask, stopConvergence, restartTask, askQuestion, cancelAsk, resolveGate, cancelAnswer }
}
