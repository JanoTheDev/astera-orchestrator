import type { JobTask, RunOutcome, RunStuck } from '../types'
import { coordinatorStarting, jobOf, type OrchState } from './state'
import { FAILURE_LIMIT, type Dispatch, type Gate, type Job, type JobRun, type Task } from './types'
import { completionSettled, replanOn } from './replan'
import { jobActive } from './schedule'

// tasksOwnedBy, isTerminal and outcomeOf moved here from view.ts so runningRunCount can ask outcomeOf:
// the renderer's build includes this file and not view.ts, which re-exports them.

/** ownerId 는 회차의 id 이거나, 아직 회차가 없는 Job 의 id 다 — 뒤쪽이면 정의 Task 를 센다.
 *  두 id 는 접두사가 달라(`job_`·`run_`) 섞일 수 없다. */
export const tasksOwnedBy = (state: OrchState, ownerId: string): Task[] =>
  state.tasks.filter((t) => t.runId === ownerId || t.jobId === ownerId)

/** Task 가 더 움직이지 않는가.
 *
 *  failed 는 그것만으로 terminal 이 아니다 — 전이표(types.ts)의 `failed: ['dispatched', 'blocked']`
 *  가 말하듯 실패한 Task 는 재시도되고, 그것이 FAILURE_LIMIT 까지의 정상 흐름이다. view.ts 의
 *  progressOf 가 같은 이유로 failed 를 완료로 세지 않는다. 재시도가 소진되어야(연속 실패가
 *  FAILURE_LIMIT) 더 움직이지 않는다. */
export const isTerminal = (t: Task): boolean =>
  t.status === 'completed' || (t.status === 'failed' && t.consecutiveFailures >= FAILURE_LIMIT)

/** Run 이 끝났는지, 끝났다면 성공인지 실패인지.
 *
 *  **저장된 값이 아니라 파생이다.** 명시적인 close 명령을 두면 코디네이터가 그것을 부른다는
 *  규율에 기대게 되고, 잊으면 화면은 지금과 똑같아진다.
 *
 *  terminal 의 정의는 store.ts 의 TTL 정리와 **일부러 다르다.** 그쪽은 30일간 아무 일도 없었던
 *  Run 을 버릴지 정하는 자리라 재시도 중인 Task 가 있을 수 없고, 재시도가 남았는지 여부가 결과를
 *  바꾸지 않는다. 여기는 지금 도는 Run 에 라벨을 붙이는 자리다 — 두 번째 시도를 기다리는 Task 를
 *  '실패'로 적으면 다음 시도에서 라벨이 사라진다. 같은 상수로 묶지 말 것.
 *
 *  Task 가 없으면 running: Run 만 만들고 Task 를 아직 만들지 않은 상태가 정상적인 시작 지점이다.
 *  every 는 빈 배열에 참이므로, 이 가드가 없으면 방금 만든 Run 이 completed 로 보인다.
 *  (store.ts 가 같은 이유로 own.length > 0 을 두고 있다.)
 *
 *  failed 가 completed 를 이긴다 — 사람이 손봐야 하는 Run 을 목록에서 바로 찾을 수 있어야 한다.
 *
 *  대가: 모두 끝난 뒤 Task 가 추가되면 completed 가 running 으로 되돌아간다. 진행률 숫자도 같은
 *  방식으로 움직이므로 정직한 표시라고 본다. */
export function outcomeOf(state: OrchState, runId: string): RunOutcome {
  return outcomeOfRun(tasksOwnedBy(state, runId), state.runs.find((r) => r.id === runId), state)
}

/** Why a Run's delivery failed (a merge conflict or a refused push, `run.pr.error` or `run.delivery.error`), or
 *  undefined. A later successful delivery replaces the record, so the error is gone with it. T1: a delivery that ended
 *  (delivered, by the owner, or dismissed by them) never reads failed, whatever error a record still holds. */
export const deliveryErrorOf = (run: JobRun | undefined): string | undefined =>
  run?.deliveryState !== undefined && SETTLED.has(run.deliveryState.state) ? undefined : (run?.pr?.error ?? run?.delivery?.error)
const SETTLED = new Set<string>(['delivered', 'delivered-by-owner', 'dismissed'])

/** What a Run reads: its Tasks' outcome, except that a plan whose work did not get delivered did not complete, and a
 *  plan whose final check has not settled is `checking`, not completed (item 8: "Plan done" was read, then the check
 *  reopened the plan). Only `outcomeOfTasks` says whether the Tasks are done, which is what the delivery itself asks (it
 *  must still see them completed to retry, and a failed outcome would take the failed-plan branches). */
export function outcomeOfRun(tasks: readonly Task[], run: JobRun | undefined, s: OrchState): RunOutcome {
  const lost = lostTasksOutcome(s, run, tasks)
  if (lost !== undefined) return lost
  const outcome = outcomeOfTasks(tasks, s.gates)
  if (outcome !== 'completed') return outcome
  if (deliveryErrorOf(run) !== undefined) return 'failed'
  return run !== undefined && checkPending(s, run) ? 'checking' : outcome
}

/** Delivered: the Run pushed its work (a sha, no error), or opened its pull request (a url, not a draft, no error) or
 *  left its work on a branch with no remote (`pr.note`, W7-E). after.ts `afterStandOf` reads the same. */
export function runDelivered(run: JobRun): boolean {
  if (run.delivery?.sha !== undefined && run.delivery.error === undefined) return true
  const pr = run.pr
  return pr !== undefined && pr.error === undefined && pr.draft === undefined && (pr.url !== undefined || pr.note !== undefined)
}

/** T15: what a Run with no Task reads, or undefined while `outcomeOfTasks` answers (running: Tasks can still come).
 *
 *  - **A delivery record** (a pushed branch, a pull request draft or not, an end delivery) comes only after a Task ran,
 *    so its Tasks were lost from the store (the 2026-10-22 `reset --tasks` wipe left 30 such Runs). Delivered reads
 *    completed, anything else failed, which puts it before the owner. Only an open replan can add Tasks to it.
 *  - **No record**: running, like a Run just made. `stuckOf` says when nothing can add Tasks to it: needs-you while the
 *    owner's ▶ can start its coordinator (`awaitsCoordinator`), stalled once nobody can.
 *
 *  `deliveryState` alone is no evidence: it is pending once a Run is seen running. Every reader of a Run's outcome goes
 *  through this: `outcomeOfRun` (`astera jobs list`, the Jobs view), mainPlan `planOutcomeOf`, after.ts `jobFinished`. */
export function lostTasksOutcome(s: Pick<OrchState, 'jobs'>, run: JobRun | undefined, tasks: readonly Task[]): RunOutcome | undefined {
  if (run === undefined || tasks.length > 0 || !hasDeliveryRecord(run)) return undefined
  if (s.jobs.find((j) => j.id === run.jobId)?.replanning !== undefined) return undefined
  return runDelivered(run) || (run.deliveryState !== undefined && SETTLED.has(run.deliveryState.state)) ? 'completed' : 'failed'
}

/** Whether a Run's end delivery is over, so the driving loop delivers it no more (dispatchLoop.ts
 *  openCompletedRunPrs): pushed, a pull request opened ready (or merged or closed on GitHub), or its work left on a
 *  branch with no remote. A draft opened between waves is not: it is finished at the end. */
export const deliveryEnded = (run: JobRun): boolean =>
  run.delivery?.sha !== undefined || run.pr?.note !== undefined || run.pr?.landed !== undefined || (run.pr?.url !== undefined && run.pr.draft !== true)

const hasDeliveryRecord = (run: JobRun): boolean => run.pr !== undefined || run.delivery !== undefined || run.branchPush !== undefined

/** A Run of an open plan with a coordinator account and no coordinator attached or starting: the owner's ▶
 *  (`coordinatorMissing`, run-start) or `runs resume` starts one, which can still add Tasks. `stuckOf` flags an empty one
 *  needs-you, since nothing else moves it. */
const awaitsCoordinator = (run: JobRun, job: Job | undefined): boolean =>
  job !== undefined &&
  job.archivedAt === undefined &&
  job.coordinatorAccountId !== undefined &&
  run.coordinatorSessionId === undefined &&
  run.externalCoordinatorSessionId === undefined &&
  run.coordinatorStartingAt === undefined

/** Whether a Run whose Tasks all completed still waits on its final check (replan.ts `completionSettled`): only for a
 *  plan that replans and could run one now (`replansDue`'s own conditions), and not once the plan was delivered, so
 *  history from before the check existed reads completed. */
function checkPending(s: OrchState, run: JobRun): boolean {
  const job = jobOf(s, run)
  if (!job || !replanOn(job) || !jobActive(job) || run.paused === true) return false
  if (run.delivery !== undefined || (run.pr !== undefined && run.pr.draft !== true)) return false
  return !completionSettled(s, job, run.id)
}

/** A Task held for its owner: blocked with no open Gate, so no answer moves it on. A hands-off plan holds a Task so when
 *  it refuses an owner-only decision the Task needs, or gives up on a Gate it kept answering (exec/dispatchLoop.ts);
 *  only the owner moves it again (`task-update --status ready`). A Task blocked on an open Gate waits on an answer. */
export const heldForOwner = (t: Task, gates: readonly Gate[]): boolean =>
  t.status === 'blocked' && !gates.some((g) => g.taskId === t.id && g.status === 'open')

/** The Tasks held for their owner and every unfinished Task waiting on one, directly or through others: none of them
 *  moves until the owner does, so they hold back neither a later wave (replan.ts) nor the Run's end. */
export function heldBack(tasks: readonly Task[], gates: readonly Gate[]): Set<string> {
  const out = new Set(tasks.filter((t) => heldForOwner(t, gates)).map((t) => t.id))
  for (let grew = out.size > 0; grew; ) {
    grew = false
    for (const t of tasks)
      if (!out.has(t.id) && t.status !== 'completed' && t.deps.some((d) => out.has(d))) {
        out.add(t.id)
        grew = true
      }
  }
  return out
}

/** outcomeOf for Tasks already gathered (the Jobs sidebar fold indexes them once, performance audit M1). With the
 *  state's `gates`, a Run whose other Tasks all ended but some are held for the owner (`heldBack`) is `blocked`: it
 *  ended with work left that only the owner can release. Without them a held Task reads as still running. */
export function outcomeOfTasks(tasks: readonly Task[], gates?: readonly Gate[]): RunOutcome {
  if (tasks.length === 0) return 'running'
  const held = gates === undefined ? new Set<string>() : heldBack(tasks, gates)
  if (!tasks.every((t) => isTerminal(t) || held.has(t.id))) return 'running'
  if (tasks.some((t) => t.status === 'failed')) return 'failed'
  return held.size > 0 ? 'blocked' : 'completed'
}

/** T8 (decision 7): why a Run that reads `running` has nothing that can move, or undefined while something can.
 *
 *  Something can move while the Run has an open Dispatch that is not waiting on a question, a Task the app or a
 *  coordinator can take up (ready, pending on deps that will finish, validating, reviewing, merging, dispatched), a
 *  planner replanning it, or, for a failed Task, a coordinator to retry it (`worker-start --retry-of`; no other path
 *  retries a failed Task). What is left is stuck: Tasks waiting on the owner (blocked, or a worker's open question no
 *  coordinator answers), failed Tasks with tries left and no coordinator, and the pending Tasks behind either.
 *  `needs-you` when any of them waits on the owner (an answer moves it), else `stalled` (`runs doctor`). */
export function stuckOf(
  s: OrchState,
  run: JobRun,
  tasks: readonly Task[] = tasksOwnedBy(s, run.id),
  /** The fold's own (view.ts reads each list a fixed number of times, performance audit M1); built here when absent */
  ix?: StuckIndex,
  job = jobOf(s, run)
): RunStuck | undefined {
  if (outcomeOfRun(tasks, run, s) !== 'running') return undefined
  if (job?.replanning !== undefined) return undefined
  const coordinator = run.coordinatorSessionId !== undefined || run.externalCoordinatorSessionId !== undefined
  // A Run with no Tasks is how a start reads before its planner or coordinator makes any: it waits on the owner's ▶ while
  // one can be started, and is dead once none works on it, no start is pending (approval) or held, and the owner did not pause it
  if (tasks.length === 0) {
    if (run.paused === true) return undefined
    if (awaitsCoordinator(run, job)) return 'needs-you'
    return !coordinator && !coordinatorStarting(run, Date.now()) && job !== undefined && !job.pendingStart && job.startWait === undefined && jobActive(job) ? 'stalled' : undefined
  }
  // Work the app or a coordinator takes up as it is: no list read needed to say the Run can move
  if (tasks.some((t) => t.status === 'ready' || t.status === 'validating' || t.status === 'reviewing' || t.status === 'merging')) return undefined
  const { open, asked: askedIds } = ix ?? stuckIndexOf(s)
  const asked = (t: Task): boolean => {
    const d = open.get(t.id)
    return d !== undefined && askedIds.has(d.id)
  }
  const owner = new Set<string>()
  const stuck = new Set<string>()
  for (const t of tasks) {
    if (t.status === 'blocked' || (!coordinator && asked(t))) owner.add(t.id)
    else if (t.status === 'failed' && !coordinator && !open.has(t.id)) stuck.add(t.id)
  }
  for (const id of owner) stuck.add(id)
  // The pending Tasks behind a stuck one cannot start either
  for (let grew = true; grew; ) {
    grew = false
    for (const t of tasks)
      if (t.status === 'pending' && !stuck.has(t.id) && t.deps.some((d) => stuck.has(d))) {
        stuck.add(t.id)
        grew = true
      }
  }
  if (stuck.size === 0 || !tasks.every((t) => isTerminal(t) || stuck.has(t.id))) return undefined
  return owner.size > 0 ? 'needs-you' : 'stalled'
}

/** What `stuckOf` reads off the lists: each Task's open Dispatch, and the Dispatches with an unanswered question. */
export interface StuckIndex {
  open: Map<string, Dispatch>
  asked: Set<string>
}
export function stuckIndexOf(s: OrchState): StuckIndex {
  const open = new Map<string, Dispatch>()
  for (const d of s.dispatches) if (!d.outcome && !d.endedAt) open.set(d.taskId, d)
  const asked = new Set<string>()
  for (const m of s.messages) if (m.type === 'question' && !m.answered && m.dispatchId !== undefined) asked.add(m.dispatchId)
  return { open, asked }
}

/** Whether a Task's latest Dispatch is a reviewer that has ended: a stopped reviewer, which leaves its Task `reviewing`
 *  with nothing to finish it (T8). A review start in flight has no review Dispatch yet, so it does not read so. */
export function reviewerEnded(dispatches: readonly Dispatch[], taskId: string): boolean {
  let last: Dispatch | undefined
  for (const d of dispatches) if (d.taskId === taskId && (last === undefined || d.startedAt.localeCompare(last.startedAt) >= 0)) last = d
  return last?.review === true && (last.endedAt !== undefined || last.outcome !== undefined)
}

/** 지금 일이 도는 Task 의 개수. 사이드바의 `+N` 과 두 화면(JobsView·RunDetail)의 머리 숫자가
 *  이것을 센다. 렌더러가 아니라 여기 있는 이유는 elapsed.ts 와 같다 — 렌더러에 테스트가 없어서,
 *  이 규칙은 테스트가 닿는 자리에 있어야 한다. 실제로 이 함수는 그 이유 때문에 생겼다: 규칙이
 *  렌더러에 있던 동안 같은 결함이 두 화면에 각각 복사되어 있었고, 둘이 똑같이 틀려서 "두 화면이
 *  같은 숫자를 적는가"를 보는 확인마저 통과했다.
 *
 *  **상태만으로는 답이 안 된다.** worker-stop 은 세션을 닫고 Task 는 일부러 그대로 둔다
 *  (server.ts: "The Task is left alone — the orchestrator looks at worker-show and decides for
 *  itself"). 그래서 상태로 세면 껐는데도 dispatched 인 Task 가 계속 도는 것으로 세어져, 워커를 다
 *  끈 Run 이 줄 하나 없이 `+4` 를 세운다.
 *
 *  **열린 Dispatch 로만 세도 답이 안 된다.** 앱이 하는 일에는 세션이 없다:
 *  - validating — 검증은 앱이 돌린다(ipc.ts 의 validator). 세션이 아예 없어서, Dispatch 로 세면
 *    검증만 남은 Run 이 화면에서 사라진다.
 *  - reviewing — 상태가 먼저 바뀌고 검토 세션이 async 로 뒤따라 뜬다(ipc.ts 의 void startReview).
 *    그 틈에 0 으로 떨어지면 검토가 시작될 때마다 숫자가 깜빡인다.
 *
 *  그래서 **dispatched 만 열린 Dispatch 를 요구한다** — worker-stop 이 어긋내는 상태가 그 하나다.
 *  열린 Dispatch 의 증거로 startedAt 을 쓴다: view.ts 의 jobTaskOf 가 provider·startedAt 을 열린
 *  Dispatch 에서만 싣고, JobTask.provider 의 주석이 그것을 "A Dispatch that has ended does not
 *  count" 로 적어 두었다.
 *
 *  **The stopped reviewer** (T8, once the gap left here): reviewing with no open Dispatch is "about to start" or
 *  "stopped". The projection now carries which (`JobTask.reviewerEnded`, running.ts `reviewerEnded`): a review start
 *  in flight has no review Dispatch yet and still counts, so the number does not blink; an ended reviewer does not. */
export function runningCount(tasks: readonly JobTask[]): number {
  return tasks.filter((t) =>
    t.status === 'dispatched'
      ? t.startedAt !== undefined
      : t.status === 'validating' || (t.status === 'reviewing' && t.reviewerEnded !== true) || t.status === 'merging'
  ).length
}

/** 워커가 멈춰 세워진 Task — `dispatched` 인데 열린 Dispatch 가 없다. worker-stop 이 만드는 상태다:
 *  releaseWorker 가 killSession 으로 세션을 정말 죽이고(coordinator.ts), Task 는 일부러 그대로
 *  둔다(server.ts). 그래서 이 Task 는 "워커에게 넘어갔고 아직 결론이 없다"인데 **일하는 워커는
 *  없다.**
 *
 *  글리프 문구가 이것을 물어야 하는 이유: 상태 문구는 `dispatched` 를 "워커가 일하는 중"이라고
 *  적는데, 그 말이 이 상태에서는 거짓이다. 회전 자체는 거짓이 아니다 — 그것은 "결론이 나지 않았다"로
 *  읽히고 그것은 맞다. 거짓인 것은 살아 있는 워커를 약속하는 낱말 쪽이다.
 *
 *  runningCount 와 같은 파일에 있는 이유는 **같은 질문**이기 때문이다. 이것을 렌더러에 두면 그
 *  질문의 답이 다시 두 벌이 된다 — 개수가 두 화면에 복사되어 똑같이 틀렸던 것이 그 결과였다. */
export function isStoppedWorker(t: JobTask): boolean {
  return t.status === 'dispatched' && t.startedAt === undefined
}

/** 지금 일이 도는 회차의 수 — `astera host stop` 이 거절할 때 세는 값이다(ruling F57).
 *
 *  **`runningCount` 와 같은 질문을 같은 규칙으로 답한다**, 입력만 다르다: 저쪽은 화면에 실려 간
 *  `JobTask` 투영을 보고 이쪽은 상태 원본을 본다. 규칙을 따로 쓰면 화면이 "도는 중" 이라고 적은
 *  회차를 Host 가 멈춰도 되는 것으로 읽는 날이 온다.
 *
 *  그래서 판정도 그대로다: `validating`·`reviewing` 은 세션 없이 앱이 도는 일이라 그 자체로 세고,
 *  `dispatched` 는 **열린 Dispatch 를 요구한다** — worker-stop 이 세션을 죽이고 Task 는 일부러
 *  그대로 두므로(server.ts), 상태만 보면 다 꺼 놓은 회차가 영원히 "도는 중" 이 된다.
 *
 *  **아직 시작하지 않은 계획은 세지 않는다.** Task 가 전부 pending·ready 인 회차는 사람이 Host 를
 *  멈추는 것을 막을 이유가 없다 — 지킬 일이 아직 없고, 그 상태로 막으면 세워 둔 계획 하나가
 *  `host stop` 을 영영 거절한다. 문서가 약속하는 것도 "진행 중인 일" 이다(docs/cli.md). */
export function runningRunCount(s: OrchState): number {
  const open = s.dispatches.filter((d) => !d.outcome && !d.endedAt)
  return s.runs.filter((run) =>
    // **A Run with its coordinator attached counts while it has work left** (e2e 2026-10-01:
    // `runsRunning: 0` beside a coordinator planning a Task-less Run). That coordinator is the work in
    // flight: it plans and places. Not once the Run is paused (`runs stop` stopped it) or finished
    // (a manual Run keeps its coordinator for a grace after its Tasks end, and that is not work).
    // A Run waiting on its final check (`checking`) still has work in flight: the check
    (run.coordinatorSessionId !== undefined && run.paused !== true && ['running', 'checking'].includes(outcomeOf(s, run.id))) ||
    s.tasks.some(
      (t) =>
        t.runId === run.id &&
        (t.status === 'validating' ||
          (t.status === 'reviewing' && !reviewerEnded(s.dispatches, t.id)) ||
          t.status === 'merging' ||
          (t.status === 'dispatched' && open.some((d) => d.taskId === t.id)))
    )
  ).length
}
