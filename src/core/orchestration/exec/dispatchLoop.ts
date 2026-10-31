// 배치 루프 — 앱(src/main/ipc.ts 의 bootOrch)과 Host 가 **같은 것을** 짓는다(설계 §4.1, §5.1).
//
// 자동 진행의 네 조각을 한 자리에 둔다: ready Task 를 자리마다 띄우는 루프(runScheduler, 그 재진입
// 가드와 attempted 집합과 finally 까지), 그 루프가 못 띄운 자리를 사람에게 넘기는 gateSlot, 예약
// 템플릿의 발화(orchFireTick, 그 무장 Map 과 함께), 잠든 코디네이터 깨우기. 이 본문은 예전에
// ipc.ts 안에 인라인으로 있었고 그 자리에는 테스트가 닿지 않았다 — 이제 dispatchLoop.test.ts 가
// 진짜 handleCommand 위에서 돌린다. 옮긴 본문은 줄 단위로 같다: 상태를 읽는 자리, await 의 순서,
// 늦은 바인딩이 그대로다. 달라진 것은 둘이고 둘 다 운전자의 규칙이다:
//
// - **운전자에게 묻는다**(§4.3). 진입할 때(예전의 `if (!orch) return` 자리)와 **슬롯마다** 다시
//   `c.mayStart()` 를 묻는다. 활성화 하나는 await 를 여럿 지나므로 그 사이 운전이 넘어갈 수 있다.
// - **떠나는 Host 의 거절에는 Gate 를 열지 않는다**(R15). `retry` 를 실은 409 는 활성화를 멈춘다.
//
// **worker-start 가 2xx 로 답한 뒤에는 그 Task 에 아무것도 하지 않는다**(R14): 그 뒤의 로그는 전부
// 아래 `log` 를 지나고, 그것은 던지지 않는다.
//
// **electron·src/main·src/renderer 를 import 하지 않는다.** 두 프로세스가 서로 다른 것은 전부
// DispatchLoopContext 로 주입받고, 모듈은 `c.*` 를 **부를 때마다** 읽는다 — 짓는 순간의 사본을 쥐지
// 않는다(C5): 앱과 테스트가 지은 뒤에 칸을 갈아 끼운다.
import { ENTER_DELAY_MS } from '../../sessions/sessionDriver'
import type { Lang, MessageKey } from '../../i18n'
import { t } from '../../i18n'
import { accountToDispatchOn } from '../../accounts/dispatchAccount'
import { autoOrderOf, withAutoOrder, type AutoAccountsGuard } from '../../accounts/autoAccountOrder'
import { providerOf } from '../../providers/meta'
import type { Account } from '../../types'
import type { DeliverySetup } from '../deliveryChoices'
import { nameForRun, nameForTask } from '../../worktrees/naming'
import { jobNameOf } from '../jobName'
import { firesDue } from '../fire'
import { NO_COORDINATOR_ANSWER, gateAnswersToTell, gateAnsweredSubject, nextActionOf, nudgeKey, planNudges, readyReminders, readyWithoutWorker, taskOutcomesToTell, type CoordinatorNotice, type NudgeMemo, unattendedQuestions, unreadUpwardMail } from '../inbox'
import {
  buildIntegrationSpec,
  integrationTaskFor,
  isIntegrationTask,
  pendingMergeHeads,
  pendingMerges,
  planMergedSubject,
  runRootOf,
  wavesToMerge,
  workingInRunRoot,
  worktreeDepsOf
} from '../integrate'
import { reapableChildRuns } from '../reap'
import { lostAttemptOf } from '../../recovery/candidates'
import { jobActive, slotsToFill, type Slot } from '../schedule'
import { coordinatorStarting, jobOf, type OrchState } from '../state'
import { isJobActive } from '../lifecycle'
import { DEFAULT_CONCURRENCY, FAILURE_LIMIT, type Decision, type Job, type JobRun, type Task } from '../types'
import { deliveryEnded, isTerminal, outcomeOfTasks, tasksOwnedBy } from '../running'
import { worktreeRefusal } from '../planner'
import { isSamePath } from '../../files/tree'
import { outcomeOf } from '../view'
import { completionSettled, failedWaitAsked, failedWaitChoice, replansDue, stallOf } from '../replan'
import { REPLAN_LIFT_HOLD } from './replanStart'
import { failedRetriesDue, failedRetryOf } from './failedRetry'
// W8-C draft PR
import { draftPrDue } from '../draftPr'
import { refreshOnto, type Integration, type Refresh } from './integrateGit'
import { createOriginSync, originSyncHold } from './originSync'
import { usageChoice, usagePauseWhy, type UsageGuard } from '../usageGuard'
import {
  buildDeliveryFixSpec,
  DELIVERY_FIX_MARK,
  deliveryAnswerOf,
  deliveryDue,
  deliveryFixesOf,
  deliveryFixOf,
  deliveryFallbackLine,
  deliveryFallbackOf,
  deliveryBranchOf,
  handsOffOf,
  readLandingOf,
  ownerCheckDue,
  projectOfJob
} from '../delivery'
// W8-C plan after plan
import { afterStartsDue, afterSweep } from '../after'
// Coordinator rotation and finished tabs
import { createCoordinatorRotation, refreshRunCoordinator } from './coordinatorRotate'
import { autoAnswerLine, autoAnswersDue, coordinatorDecideBody, ESCALATION_DEFAULT_ANSWER, handsOffStepsDue, PLANNER_ANSWER_WAIT_MS, type AutoAnswer, type OpenQuestion } from './autoAnswer'
import { STALL_WATCH_MS, stallPauseProbe, stallRemedies, startNotice, watchdogActivity, type StallEntry, type StallRemedy } from './stallWatch'
import type { ActivityDraft } from '../activity'
import { DETACHED_GRACE_MS, isDetachedHeadError } from '../../worktrees/base'

/** W6-D: a replan whose start left no session after this long died with its process, and is ended. */
export const REPLAN_START_WINDOW_MS = 5 * 60_000
/** A replan planner idle at its prompt this long without `jobs-replan-done` is reminded once to finish. */
export const REPLAN_IDLE_NUDGE_MS = 10 * 60_000
/** A replan running this long in all is ended: the boundary passes as a skipped replan (`jobs-replan-done --timedOut`). */
export const REPLAN_TIMEOUT_MS = 30 * 60_000
/** 15초 — 세션 스케줄러의 TICK_MS 와 같은 값이다 */
export const ORCH_FIRE_TICK_MS = 15_000
/** 코디네이터를 깨우기 전에 기다리는 시간.
 *
 *  **짧으면** `check --wait` 안에서 정상적으로 기다리는 코디네이터를 찌른다 — 그 호출은 서버에서
 *  막혀 있고 도는 동안 토큰을 안 쓰므로, 헛된 찌르기는 그 공짜 기다림을 유료 턴으로 바꾼다.
 *  **길면** 잠든 코디네이터 밑에서 Run 이 그만큼 서 있다.
 *
 *  90초로 둔 근거: `check` 의 기본 대기가 그보다 짧고(DEFAULT_CHECK_TIMEOUT_MS), 정상 코디네이터는
 *  타임아웃마다 다시 `check` 를 불러 그 배치를 ack 하므로 이 시각까지 미확인으로 남지 않는다.
 *  즉 이 문턱을 넘는 것은 "루프를 놓았다" 의 신호에 가깝다. 틱이 15초이므로 실제 깨우기는
 *  90~105초 사이에 일어난다. */
export const COORDINATOR_NUDGE_MS = 90_000
/** How often a worktree the reap gave up on is tried again, quietly (final review I2). */
export const REAP_QUIET_RETRY_MS = 60 * 60_000

/** T3: the folder a `--worktree reuse` Task continues in: its one dep's last implementer worktree, when the reuse holds
 *  (worktreeRefusal) and the dep did not work in the Run root. Undefined: it is placed as any other Task. */
function reuseFolderOf(s: OrchState, task: Task, runRoot: string): string | undefined {
  if (task.worktree !== 'reuse' || worktreeRefusal(s, task) !== undefined) return undefined
  const last = [...s.dispatches].reverse().find((d) => d.taskId === task.deps[0] && !d.review && (d.outcome || d.endedAt))
  return last && !isSamePath(last.cwd, runRoot) ? last.cwd : undefined
}

/** T3: whether a Task not finished yet will continue in `taskId`'s worktree, so its merge keeps the folder.
 *  shortcut: a reuser that ends up in a new worktree (folder gone, merge refused) leaves the kept folder to the Run's
 *  clean-up; reap it here if such folders pile up. */
const reusedLater = (s: OrchState, taskId: string): boolean =>
  s.tasks.some((t) => t.worktree === 'reuse' && t.deps.length === 1 && t.deps[0] === taskId && !isTerminal(t))

/** T1: the integrations git refused (integrateGit.ts) that a merge worker can mend in the plan branch: uncommitted
 *  changes, a merge or rebase left in progress, a detached HEAD, a merge that failed. Not a missing git or git dir. */
const MENDABLE_INTEGRATION: ReadonlySet<MessageKey> = new Set<MessageKey>([
  'jobs.integration.uncommitted',
  'jobs.integration.inProgress',
  'jobs.integration.detachedHead',
  'jobs.integration.mergeFailedRestored',
  'jobs.integration.mergeFailedLeft'
])

/** The idle workers of finished Runs (audit OR-1): each Dispatch closed, not retained, the latest of its session, and of
 *  a Task the finished Run owns. One sweep with its indexes built once; it walked every Dispatch per finished Run and
 *  filtered the Tasks and the Dispatches again per pair, on every commit. `only` asks about one pair. */
export function idleWorkersOf(
  s: OrchState,
  only?: { runId: string; dispatchId: string }
): Array<{ runId: string; dispatch: OrchState['dispatches'][number] }> {
  const latestOfSession = new Map<string, string>()
  for (const d of s.dispatches) latestOfSession.set(d.sessionId, d.id)
  const ownerOfTask = new Map<string, string>()
  for (const run of s.runs) {
    if (only && run.id !== only.runId) continue
    if (outcomeOf(s, run.id) === 'running') continue
    for (const t of tasksOwnedBy(s, run.id)) if (!ownerOfTask.has(t.id)) ownerOfTask.set(t.id, run.id)
  }
  const out: Array<{ runId: string; dispatch: OrchState['dispatches'][number] }> = []
  for (const d of s.dispatches) {
    if (only && d.id !== only.dispatchId) continue
    if (d.retained || (!d.outcome && !d.endedAt)) continue
    if (latestOfSession.get(d.sessionId) !== d.id) continue
    const runId = ownerOfTask.get(d.taskId)
    if (runId !== undefined) out.push({ runId, dispatch: d })
  }
  return out
}
/** The first wait before a coordinator stop is sent again (limits pass L1). Longer than the exit
 *  release's window (EXIT_DEFER_MS) by far, so a stop that landed has emptied the slot before it; each
 *  further try waits twice as long, up to `COORDINATOR_STOP_RETRY_MAX_MS`. */
export const COORDINATOR_STOP_RETRY_MS = 30_000
export const COORDINATOR_STOP_RETRY_MAX_MS = 10 * 60_000
/** How many stops are sent at the `COORDINATOR_STOP_RETRY_MAX_MS` interval before the loop gives up on a
 *  session (LP-1/2): about an hour at the cap. A stop the session keeps refusing for good (a finished Run
 *  that `runMoves` still counts as moving) was otherwise asked every 10 minutes forever, with a log line
 *  each time. Giving up is logged once and is in memory only: the slot and its pending mark stay, so a
 *  restart or a new driver asks again, and a session later known to be gone is still released. */
export const COORDINATOR_STOP_RETRY_CAP_TRIES = 6
/** How long a finished manual Run keeps a session a person typed into after the Run finished, counted from
 *  that last input (the user's decision of 2026-10-02, narrowed 2026-10-25). Ten minutes: long enough to
 *  read the closing summary or ask a follow-up, and a follow-up starts the count again. It guards a
 *  person's follow-up only: a session nobody typed into after the finish is ended as soon as the Run's
 *  completion check has settled, and a scheduled Run's at once, since nothing watches it. */
export const FINISHED_RUN_GRACE_MS = 10 * 60_000
/** How long past FINISHED_RUN_GRACE_MS a busy session still holds off its end. A person's follow-up
 *  rarely takes an hour; the busy state is a terminal title spinner that never ages out, so a spinner
 *  still up after that is read as hung, and the session is ended anyway. */
export const FINISHED_RUN_BUSY_CAP_MS = 60 * 60_000

/** Whether one session of a finished Run may be ended now (FINISHED_RUN_GRACE_MS). At once for a scheduled
 *  Job's Run, and for a session no person typed into after the Run finished (`typedAt` null or not later
 *  than `finishedAt`), busy or not. Otherwise once the grace has passed since that last input, and the
 *  session is not mid-turn, for up to FINISHED_RUN_BUSY_CAP_MS more: the busy state is a title spinner
 *  that never ages out, so one still up past the cap is read as hung. A busy state this process cannot
 *  tell (null) falls back to the time rule. */
export function graceOver(a: { scheduled: boolean; finishedAt: number; typedAt: number | null; busy: boolean | null; nowMs: number }): boolean {
  if (a.scheduled || a.typedAt === null || a.typedAt <= a.finishedAt) return true
  const since = a.nowMs - a.typedAt
  if (since < FINISHED_RUN_GRACE_MS) return false
  return a.busy !== true || since >= FINISHED_RUN_GRACE_MS + FINISHED_RUN_BUSY_CAP_MS
}

/** One session's resend backoff: how many sends, when the next may go, how many waited the cap, and
 *  whether it was given up on (LP-1/2). */
type Retry = { tries: number; nextAt: number; capped: number; gaveUp: boolean }

/** The entry after one more send: the wait doubles from `COORDINATOR_STOP_RETRY_MS` up to
 *  `COORDINATOR_STOP_RETRY_MAX_MS`, and each send that waits the cap is counted toward giving up. */
const nextTry = (prev: Retry | undefined, nowMs: number): { entry: Retry; wait: number } => {
  const tries = (prev?.tries ?? 0) + 1
  const wait = Math.min(COORDINATOR_STOP_RETRY_MS * 2 ** (tries - 1), COORDINATOR_STOP_RETRY_MAX_MS)
  const capped = (prev?.capped ?? 0) + (wait === COORDINATOR_STOP_RETRY_MAX_MS ? 1 : 0)
  return { entry: { tries, nextAt: nowMs + wait, capped, gaveUp: false }, wait }
}

export interface DispatchLoopContext {
  /** handleCommand under this process's own caller id (the app's UI_CALLER, the Host's HOST_CALLER). */
  handle(cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  getState(): OrchState
  /** W1-B: the app-wide worker cap from app settings, or null for none. Read once per pass. Optional:
   *  without it there is no cap. */
  maxConcurrentWorkers?(): number | null | Promise<number | null>
  /** T13: whether new starts are held for the whole profile (core/orchestration/startHold.ts). Read once per pass, beside
   *  the cap: while it says yes the pass places nothing (`slotsToFill`). Optional: without it nothing is held here, and
   *  `worker-start` still refuses a held start. */
  startHeld?(): boolean | Promise<boolean>
  accounts(): Account[] | Promise<Account[]>
  loginStatus(accountId: string): Promise<boolean>
  lang(): Lang
  /** `base`: the plan's target branch (`deliveryBranchOf`), forked from instead of the branch the folder stands on. */
  forkRunWorktree(a: { repoPath: string; name: string; base?: string }): Promise<string>
  /** True when the folder is there for sure not (delivery removes a plan's worktree but the Run keeps the path). A
   *  folder that does not answer is not gone. Optional: without it a recorded Run worktree is taken as present. */
  worktreeGone?(p: string): Promise<boolean>
  /** T3: `reap: false` keeps the merged worktrees (one a Task will continue in, or the plan branch merged into one). */
  integrate(runRoot: string, merges: string[], heads?: Record<string, string>, opts?: { reap?: boolean }): Promise<Integration>
  /** T11: merges another plan's delivered commit into a running plan's Run worktree (integrateGit.ts refreshOnto).
   *  Optional: defaults to that function over the real git. */
  refreshOnto?(worktree: string, base: string, message: string, fetchBranch?: string, projectDir?: string): Promise<Refresh>
  reap(worktreePath: string): Promise<boolean>
  isRegisteredWorktree(p: string): boolean
  sessionAlive(sessionId: string): boolean
  /** True only when this process **knows** the session has ended for real (limits pass L1): the Host's
   *  registry holds an ended pty for it, or the app's session list holds it exited with a real exit code
   *  (not PTY_LOST_SIGHT_EXIT_CODE, which is a Host-held session still running). False for a live
   *  session and for one this process cannot tell about (never held here), so a stop is never taken as
   *  confirmed on a guess. Optional: without it a pending stop is only retried. */
  sessionGone?(sessionId: string): boolean
  /** true busy, false idle, null cannot tell. */
  sessionBusy(sessionId: string): boolean | null
  typeInto(sessionId: string, text: string): void
  /** When a person last typed into the session, in ms since the epoch, or null when this process has
   *  not seen it (FINISHED_RUN_GRACE_MS). Only a person's typing: never this loop's own `typeInto`, a
   *  prompt a spawn or a roll types, or a terminal's own reports. In memory, so a restart forgets it.
   *  Optional: without it no person's input is known, and a finished Run's sessions are due at once. */
  lastPersonInputAt?(sessionId: string): number | null
  /** Coordinator rotation: a session's statusLine context reading, 0-100, or null when it has none. Optional: without
   *  it a coordinator is refreshed at wave boundaries only. */
  sessionContextPct?(sessionId: string): number | null | Promise<number | null>
  /** Coordinator rotation: the "Fresh coordinator at context (%)" setting, 0 for off. */
  freshCoordinatorPct?(): number | Promise<number>
  /** Stall watchdog (stallWatch.ts): the "Watch for stalled plans" setting. Optional: without it there is no watchdog
   *  (the Host wires it; the app's own loop has none). */
  stallWatch?(): boolean | Promise<boolean>
  /** T21: the "Answer questions automatically" setting (autoAnswer.ts). Optional: without it nothing is auto-answered
   *  (the Host wires it beside the watchdog; the app's own loop has none). */
  autoAnswer?(): boolean | Promise<boolean>
  /** #117: appends one call a hands-off plan made in the owner's place to its Job (state.ts addDecision), which the
   *  feed's plan.decided / plan.refused line is derived from. Optional: without it the decision is a log line only. */
  recordDecision?(jobId: string, d: Decision): Promise<void>
  /** A feed line no commit makes (the watchdog's), recorded by the Host's activity log. Optional: without it a log line. */
  activity?(d: ActivityDraft): void
  /** T32: what a plan's folder is set up for (exec/deliverySetup.ts). Optional: without it every plan delivers as saved. */
  deliverySetup?(cwd: string): Promise<DeliverySetup>
  /** Asked on entry and again before each slot (§4.3). */
  mayStart(): boolean
  /** W6-G: the usage guard (usageGuard.ts), refreshed before each slot. Optional: without it no usage pause. */
  usageGuard?: Pick<UsageGuard, 'refresh' | 'pauseOf'> & Partial<Pick<UsageGuard, 'view' | 'pauseAt' | 'autoAccounts'>>
  log(m: string): void
  nowMs(): number
}

/** How one placed slot ended (`placeSlot`). `gate` is a slot that cannot start until a person acts,
 *  `wait` one that starts later on its own (an integration step first), `refused` a `worker-start` that
 *  answered 400 or more, `leaving` a Host that is retiring, `started` a worker that is up. */
type SlotEnd =
  | { kind: 'started'; reply: { status: number; body: unknown } }
  | { kind: 'refused'; reply: { status: number; body: unknown } }
  | { kind: 'leaving'; reply: { status: number; body: unknown } }
  | { kind: 'gate'; reason: string; why: string }
  | { kind: 'wait'; why: string }

export interface DispatchLoop {
  run(): Promise<void>
  /**
   * **One ready Task, placed now, on a person's request** (`tasks dispatch`, CLI spec §18). The same
   * slot the loop would place (`placeSlot`: the account, the run worktree, the integration step, the
   * placement, `worker-start`), for a Task the loop's own pass may not reach: one of a Run no loop
   * places, or one the pass already tried in this activation. It runs alone, never beside a pass, so the
   * two cannot fork one run worktree twice. It opens **no Gate**: what would have been a Gate is the
   * answer, 409 with the reason, and the person decides. The caller (the command layer) has already
   * refused a Run that is paused, not running or coordinator-driven.
   */
  dispatchOne(taskId: string, opts?: { overCoordinator?: boolean }): Promise<{ status: number; body: unknown }>
  fireTick(): Promise<void>
  nudge(): Promise<void>
  /** W7-C (#73): a usage pause ended (`usage.resumed`, usageGuard.ts). Each live coordinator-driven Run with ready
   *  Tasks gets a `status` message in its inbox, which wakes its `check --wait`, so it retries its held worker-starts
   *  now rather than at the window's reset. App-placed Runs need nothing: the loop's next pass places them itself. */
  usageResumed(accountId: string): Promise<void>
  /** Push, not poll: posts one message into a coordinator's Run inbox (a `status` with the notice's subject, its mark),
   *  which the next nudge types into the idle session. Never throws; false when the send was refused or failed. */
  tell(n: CoordinatorNotice): Promise<boolean>
  /** Part 2 of the owner's 2026-10-18 spec: a merge worker for a finished Task whose branch did not merge into its plan
   *  branch. Makes the merge Task (task-create, `parent` = that Task) once and starts it with `worker-start` in the
   *  Run's worktree; a merge Task that failed opens a Gate for the owner instead. For a stall watchdog too. */
  startMergeWorker(a: { runId: string; taskId: string; reason: string; worktrees: { path: string; branch: string | null }[] }): Promise<void>
  /** Stall watchdog (stallWatch.ts): at most once per `STALL_WATCH_MS`, the remedies due, each with its feed line. Run
   *  from the nudge tick; never throws. */
  watchStalls(): Promise<void>
  /** Drops the schedule arming, so the next fireTick only arms (D2, R17). */
  forgetArming(): void
  /** firesDue's arm half only: re-arms every template and fires nothing (N3). The app calls it on its
   *  timer in front of a driving Host, so the sidebar's next-fire time stays right. */
  armOnly(): void
  /** The armed next fire of a schedule template, or null: what orchSnapshotOf shows as nextFireAt (N3). */
  nextFireOf(runId: string): number | null
}

/** The module reads every `c.*` at each call, never a copy taken at construction (C5): the app and the
 *  tests replace members after building it. */
export function createDispatchLoop(c: DispatchLoopContext): DispatchLoop {
  /** 로그 한 줄. **던지지 않는다**(R14) — worker-start 가 2xx 로 답한 뒤의 로그가 던지면 그 예외가
   *  슬롯의 catch 로 가서 이미 뜬 Task 에 Gate 를 청한다. 로그는 알림이지 일의 일부가 아니다. */
  const log = (m: string): void => {
    try {
      c.log(m)
    } catch {
      // 로그를 남길 자리가 없다 — 남길 곳이 없으므로 삼킨다.
    }
  }

  /** 예약 템플릿의 다음 발화 시각. **상태에 저장하지 않는다** — 재시작하면 비어 있고, 그때
   *  firesDue 가 nextFireAt(rule, now) 으로 다시 무장한다. 그것이 곧 "앱이 꺼져 있던 동안의
   *  발화는 버린다"는 규칙의 구현이다(main/scheduler.ts 가 같은 이유로 같은 선택을 했다). */
  let armed = new Map<string, number>()

  /** 이 자리를 지금 띄울 수 없다고 **사람에게** 알린다. 로그가 아니라 Gate 인 이유: 이 층의 실패는
   *  "일이 실패했다"가 아니라 **"앱이 일을 시작하지 못했다"** 이고, 그 판단은 사람의 것이다.
   *  Reviewer 슬라이스가 정한 규칙("Gate 는 돌릴 수 없을 때만 쓴다")이 정확히 이 경우다 — 계정이
   *  없을 때가 이미 그렇게 처리되고 있으므로 같은 부류인 worker-start 실패를 다르게 다루지 않는다.
   *
   *  **되풀이를 멈추는 장치이기도 하다.** Gate 가 열리면 Task 가 blocked 로 가고 slotsToFill 은
   *  ready 만 고르므로 그 자리는 더 이상 후보가 아니다. 그것이 없으면 진짜로 매번 실패하는 자리
   *  (userData 경로에 & 가 들어가 launch 프롬프트가 깨지는 경우가 그렇다 — 위의 LAUNCH_FORBIDDEN
   *  경고는 경고일 뿐 startup 을 막지 않는다)가 **바깥의 상태 변경마다 한 번씩 영원히** 다시 시도된다.
   *  실패 롤백은 consecutiveFailures 를 올리지 않으므로 회로 차단이 대신 걸리는 일도 없다.
   *
   *  이 함수는 실패를 **알리는** 자리이지 실패를 만드는 자리가 아니므로 던지지 않는다. gate-create
   *  도 setState 를 지나므로 같은 이유로 거부될 수 있고, 그것을 그대로 흘려보내면 이 함수를 부르게
   *  만든 원래의 실패까지 함께 지워진다. */
  /** Holds a Task for its owner (running.ts `heldForOwner`): blocked with no Gate and `reason` as its result. activity.ts
   *  tells the owner once; the rest of the plan goes on without it and its dependents (replan.ts, running.ts). Only the
   *  owner moves it again. Never throws. */
  const holdForOwner = async (taskId: string, reason: string): Promise<void> => {
    try {
      const blocked = await c.handle('task-update', { id: taskId, status: 'blocked', result: reason })
      if (blocked.status >= 400) log(`scheduler: blocking task=${taskId} was rejected — ${JSON.stringify(blocked.body)}`)
    } catch (e) {
      log(`scheduler: blocking task=${taskId} failed — ${String(e)}`)
    }
  }
  const gateSlot = async (taskId: string, reason: string): Promise<void> => {
    // Gate 와 별개로 로그를 남긴다 — Gate 는 사용자가 읽는 것이고, 이 줄은 왜 그 Gate 가 열렸는지
    // 나중에 되짚을 때 읽는 것이다.
    log(`scheduler: cannot start task=${taskId} — ${reason}`)
    // A hands-off plan answers its Gates itself, and an answered Gate sends the Task back to ready. The same reason
    // asked and answered twice will be answered the same a third time: block the Task once (activity.ts tells the
    // owner) instead of opening that Gate again every pass.
    const state = c.getState()
    const task = state.tasks.find((t) => t.id === taskId)
    const run = state.runs.find((r) => r.id === task?.runId)
    const job = run && jobOf(state, run)
    if (job && handsOffOf(state, job) && state.gates.filter((g) => g.taskId === taskId && g.status === 'resolved' && g.question === reason).length >= 2) {
      await holdForOwner(taskId, reason)
      return
    }
    try {
      const gated = await c.handle('gate-create', {
        task: taskId,
        question: reason
      })
      // Gate 마저 거절되는 경우가 있다: gate-create 는 열린 Dispatch 가 있는 Task 를 거절하고
      // (state.ts), dispatched 에서 blocked 로 가는 전이도 없다(types.ts 의 ALLOWED). 그 상태로
      // 남는 자리는 ready 가 아니라서 slotsToFill 이 더는 고르지 않으므로 되풀이로는 이어지지
      // 않지만, 사용자에게 남는 신호가 사라지므로 그 자리를 로그로 메운다.
      if (gated.status >= 400)
        log(`scheduler: gate-create rejected task=${taskId} — ${JSON.stringify(gated.body)}`)
    } catch (e) {
      log(`scheduler: gate-create failed task=${taskId} — ${String(e)}`)
    }
  }

  /** When each coordinator session may be asked to stop again (limits pass L1), by session id. A stop
   *  is not remembered as done: until the exit release empties the slot, the Run keeps it (marked
   *  `coordinatorStopPending` once the command ran) and the stop is sent again, first after
   *  `COORDINATOR_STOP_RETRY_MS`, then twice as long each time up to `COORDINATOR_STOP_RETRY_MAX_MS`.
   *  A refusal and a throw are retried the same way, until `COORDINATOR_STOP_RETRY_CAP_TRIES` stops at
   *  the cap have gone unanswered, then it gives up with one log line (LP-1/2). **In memory on purpose**: the pending mark is what
   *  survives a restart or a change of driver, and a new driver's first pass sends the stop once the
   *  mark is `COORDINATOR_STOP_RETRY_MS` old (at once for an older one). A mark with no entry here is
   *  timed from the mark itself, so a stop a command has just sent is not sent again by the next pass. */
  const stopRetry = new Map<string, Retry>()
  /** The same backoff for `worker-release` of a finished Run's idle worker, by session id: a release
   *  whose session lives on is sent again, first after `COORDINATOR_STOP_RETRY_MS`, then twice as long
   *  each time, and given up on after `COORDINATOR_STOP_RETRY_CAP_TRIES` at the cap. An entry goes once
   *  its session is no longer alive. In memory: a restart or a new driver asks again. */
  const releaseRetry = new Map<string, Retry>()

  /** `graceOver` for one session of a finished Run. The finish is the latest `updatedAt` of the Run's
   *  Tasks: the commit that made the last one terminal stamps it, and nothing on the Run records the
   *  moment. A later edit of a finished Task moves it on, which only waits longer for a person's input
   *  to count. `run-coordinator-stop` asks no idle state for a finished Run, so this is the one place
   *  that asks. */
  const sessionDue = (s: OrchState, run: JobRun, sessionId: string, nowMs: number): boolean =>
    graceOver({
      scheduled: jobOf(s, run)?.schedule !== undefined,
      finishedAt: Math.max(...tasksOwnedBy(s, run.id).map((x) => Date.parse(x.updatedAt))),
      typedAt: c.lastPersonInputAt?.(sessionId) ?? null,
      busy: c.sessionBusy(sessionId),
      nowMs
    })

  /**
   * **A Run that has finished gets its coordinator stopped** (the user's U4 of 2026-09-25, widened to
   * every Run on 2026-10-02). Otherwise every fire leaves one more coordinator looping on `check --wait`
   * for good, and a finished manual Run keeps its session, and with it the Host, alive with nothing an
   * MCP client can call to end it (e2e "Fourth run"). A finished Run is one whose outcome is no longer
   * `running` (every Task done, view.ts). A scheduled Job's Run is stopped at once; any other waits out
   * `graceOver`, since a person may be reading its tab or asking it a follow-up. **A slot marked
   * `coordinatorStopPending` is sent again too** (L1), whatever its Run's outcome: a fire's replacement
   * leaves that Run paused and unfinished.
   *
   * **Only the process that drives does it.** The caller has asked `mayStart` just before, and this
   * asks again before each stop, so the app and the Host never both stop one coordinator. The stop and
   * the pending mark are `run-coordinator-stop`'s, through the command layer like every other thing
   * this loop does. A failure is logged and never thrown (R14).
   */
  const stopFinishedCoordinators = async (): Promise<void> => {
    const s = c.getState()
    const slots = new Set<string>()
    for (const run of s.runs) if (run.coordinatorSessionId !== undefined) slots.add(run.coordinatorSessionId)
    // A session no slot names any more is gone (the exit release emptied it): its backoff goes with it.
    for (const id of [...stopRetry.keys()]) if (!slots.has(id)) stopRetry.delete(id)
    for (const run of s.runs) {
      const sessionId = run.coordinatorSessionId
      if (sessionId === undefined) continue
      const pending = run.coordinatorStopPending !== undefined
      if (!pending) {
        // Item 2: a Run that finished with Tasks held for the owner keeps its coordinator: the owner's release runs it again
        if (outcomeOf(s, run.id) === 'running' || outcomeOf(s, run.id) === 'blocked') continue
        // W6-D: a Run this process watched finish keeps its coordinator until its final check settles
        const runJob = jobOf(s, run)
        if (runJob && seenRunning(run.id) && !completionSettled(s, runJob, run.id)) continue
        if (!sessionDue(s, run, sessionId, c.nowMs())) continue
      }
      // **A session this process knows has ended is the stop confirmed** (L1): its exit was never heard
      // (no exit release came), so nothing else would ever empty the slot, and a stop sent to it goes
      // nowhere for good. The command empties the slot the way the exit release does.
      if (c.sessionGone?.(sessionId) === true) {
        if (!c.mayStart()) return
        try {
          const r = await c.handle('run-coordinator-stop', { run: run.id, gone: sessionId })
          if (r.status >= 400) log(`run=${run.id}: releasing the slot of its ended coordinator ${sessionId} was refused: ${JSON.stringify(r.body)}`)
          else stopRetry.delete(sessionId)
        } catch (e) {
          log(`run=${run.id}: releasing the slot of its ended coordinator ${sessionId} failed: ${String(e)}`)
        }
        continue
      }
      const nowMs = c.nowMs()
      const retry = stopRetry.get(sessionId)
      if (retry && (retry.gaveUp || nowMs < retry.nextAt)) continue
      // **A mark this loop did not send waits out its interval from the mark itself** (2026-10-01):
      // `runs stop` and `run-coordinator-stop` from a caller stop the session and write the mark, which
      // leaves no backoff entry here, and the commit's own pass resent the stop 12 ms later. A mark
      // older than the interval (one left by an earlier process) still goes out at once.
      if (!retry && pending) {
        const markedAt = Date.parse(run.coordinatorStopPending!)
        if (Number.isFinite(markedAt) && nowMs < markedAt + COORDINATOR_STOP_RETRY_MS) continue
      }
      if (!c.mayStart()) return
      // LP-1/2: after COORDINATOR_STOP_RETRY_CAP_TRIES stops at the cap, one log line and no more stops.
      if (retry && retry.capped >= COORDINATOR_STOP_RETRY_CAP_TRIES) {
        retry.gaveUp = true
        log(
          `run=${run.id}: gave up stopping its coordinator ${sessionId} after ${retry.tries} attempts; ` +
            `the slot stays pending until the session exits, a restart or a new driver asks again`
        )
        continue
      }
      const { entry, wait } = nextTry(retry, nowMs)
      const tries = entry.tries
      stopRetry.set(sessionId, entry)
      const again = `; asked again in ${Math.round(wait / 1000)}s unless the session is gone by then`
      const what =
        tries === 1
          ? `${jobOf(s, run)?.schedule !== undefined ? 'scheduled ' : ''}run=${run.id} finished`
          : `run=${run.id} (stop attempt ${tries})`
      try {
        const r = await c.handle('run-coordinator-stop', { run: run.id })
        log(
          r.status >= 400
            ? `${what}, and stopping its coordinator ${sessionId} was refused: ${JSON.stringify(r.body)}${again}`
            : `${what}: its coordinator ${sessionId} was asked to stop${again}`
        )
      } catch (e) {
        log(`${what}, and stopping its coordinator ${sessionId} failed: ${String(e)}${again}`)
      }
    }
  }

  /**
   * **A finished Run's idle workers are released** (the user's decision of 2026-10-02). A worker reports
   * and then waits (the guide's rule, so a follow-up can reach it), and only `worker-release` ends its
   * session; that is the coordinator's to send, and once the Run has finished nothing sent it (e2e
   * "Fourth run": the converged Run's worker stayed alive beside its coordinator). So the driving loop
   * sends it, under the coordinator's `graceOver`, for each Dispatch of a finished Run that is
   * closed, not retained (`worker-retain` is a person's "keep it", never overridden here), the latest
   * owner of its session (`releaseArgsFor`'s rule: a reused session is the later Dispatch's), and whose
   * session is still alive. `worker-release` and not `worker-stop`: it only ends the session, where
   * `worker-stop` would rewrite a closed Dispatch's ending. Driving process only, asked before each one;
   * a failure is logged and never thrown (R14).
   */
  /** Worktrees a reap failed to remove, by path: when to try again (audit OR-4). */
  const reapRetry = new Map<string, Retry>()
  const releaseIdleWorkers = async (): Promise<void> => {
    /** Whether `dispatchId` is, in `s`, an idle worker of the finished Run `runId`. Asked of one pair only, on the
     *  state after an await; the pass itself reads idleWorkersOf's one sweep (audit OR-1). */
    const idleIn = (s: OrchState, runId: string, dispatchId: string): boolean =>
      idleWorkersOf(s, { runId, dispatchId }).length > 0
    const s = c.getState()
    for (const id of [...releaseRetry.keys()]) if (!c.sessionAlive(id)) releaseRetry.delete(id)
    for (const { runId, dispatch: d } of idleWorkersOf(s)) {
      // **Asked again on the state as it is now** (fix round 1): each release below awaits, and a Run
      // reopened, a Dispatch reused or a worker retained meanwhile must not lose its session to the
      // snapshot this pass started from.
      // The cheap question first (final review I1): a month of history is mostly sessions long gone, and the check
      // on the current state sweeps that history again.
      if (!c.sessionAlive(d.sessionId)) continue
      const current = c.getState()
      const now = current.runs.find((r) => r.id === runId)
      if (!now || !idleIn(current, runId, d.id)) continue
      const nowMs = c.nowMs()
      if (!sessionDue(current, now, d.sessionId, nowMs)) continue
      const retry = releaseRetry.get(d.sessionId)
      if (retry && (retry.gaveUp || nowMs < retry.nextAt)) continue
      if (!c.mayStart()) return
      if (retry && retry.capped >= COORDINATOR_STOP_RETRY_CAP_TRIES) {
        retry.gaveUp = true
        log(`run=${runId}: gave up releasing its worker ${d.sessionId} (dispatch ${d.id}) after ${retry.tries} attempts`)
        continue
      }
      const { entry, wait } = nextTry(retry, nowMs)
      releaseRetry.set(d.sessionId, entry)
      const what = `run=${runId} finished: its idle worker ${d.sessionId} (dispatch ${d.id})`
      const again = `; asked again in ${Math.round(wait / 1000)}s unless the session is gone by then`
      try {
        const r = await c.handle('worker-release', { dispatch: d.id })
        log(
          r.status >= 400
            ? `${what} was not released: ${JSON.stringify(r.body)}${again}`
            : `${what} was released${again}`
        )
      } catch (e) {
        log(`${what} could not be released: ${String(e)}${again}`)
      }
    }
  }

  /** **Drops the stale coordinator start marks** (limits pass L2): a `coordinatorStartingAt` past its
   *  window is a start that died with its process. It already counts for nothing, but the view the app
   *  last got was computed while it held, and keeps hiding the ▶ until a commit. The command
   *  (`run-start-marks-clear`) does the dropping on the state as it is then. Driving process only. */
  const clearStaleStartMarks = async (): Promise<void> => {
    const nowMs = c.nowMs()
    if (!c.getState().runs.some((r) => r.coordinatorStartingAt !== undefined && !coordinatorStarting(r, nowMs))) return
    if (!c.mayStart()) return
    try {
      const r = await c.handle('run-start-marks-clear', {})
      const cleared = (r.body as { cleared?: unknown } | null)?.cleared
      if (r.status >= 400) log(`stale coordinator start marks were not cleared: ${JSON.stringify(r.body)}`)
      else if (Array.isArray(cleared) && cleared.length > 0)
        log(`stale coordinator start marks cleared on ${cleared.join(', ')}`)
    } catch (e) {
      log(`stale coordinator start marks were not cleared: ${String(e)}`)
    }
  }

  /**
   * W2-D: **a Run that completes opens its plan's one pull request** (`run-open-pr`, the owner's decision of
   * 2026-10-17). Only a Run seen running (T3: marked on the Run, `deliveryState`, so a restart keeps it): a Run that was
   * already done before that (every Run on disk from before this existed among them) gets no PR it never asked for;
   * `run-open-pr` still opens one by hand. Not a scheduled Job's (a PR per fire is noise) and not one with no
   * integration branch (that one is Merged). T3: each attempt is recorded on the Run and retried with backoff (1, 5,
   * 15, 30, 60 min); after the fifth the owner is asked once. Driving process only, asked before each one; a failure is
   * logged and never thrown.
   */
  // ── T11: deliveries across plans never collide ──
  /** The project a plan delivers into: its registered project (T3: its workspace, so sibling sub-projects of one
   *  repository deliver one at a time), else its folder. */
  const projectKeyOf = (s: OrchState, job: Job): string => {
    const p = projectOfJob(s, job)
    return p?.parentId ?? p?.id ?? job.cwd
  }
  /** The pushes other plans of `run`'s project landed, and their pull requests the PR poll saw merged
   *  (`attribution-remap`), since `run` began, oldest first. Derived from the state, so a restarted Host finds the same
   *  ones (`refreshedTo` only spares the git of asking twice). */
  const deliveriesBefore = (s: OrchState, run: JobRun, job: Job): { job: Job; sha: string; branch?: string }[] => {
    const key = projectKeyOf(s, job)
    const since = Date.parse(run.createdAt)
    const out: { job: Job; sha: string; branch?: string; at: number }[] = []
    for (const o of s.runs) {
      const p = o.pr
      const d =
        o.delivery?.sha !== undefined
          ? o.delivery
          : p?.attributed !== undefined && p.attributedAt !== undefined
            ? { sha: p.attributed, at: p.attributedAt, ...(p.baseRefName ? { branch: p.baseRefName } : {}) }
            : undefined
      if (o.jobId === run.jobId || d?.sha === undefined || !(Date.parse(d.at) >= since)) continue
      const other = jobOf(s, o)
      if (other && projectKeyOf(s, other) === key) out.push({ job: other, sha: d.sha, at: Date.parse(d.at), ...(d.branch ? { branch: d.branch } : {}) })
    }
    return out.sort((a, b) => a.at - b.at)
  }
  /** The delivered commits each Run worktree already holds, by Run id. In memory: a restart asks git once more. */
  const refreshedTo = new Map<string, Set<string>>()
  // A feed line of the existing `watchdog` kind (payload.reason): a kind of its own would need the feed's renderer too
  const planActivity = (runId: string, reason: string): void => c.activity?.(watchdogActivity(c.getState(), runId, reason))
  /** T32: the line saying how a plan whose saved delivery cannot work on its folder lands instead; it carries the
   *  fallback, so the app words it in the owner's language (delivery.off.*). Nothing when it did not fall back. */
  const planFallback = (runId: string, job: Job): void => {
    const s = c.getState()
    const fell = deliveryFallbackOf(s, job)
    if (fell === null) return
    const draft = watchdogActivity(s, runId, `Plan ${jobNameOf(job)}: ${deliveryFallbackLine(s, job)}`)
    c.activity?.({ ...draft, payload: { ...draft.payload, deliveryFallback: fell } })
  }
  /** The Task a refresh's integration Task hangs off: the Run's last Task that is not one itself. */
  const anchorOf = (s: OrchState, runId: string): Task | undefined => {
    const own = s.tasks.filter((t) => t.runId === runId)
    return own.filter((t) => !isIntegrationTask(t)).at(-1) ?? own.at(-1)
  }

  /**
   * **T11: a running plan is refreshed onto every other plan of its project that delivered since it began**, before its
   * next Task starts: the delivered commit is merged into its Run worktree (a merge, never a rebase) when it merges
   * cleanly. A conflict goes to an integration Task in this plan, as an in-plan conflict does (`startMergeWorker`, hung
   * off `anchorId`), and the plan waits for it; only when that Task fails is the owner asked. `ready`: nothing (more) to
   * merge. A worker in the Run worktree is never merged under: the refresh waits for it.
   */
  const refreshRun = async (runId: string, anchorId: string): Promise<{ kind: 'ready' } | { kind: 'wait'; why: string } | { kind: 'gate'; reason: string }> => {
    const s = c.getState()
    const run = s.runs.find((r) => r.id === runId)
    const job = run && jobOf(s, run)
    // A Run with no worktree of its own works in the owner's folder, which is never merged into here
    if (!run || !job || run.worktree === undefined) return { kind: 'ready' }
    const worktree = run.worktree
    const done = refreshedTo.get(runId) ?? new Set<string>()
    const due = deliveriesBefore(s, run, job).filter((d) => !done.has(d.sha))
    if (due.length === 0) return { kind: 'ready' }
    const mine = jobNameOf(job)
    if (workingInRunRoot(s, runId))
      return { kind: 'wait', why: `plan ${mine} is refreshed onto plan ${jobNameOf(due[0].job)}'s delivery first, and a worker is still working in ${worktree}` }
    for (const d of due) {
      const plan = jobNameOf(d.job)
      let r: Refresh
      try {
        // T1: a commit origin does not give is looked for in the project folder too (the delivering plan's)
        r = await (c.refreshOnto ?? ((w, b, m, f, p) => refreshOnto(w, b, m, { log, ...(f ? { fetchBranch: f } : {}), ...(p ? { projectDir: p } : {}) })))(
          worktree,
          d.sha,
          `Refresh onto plan ${plan}'s delivery`,
          d.branch,
          d.job.cwd
        )
      } catch (e) {
        r = { kind: 'human', reason: String(e) }
      }
      if (r.kind === 'current' || r.kind === 'merged') {
        refreshedTo.set(runId, done.add(d.sha))
        if (r.kind === 'merged') {
          log(`run=${runId}: refreshed onto ${d.sha} (plan ${plan}'s delivery)`)
          planActivity(runId, `Plan ${mine} refreshed onto plan ${plan}'s delivery (${d.sha.slice(0, 7)})`)
        }
        continue
      }
      if (r.kind === 'human') return { kind: 'gate', reason: `Plan ${mine} could not be refreshed onto plan ${plan}'s delivery: ${r.reason}` }
      // The integration Task of this delivery: its spec names the delivered commit
      const ofThis = (st: OrchState): Task | undefined => st.tasks.find((t) => t.runId === runId && isIntegrationTask(t) && t.spec.includes(d.sha))
      const existing = ofThis(s)
      if (existing?.status === 'completed')
        return { kind: 'gate', reason: `Plan ${mine} still conflicts with plan ${plan}'s delivery although integration task ${existing.id} finished: ${r.reason}` }
      await startMergeWorker({
        runId,
        taskId: existing?.parentId ?? anchorId,
        key: d.sha,
        reason: `plan ${plan} delivered ${d.sha} to ${d.branch ?? 'its branch'}, and it conflicts with this plan's branch: ${r.reason}`,
        worktrees: [{ path: d.job.cwd, branch: d.branch ?? null }]
      })
      const made = existing ? undefined : ofThis(c.getState())
      if (made) {
        log(`run=${runId}: integration task=${made.id} created for the conflict with plan ${plan}'s delivery ${d.sha}`)
        planActivity(runId, `Integration Task created in plan ${mine} for its conflict with plan ${plan}'s delivery (${d.sha.slice(0, 7)})`)
      }
      return { kind: 'wait', why: `plan ${mine} conflicts with plan ${plan}'s delivery, and an integration task resolves that first` }
    }
    return { kind: 'ready' }
  }

  /** T11: after a delivery, every running plan of a project is refreshed at once, not only at its next app-placed Task:
   *  a coordinator places its own workers. A wait is asked again next pass; a Gate is left to the Task's own start. */
  const refreshRunningPlans = async (): Promise<void> => {
    const s = c.getState()
    for (const run of s.runs) {
      const job = jobOf(s, run)
      if (!job || run.worktree === undefined || !isJobActive(job) || job.schedule !== undefined) continue
      if (deliveriesBefore(s, run, job).every((d) => refreshedTo.get(run.id)?.has(d.sha))) continue
      if (outcomeOfTasks(tasksOwnedBy(s, run.id)) !== 'running') continue
      const anchor = anchorOf(s, run.id)
      if (!anchor || !c.mayStart()) continue
      try {
        const r = await refreshRun(run.id, anchor.id)
        if (r.kind !== 'ready') log(`run=${run.id}: not refreshed yet: ${r.kind === 'wait' ? r.why : r.reason}`)
      } catch (e) {
        log(`run=${run.id}: refreshing onto other plans' deliveries failed: ${String(e)}`)
      }
    }
  }

  /** T11: the projects with a delivery in flight. At most one delivery per project runs at a time; plans of different
   *  projects deliver side by side. In memory: a delivery never outlives its process, and what it landed is in the state. */
  const delivering = new Set<string>()

  /** T3: a Run seen running has its delivery pending on the Run itself (`deliveryState`), so a restarted Host still
   *  delivers it; a Run that was already done before this existed has none and gets no delivery it never asked for. */
  const seenRunning = (runId: string): boolean => c.getState().runs.find((r) => r.id === runId)?.deliveryState !== undefined
  type DeliveryStep = { run: JobRun; push: boolean; action: 'auto' | 'retry' | 'self'; outcome: string }
  const openCompletedRunPrs = async (): Promise<void> => {
    const s = c.getState()
    const nowMs = c.nowMs()
    // One sweep of the Tasks per pass, not one per Run: a month of history is many Runs (audit OR-1's reason)
    const owned = new Map<string, Task[]>()
    for (const t of s.tasks) {
      if (t.runId === undefined) continue
      const list = owned.get(t.runId)
      if (list) list.push(t)
      else owned.set(t.runId, [t])
    }
    const due = new Map<string, DeliveryStep[]>()
    for (const run of s.runs) {
      // W6-H: a pushed delivery is done; W8-C: a draft opened between waves is finished here (`run-open-pr` marks it
      // ready); any other opened PR (or a no-remote note) is the end. T1: so is a PR merged or closed on GitHub
      if (deliveryEnded(run)) continue
      const job = jobOf(s, run)
      if (!job || !isJobActive(job) || job.schedule !== undefined) continue
      const p = run.deliveryState
      const outcome = outcomeOfTasks(owned.get(run.id) ?? [], s.gates)
      // A manual plan is never delivered here: once its tasks are done and its final check settled it waits for the owner
      // T32: a delivery that cannot work on the folder is the fallback's (merge here, else review)
      const mode = (await readLandingOf(s, job, c.deliverySetup)).mode
      if (mode === 'manual') {
        if (outcome === 'completed' && completionSettled(s, job, run.id) && (p === undefined || p.state === 'pending') && c.mayStart()) {
          try {
            const r = await c.handle('run-deliver', { run: run.id, awaitReview: true })
            if (r.status >= 400) log(`run=${run.id}: its wait for the owner was not recorded: ${JSON.stringify(r.body)}`)
            else planFallback(run.id, job)
          } catch (e) {
            log(`run=${run.id}: recording its wait for the owner failed: ${String(e)}`)
          }
        }
        continue
      }
      if (outcome === 'running') {
        // T3: persisted, so a restart still delivers it. Item 2: a plan that finished with blocked Tasks (or whose
        // delivery became an integration Task) and runs again is delivered again, its attempts counted afresh
        if ((p?.state !== 'pending' || p.attempts !== 0) && c.mayStart()) {
          try {
            const r = await c.handle('run-deliver', { run: run.id, pending: true })
            if (r.status >= 400) log(`run=${run.id}: its delivery was not marked pending: ${JSON.stringify(r.body)}`)
          } catch (e) {
            log(`run=${run.id}: marking its delivery pending failed: ${String(e)}`)
          }
        }
        continue
      }
      if (p === undefined) continue
      const push = mode === 'push' || mode === 'merge' // T6: a local merge lands the same way
      const answer = deliveryAnswerOf(s, p)
      const action: DeliveryStep['action'] | null =
        answer === 'self' || ownerCheckDue(p, nowMs) ? 'self' : answer === 'retry' ? 'retry' : deliveryDue(p, nowMs) ? 'auto' : null
      if (action === null) continue
      // W6-D: the PR waits for the final check (replan.ts completionSettled). W8-E (#99): a failed plan has none
      if (outcome === 'completed' && !completionSettled(s, job, run.id)) continue
      // W8-E (#99): a failed plan's completed work goes into a draft PR (or its branch note). Item 2: so does a plan that
      // finished with Tasks held for the owner; its draft is finished once they are done. A push plan held for the owner
      // waits for them; T3: one that ended failed is told once (`run-deliver` records it `failed`)
      if (outcome === 'blocked' && push) continue
      // W6-H: a push merges the Run's worktrees into the project folder itself, so it needs no integration branch
      if (!push && run.worktree === undefined) continue
      const key = projectKeyOf(s, job)
      const list = due.get(key)
      const step = { run, push, action, outcome }
      if (list) list.push(step)
      else due.set(key, [step])
    }
    // T11: one delivery per project at a time, projects side by side
    await Promise.all(
      [...due].map(async ([key, list]) => {
        if (delivering.has(key)) return
        delivering.add(key)
        try {
          for (const x of list) await deliverOne(x)
        } finally {
          delivering.delete(key)
        }
      })
    )
  }

  /** One completed Run's delivery step (`openCompletedRunPrs`), under its project's lock: an attempt (`auto`, its retry
   *  time come), the owner's "Retry now" (`retry`, a forced attempt that counts afresh) or "I'll push it myself" (`self`,
   *  git asked whether the commits reached the branch). Each attempt is recorded on the Run by `run-deliver` (T3:
   *  retried with backoff, the owner asked once after the last automatic one). Never throws. */
  const deliverOne = async ({ run, push, action, outcome }: DeliveryStep): Promise<void> => {
    if (!c.mayStart()) return
    const job = jobOf(c.getState(), run)
    const plan = job ? jobNameOf(job) : run.id
    // T32: said once per attempt, so the log shows which delivery was used and why
    if (job && action !== 'self') planFallback(run.id, job)
    if (action === 'self') {
      try {
        const r = await c.handle('run-deliver', { run: run.id, ownerPushed: true })
        if (r.status < 400) {
          log(`run=${run.id}: the owner delivered it; its commits are on the delivery branch`)
          planActivity(run.id, `Plan ${plan} was delivered by its owner`)
        } else log(`run=${run.id}: waiting for the owner's push: ${JSON.stringify(r.body)}`)
      } catch (e) {
        log(`run=${run.id}: checking the owner's push failed: ${String(e)}`)
      }
      return
    }
    // T11: a push first takes in what other plans of the project delivered meanwhile. A conflict became an integration
    // Task (the Run is running again, and comes back here once it is done). T3: a Gate stops this pass's delivery and
    // counts as a failed attempt, so it is retried and, at the last, asked of the owner
    const anchor = anchorOf(c.getState(), run.id)
    if (push && anchor && outcome === 'completed') {
      try {
        const fresh = await refreshRun(run.id, anchor.id)
        if (fresh.kind === 'wait') {
          log(`run=${run.id} completed, and is not delivered yet: ${fresh.why}`)
          return
        }
        if (fresh.kind === 'gate') {
          const r = await c.handle('run-deliver', { run: run.id, stopped: fresh.reason })
          log(`run=${run.id} completed, and is not delivered this time: ${fresh.reason} (${JSON.stringify((r.body as { deliveryState?: unknown } | null)?.deliveryState)})`)
          return
        }
      } catch (e) {
        log(`run=${run.id}: refreshing onto other plans' deliveries failed, delivering as it is: ${String(e)}`)
      }
    }
    try {
      // W6-H: `run-deliver` is `run-open-pr` for a `pr` project, and the guarded push for a `push` one
      const r = await c.handle('run-deliver', action === 'retry' ? { run: run.id, force: true } : { run: run.id, auto: true })
      const body = r.body as {
        url?: unknown
        sha?: unknown
        branch?: unknown
        message?: unknown
        error?: unknown
        code?: unknown
        conflictWith?: unknown
        deliveryState?: { state?: unknown; nextRetryAt?: unknown }
      } | null
      if (r.status >= 400) {
        const why = typeof body?.error === 'string' ? body.error : JSON.stringify(r.body)
        const next = body?.deliveryState
        log(
          `run=${run.id} completed, and it was not delivered: ${why}` +
            (next?.state === 'retrying' || next?.state === 'needs-owner' ? ` (${String(next.state)}, next try at ${String(next.nextRetryAt)})` : '')
        )
        // T3: a push plan that ended failed is never pushed: the feed says so, once (the Run now reads `failed`)
        if (body?.code === 'not-completed') planActivity(run.id, `Plan ${plan} was not delivered: ${why}`)
        // T3: origin moved on and conflicts with the plan: the owner's branch is back where it was, and an integration
        // Task in this plan merges origin's commit, as the T11 refresh does; the delivery comes back here after it
        if (body?.code === 'origin-conflict' && typeof body.conflictWith === 'string' && anchor && run.worktree !== undefined) {
          const sha = body.conflictWith
          const where = typeof body.branch === 'string' ? `origin/${body.branch}` : 'origin'
          await startMergeWorker({
            runId: run.id,
            taskId: anchor.id,
            key: sha,
            reason: `${where} moved on to ${sha} while the plan was being delivered, and it conflicts with this plan's branch: merge it in with \`git merge --no-edit ${sha}\` and resolve the conflict. ${why}`,
            worktrees: []
          })
          planActivity(run.id, `Integration Task created in plan ${plan} for its conflict with ${where} (${sha.slice(0, 7)})`)
        }
        // T5: a hands-free plan's checks failed on the merged result: a fix Task in the plan branch makes them pass, and
        // once it completes the Run is delivered (validated) again; FAILURE_LIMIT of them, then run-deliver asks the owner.
        // T1: a push refused by the repository (a pre-push hook) too, its output quoted in the Task
        if ((body?.code === 'validation-failed' || body?.code === 'push-refused') && anchor) await startDeliveryFix(run.id, anchor, why, typeof body.branch === 'string' ? body.branch : undefined)
        return
      }
      log(
        typeof body?.message === 'string' // W7-E (#80): no remote
          ? `run=${run.id} completed: ${body.message}`
          : push
            ? `run=${run.id} completed: pushed ${String(body?.sha)} to ${String(body?.branch)}`
            : `run=${run.id} completed: its pull request is ${String(body?.url)}`
      )
    } catch (e) {
      log(`run=${run.id} completed, and delivering it failed: ${String(e)}`)
    }
  }

  /** T5: the next delivery fix Task of a Run whose validation failed (`deliveryFixOf`), hung off `anchor` and started
   *  in the plan branch as a merge Task is (`startMergeWorker` finds it by its numbered mark). Never throws. */
  const startDeliveryFix = async (runId: string, anchor: Task, reason: string, branch: string | undefined): Promise<void> => {
    const s = c.getState()
    const run = s.runs.find((r) => r.id === runId)
    if (!run || deliveryFixOf(s, run) !== 'fix') return
    const n = deliveryFixesOf(s, runId).length + 1
    const job = jobOf(s, run)
    try {
      const made = await c.handle('task-create', {
        runId,
        parent: anchor.id,
        deps: [],
        account: (anchor.accountIds ?? []).join(','),
        noReview: true,
        title: t(c.lang(), 'jobs.deliveryFix.title', { n, limit: FAILURE_LIMIT }).slice(0, 80),
        spec: buildDeliveryFixSpec({ runRoot: runRootOf(run, job), ...(branch !== undefined ? { branch } : {}), reason, n })
      })
      if (made.status >= 400) {
        log(`run=${runId}: the delivery fix task could not be made: ${JSON.stringify(made.body)}`)
        return
      }
      await startMergeWorker({ runId, taskId: anchor.id, key: `${DELIVERY_FIX_MARK} (fix ${n} of ${FAILURE_LIMIT})`, reason, worktrees: [] })
      planActivity(runId, `Fix Task ${n} of ${FAILURE_LIMIT} created in plan ${job ? jobNameOf(job) : runId} for its failed delivery checks`)
    } catch (e) {
      log(`run=${runId}: the delivery fix task failed to start: ${String(e)}`)
    }
  }

  /**
   * W6-D: **a deviation replans.** When a completed Task did not go as planned and Tasks it can affect have not
   * started, `jobs-replan` starts a fresh planner on those, holding only them; when every Task has completed (the final
   * check), it holds the Job (`replansDue`, replan.ts). A replan whose planner session is gone without ending it, or whose start died before
   * its session was recorded, is ended here (`jobs-replan-done --gone`): the end validates the plan and either lets
   * the Job go or hands it to the person. Before the PR and the coordinator's stop, which wait for the final check.
   * Driving process only, asked before each one; a failure is logged and never thrown.
   */
  const replanAtBoundaries = async (): Promise<void> => {
    const s = c.getState()
    for (const job of s.jobs) {
      const r = job.replanning
      if (!r) continue
      if (r.sessionId !== undefined && c.sessionGone?.(r.sessionId) !== true) {
        // A planner chat waits on its owner, so it is neither hurried nor timed out.
        if (!r.chat) await hurryReplan(job.id, r.sessionId, r.startedAt)
        continue
      }
      const stale = r.sessionId === undefined && c.nowMs() - Date.parse(r.startedAt) > REPLAN_START_WINDOW_MS
      if (!stale && r.sessionId === undefined) continue
      if (!c.mayStart()) return
      try {
        const end = await c.handle('jobs-replan-done', { id: job.id, gone: true })
        log(`job=${job.id}: its replan planner is gone; the replan ended: ${JSON.stringify(end.body)}`)
      } catch (e) {
        log(`job=${job.id}: ending its replan failed: ${String(e)}`)
      }
    }
    for (const due of replansDue(c.getState(), seenRunning)) {
      if (!c.mayStart()) return
      const job = jobOf(c.getState(), c.getState().runs.find((x) => x.id === due.runId)!)
      try {
        const r = await c.handle('jobs-replan', { id: job?.id, run: due.runId, mode: due.mode, wave: due.wave })
        log(
          r.status >= 400
            ? `run=${due.runId}: the ${due.mode} replan before wave ${due.wave} did not start: ${JSON.stringify(r.body)}`
            : `run=${due.runId}: ${due.mode} replan before wave ${due.wave} started`
        )
      } catch (e) {
        log(`run=${due.runId}: starting its ${due.mode} replan failed: ${String(e)}`)
      }
    }
  }

  /**
   * T36: **a plan never stalls silently.** After the replans (a failed Task that holds back its plan gets one first,
   * replan.ts `replansDue`), a Run that still cannot move (`stallOf`) is logged once per cause and its owner is asked
   * once per failure (`run-failed-ask`), a hands-off plan too: nothing else can move it. The answer is carried out here
   * (`task-failed-resolve`). Driving process only, asked before each one; a failure is logged and never thrown.
   */
  // In memory: a restart logs a stall that is still there once more
  const stallLogged = new Map<string, string>()
  const unstallRuns = async (): Promise<void> => {
    const answered = c.getState().tasks.flatMap((t) => {
      const action = failedWaitChoice(c.getState(), t)
      return action ? [{ t, action }] : []
    })
    for (const { t, action } of answered) {
      if (!c.mayStart()) return
      const reason = action === 'accept' ? `the owner accepted it as done: ${(t.result ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)}` : undefined
      try {
        const r = await c.handle('task-failed-resolve', { id: t.id, action, ...(reason ? { reason } : {}) })
        log(r.status >= 400 ? `run=${t.runId}: the owner's ${action} of ${t.id} was refused: ${JSON.stringify(r.body)}` : `run=${t.runId}: the owner's ${action} of failed ${t.id} carried out`)
      } catch (e) {
        log(`run=${t.runId}: carrying out the owner's ${action} of ${t.id} failed: ${String(e)}`)
      }
    }
    for (const run of c.getState().runs) {
      const stall = stallOf(c.getState(), run)
      if (!stall) {
        stallLogged.delete(run.id)
        continue
      }
      if (stallLogged.get(run.id) !== stall.reason) {
        stallLogged.set(run.id, stall.reason)
        log(`run=${run.id} stalled: ${stall.reason}`)
      }
      if (stall.blocks.every((b) => failedWaitAsked(c.getState(), b.task)) || !c.mayStart()) continue
      // T10: not while Astera still retries or accepts one of its failed Tasks itself (`retryFailedTasks`)
      if (stall.blocks.some((b) => failedRetriedByAstera(c.getState(), b.task))) continue
      try {
        const r = await c.handle('run-failed-ask', { run: run.id })
        log(r.status >= 400 ? `run=${run.id}: asking the owner about its failed Task was refused: ${JSON.stringify(r.body)}` : `run=${run.id}: asked the owner about its failed Task`)
      } catch (e) {
        log(`run=${run.id}: asking the owner about its failed Task failed: ${String(e)}`)
      }
    }
  }

  /**
   * T10: a hands-off plan whose Run has no live coordinator (`coordinatorLive`) handles its own failed Tasks
   * (failedRetry.ts): one with tries left is retried once its backoff is over, keeping its failure count
   * (`task-failed-resolve` with `keepFailures`); one whose last try failed but that committed its work and passes its checks
   * is accepted as done. Each is a decision on its Job (the feed's plan.decided line). The rest escalate: `unstallRuns`
   * asks the owner as before, the one way the failed-Task question reaches them. Before `unstallRuns`, so a retried Task
   * no longer stalls its Run. Driving process only; a failure is logged and never thrown.
   */
  // In memory: a refused step is not repeated for the same failure in this process
  const failedStepTried = new Set<string>()
  const failedRetriedByAstera = (s: OrchState, task: Task): boolean => {
    const step = task.runId === undefined ? undefined : failedRetryOf(s, task, { coordinatorLive: coordinatorLive(s, task.runId), nowMs: c.nowMs() })
    return step !== undefined && step.kind !== 'escalate' && !failedStepTried.has(`${task.id}@${task.updatedAt}`)
  }
  const retryFailedTasks = async (): Promise<void> => {
    const s = c.getState()
    for (const step of failedRetriesDue(s, c.nowMs(), (runId) => coordinatorLive(s, runId))) {
      const t = step.task
      const key = `${t.id}@${t.updatedAt}`
      if (failedStepTried.has(key)) continue
      if (step.kind === 'escalate') {
        failedStepTried.add(key)
        log(`run=${t.runId}: failed ${t.id} goes to the owner: ${step.why}`)
        continue
      }
      if (step.kind === 'wait' || (step.kind === 'retry' && !step.due)) continue
      if (!c.mayStart()) return
      failedStepTried.add(key)
      const job = handsOffJobOf(c.getState(), t.runId ?? '')
      const args =
        step.kind === 'retry' ? { id: t.id, action: 'retry', keepFailures: true } : { id: t.id, action: 'accept', reason: step.reason }
      try {
        const r = await c.handle('task-failed-resolve', args)
        if (r.status >= 400) {
          log(`run=${t.runId}: Astera's ${step.kind} of failed ${t.id} was refused: ${JSON.stringify(r.body)}`)
          continue
        }
        if (!job) continue
        await decide(
          job.id,
          step.kind === 'retry'
            ? {
                kind: 'escalation',
                taskId: t.id,
                question: `${t.title} failed (${t.consecutiveFailures} of ${FAILURE_LIMIT})`,
                choice: `retried ${t.title} (attempt ${step.attempt} of ${FAILURE_LIMIT})`,
                why: step.why
              }
            : { kind: 'escalation', taskId: t.id, question: `${t.title} failed ${t.consecutiveFailures} of ${FAILURE_LIMIT} times`, choice: `accepted ${t.title} as done`, why: step.reason }
        )
      } catch (e) {
        log(`run=${t.runId}: Astera's ${step.kind} of failed ${t.id} failed: ${String(e)}`)
      }
    }
  }

  /** When each replan planner was first seen idle at its prompt (busy resets it), and the ones reminded already. In
   *  memory: a restart counts the idle time again, and the 30-minute end counts from the replan's own start. */
  const replanIdleSince = new Map<string, number>()
  const replanNudged = new Set<string>()
  /**
   * A replan planner that stays alive but never calls `jobs-replan-done` would hold its Job forever. Idle at its prompt
   * for REPLAN_IDLE_NUDGE_MS, it is reminded once; REPLAN_TIMEOUT_MS after the replan began it is ended
   * (`jobs-replan-done --timedOut`, which stops the session): the boundary passes as a skipped replan, the plan as it
   * stands, and the activity feed says so. A session whose state cannot be told counts as idle. Not called for a chat
   * replan (`replanning.chat`): its owner is the one who talks, so nothing hurries or times it out.
   */
  const hurryReplan = async (jobId: string, sessionId: string, startedAt: string): Promise<void> => {
    const now = c.nowMs()
    if (now - Date.parse(startedAt) > REPLAN_TIMEOUT_MS) {
      if (!c.mayStart()) return
      try {
        const end = await c.handle('jobs-replan-done', { id: jobId, timedOut: true })
        log(`job=${jobId}: its replan planner did not finish in time; the replan ended: ${JSON.stringify(end.body)}`)
      } catch (e) {
        log(`job=${jobId}: ending its timed-out replan failed: ${String(e)}`)
      }
      return
    }
    if (c.sessionBusy(sessionId) === true) {
      replanIdleSince.delete(sessionId)
      return
    }
    const since = replanIdleSince.get(sessionId) ?? now
    replanIdleSince.set(sessionId, since)
    if (now - since < REPLAN_IDLE_NUDGE_MS || replanNudged.has(sessionId) || !c.sessionAlive(sessionId)) return
    replanNudged.add(sessionId)
    c.typeInto(sessionId, `Finish with \`astera jobs-replan-done --id ${jobId} --summary "<one line: what you changed and why>"\`.`)
    await new Promise((res) => setTimeout(res, ENTER_DELAY_MS))
    c.typeInto(sessionId, '\r')
    log(`job=${jobId}: its replan planner ${sessionId} was idle; reminded to finish`)
  }

  /**
   * An escalated replan keeps its Job held and raises an escalation in the Inbox (replanStart.ts replanEscalation);
   * the owner's answer REPLAN_LIFT_HOLD lifts the hold here (`jobs-unhold`). Each answer lifts once.
   */
  // shortcut: the lifted answers are kept in memory, so after a restart a hold set again by hand while the escalation
  // still reads REPLAN_LIFT_HOLD is lifted once more; record the lift on the Job if that ever matters.
  const liftedHolds = new Set<string>()
  const liftAnsweredHolds = async (): Promise<void> => {
    const s = c.getState()
    for (const job of s.jobs) {
      const last = job.lastReplan
      if (!job.dispatchHold || job.replanning || last?.escalated === undefined) continue
      const m = s.messages.find(
        (x) =>
          x.type === 'escalation' &&
          x.runId === last.runId &&
          x.createdAt >= last.at &&
          x.options?.includes(REPLAN_LIFT_HOLD) &&
          x.answered &&
          // a hands-off coordinator answers "<choice>. Why: <reason>" (handover.ts), so the choice is the part before it
          x.answerBody?.split(/\.\s*why:/i)[0].trim().toLowerCase() === REPLAN_LIFT_HOLD &&
          !liftedHolds.has(x.id)
      )
      if (!m || !c.mayStart()) continue
      liftedHolds.add(m.id)
      try {
        const r = await c.handle('jobs-unhold', { id: job.id })
        log(r.status >= 400 ? `job=${job.id}: lifting its replan hold was refused: ${JSON.stringify(r.body)}` : `job=${job.id}: the owner lifted its replan hold`)
      } catch (e) {
        log(`job=${job.id}: lifting its replan hold failed: ${String(e)}`)
      }
    }
  }

  // W8-C draft PR
  /**
   * W8-C: **a long `pr` plan is followed from GitHub.** After each wave while later waves remain (draftPr.ts
   * draftPrDue), `run-draft-pr` pushes the integration branch and opens the plan's PR as a draft, or rewrites its body.
   * T3: after every Task merged into the plan branch, for `push` plans too (the branch is pushed, no PR). Each attempt
   * is recorded on the Run (`branchPush`), so a failure is retried after its backoff and a restart resumes. After the
   * replans, so a wave's replan has its say first. Driving process only, asked before each one; a failure is logged
   * and never thrown.
   */
  const updateDraftPrs = async (): Promise<void> => {
    for (const run of c.getState().runs) {
      const job = jobOf(c.getState(), run)
      if (job) await readLandingOf(c.getState(), job, c.deliverySetup) // T32: draftPrDue below reads what this read
      // T4: the owner's answer to the plan-branch push question: "Retry now" pushes at once and counts afresh, "I'll push
      // it myself" stops Astera pushing the plan branch
      const answer = deliveryAnswerOf(c.getState(), run.branchPush)
      if (answer === 'self') {
        if (!c.mayStart()) return
        const r = await c.handle('run-draft-pr', { run: run.id, ownerPushes: true }).catch((e: unknown) => ({ status: 500, body: String(e) }))
        log(`run=${run.id}: the owner pushes its plan branch: ${r.status >= 400 ? `not recorded: ${JSON.stringify(r.body)}` : 'recorded'}`)
        continue
      }
      const done = answer === 'retry' ? draftPrDue(c.getState(), run) : draftPrDue(c.getState(), run, c.nowMs())
      if (done === null) continue
      if (!c.mayStart()) return
      log((await askDraftPr(run.id, done, answer === 'retry')).line)
    }
  }
  // T4: running plans kept in sync with origin (originSync.ts); a conflict is an integration Task, as the T11 refresh's
  const originSync = createOriginSync({
    getState: () => c.getState(),
    handle: (cmd, args) => c.handle(cmd, args),
    openIntegration: async (runId, tip, reason) => {
      const anchor = anchorOf(c.getState(), runId)
      if (anchor) await startMergeWorker({ runId, taskId: anchor.id, key: tip, reason, worktrees: [] })
    },
    activity: planActivity,
    log,
    nowMs: () => c.nowMs(),
    mayStart: () => c.mayStart()
  })
  /** One `run-draft-pr`, as its log line; `ok` when it opened or updated the draft. Never throws. */
  const askDraftPr = async (runId: string, done: number, force = false): Promise<{ ok: boolean; line: string }> => {
    try {
      const r = await c.handle('run-draft-pr', { run: runId, ...(force ? { force: true } : {}) })
      const body = r.body as { url?: unknown; message?: unknown; opened?: unknown } | null
      if (r.status >= 400)
        return { ok: false, line: `run=${runId}: its plan branch was not pushed after ${done} task(s), retried later: ${JSON.stringify(r.body)}` }
      if (typeof body?.message === 'string') return { ok: false, line: `run=${runId}: no draft pull request: ${body.message}` }
      if (body?.url === undefined) return { ok: true, line: `run=${runId}: plan branch pushed after ${done} task(s)` }
      return {
        ok: true,
        line: `run=${runId}: draft pull request ${body?.opened === true ? 'opened' : 'updated'} after ${done} task(s): ${String(body?.url)}`
      }
    } catch (e) {
      return { ok: false, line: `run=${runId}: updating its draft pull request failed: ${String(e)}` }
    }
  }

  /**
   * W8-C plan after plan: **a queued plan starts by itself** once the plan it waits on is delivered (`afterStartsDue`,
   * after.ts): its planner is started with `jobs-plan`, on its coordinator account (`--after` requires one); the
   * project's approval setting decides the rest. A queued plan whose predecessor stopped is escalated once
   * (`jobs-after-sweep`, sent only when the sweep would change something). Each start is asked once by this process.
   * Driving process only, asked before each one; a failure is logged and never thrown.
   */
  const afterAsked = new Set<string>()
  const startQueuedPlans = async (): Promise<void> => {
    if (afterSweep(c.getState(), new Date(c.nowMs()).toISOString()) !== c.getState()) {
      if (!c.mayStart()) return
      try {
        const r = await c.handle('jobs-after-sweep', {})
        const marked = (r.body as { marked?: unknown } | null)?.marked
        if (r.status >= 400 || (Array.isArray(marked) && marked.length > 0))
          log(`queued plans whose earlier plan stopped: ${JSON.stringify(r.body)}`)
      } catch (e) {
        log(`marking the queued plans whose earlier plan stopped failed: ${String(e)}`)
      }
    }
    for (const job of afterStartsDue(c.getState())) {
      if (afterAsked.has(job.id)) continue
      if (!c.mayStart()) return
      afterAsked.add(job.id)
      try {
        const r = await c.handle('jobs-plan', { id: job.id })
        log(
          r.status >= 400
            ? `job=${job.id}: the plan it was queued after is delivered, and its planner did not start: ${JSON.stringify(r.body)}`
            : `job=${job.id}: the plan it was queued after is delivered; its planner started`
        )
      } catch (e) {
        log(`job=${job.id}: starting its planner after the plan it was queued after failed: ${String(e)}`)
      }
    }
  }

  /** T25: a planner or coordinator start that found no account with room (Job.startWait) is asked again every tick; each try
   *  reads the usage again, so it starts by itself once a window resets. A Run with no coordinator yet is a coordinator's
   *  start (`run-start`), else a planner's (`jobs-plan`). */
  let retryingHeld = false
  const retryHeldStarts = async (): Promise<void> => {
    if (retryingHeld) return
    retryingHeld = true
    try {
      for (const job of c.getState().jobs) {
        if (job.startWait === undefined || job.archivedAt !== undefined) continue
        if (!c.mayStart()) return
        const s = c.getState()
        const run = s.runs.filter((r) => r.jobId === job.id).at(-1)
        try {
          const r =
            run && run.coordinatorSessionId === undefined
              ? await c.handle('run-start', { run: run.id })
              : await c.handle('jobs-plan', { id: job.id })
          if (r.status >= 400) log(`job=${job.id}: retrying its held start failed: ${JSON.stringify(r.body)}`)
        } catch (e) {
          log(`job=${job.id}: retrying its held start failed: ${String(e)}`)
        }
      }
    } finally {
      retryingHeld = false
    }
  }

  /** The coordinator housekeeping: the stale start marks (L2), then the stops due (U4, L1), then the
   *  finished Runs' idle workers. Run from the pass and from the timer's `nudge`, since the app runs the
   *  pass only on commits and a stop to retry, a mark to drop or a grace that ran out comes due with
   *  nothing committed. One at a time: a second call while one is under way does nothing, and the backoff
   *  keeps the next one from repeating a stop just sent. */
  // Coordinator rotation and finished tabs (coordinatorRotate.ts): reads `c` at each call, as this module does
  const rotation = createCoordinatorRotation({
    handle: (cmd, args) => c.handle(cmd, args),
    getState: () => c.getState(),
    sessionAlive: (id) => c.sessionAlive(id),
    lastPersonInputAt: (id) => c.lastPersonInputAt?.(id) ?? null,
    activity: (runId, taskId, reason) => c.activity?.(watchdogActivity(c.getState(), runId, reason, taskId)),
    sessionContextPct: (id) => c.sessionContextPct?.(id) ?? null,
    freshCoordinatorPct: () => c.freshCoordinatorPct?.() ?? 0,
    mayStart: () => c.mayStart(),
    log,
    nowMs: () => c.nowMs()
  })
  let tidying = false
  const tidyCoordinators = async (): Promise<void> => {
    if (tidying) return
    tidying = true
    try {
      if (!c.mayStart()) return
      await clearStaleStartMarks()
      if (!c.mayStart()) return
      // W6-D: before the PR, which waits for the final check
      await liftAnsweredHolds()
      await replanAtBoundaries()
      if (!c.mayStart()) return
      // T10: after the replans (one under way looks at the failure first), before the stall's owner question
      await retryFailedTasks()
      if (!c.mayStart()) return
      // T36: after the replans, so a Run a replan just took up is not stalled
      await unstallRuns()
      if (!c.mayStart()) return
      // W8-C draft PR: after a wave's replan, before the completed Run's delivery
      await updateDraftPrs()
      if (!c.mayStart()) return
      // T4: after the wave's push, so a boundary's sync merges onto the branch as pushed
      await originSync.tick()
      if (!c.mayStart()) return
      // W2-D: before the finished Run's workers are released, while its worktrees are all there
      await openCompletedRunPrs()
      if (!c.mayStart()) return
      // T11: after the deliveries, so the other plans of a project that just delivered take it in within this pass
      await refreshRunningPlans()
      if (!c.mayStart()) return
      // W8-C: after the delivery, so a plan queued after one delivered in this pass starts in it too
      await startQueuedPlans()
      if (!c.mayStart()) return
      await retryHeldStarts()
      if (!c.mayStart()) return
      await stopFinishedCoordinators()
      if (!c.mayStart()) return
      // A running plan's finished workers and reviewers. Before the finished Runs' release, so a Run that finishes
      // inside this pass is that one's alone, under its grace, and no session is released twice in one pass
      await rotation.releaseFinished()
      if (!c.mayStart()) return
      await releaseIdleWorkers()
      if (!c.mayStart()) return
      // The coordinator's refresh, after the replans above
      await rotation.rotate()
    } finally {
      tidying = false
    }
  }

  /**
   * **One slot, placed: the account, the run worktree, the integration step, the placement, then
   * `worker-start`.** The body of the loop's slot, moved here unchanged so that `dispatchOne` (a
   * person's `tasks dispatch`) places a Task through exactly the path the loop does. What the loop
   * does with each ending stays in the loop (a Gate, a log line, the end of the activation), and what a
   * person's call does with it stays in `dispatchOne` (an answer). `why` is the same fact as `reason`,
   * in English, for that answer: some reasons are Gate questions in the app's language.
   */
  // A project folder whose HEAD is detached only for a moment (a session in it ran `git checkout <commit>` to look, then
  // went back) must not Gate every fork made in that window: the slot waits and the next pass tries again. Only a
  // folder still detached after DETACHED_GRACE_MS is a Gate, for a person to put back on a branch.
  const detachedSince = new Map<string, number>()
  const detachedWait = (runId: string, error: string): SlotEnd | null => {
    if (!isDetachedHeadError(error)) return null
    const since = detachedSince.get(runId) ?? Date.now()
    detachedSince.set(runId, since)
    if (Date.now() - since >= DETACHED_GRACE_MS) {
      detachedSince.delete(runId)
      return null
    }
    return { kind: 'wait', why: 'the project folder is not on a branch right now (detached HEAD); it is tried again' }
  }

  const placeSlot = async (slot: Slot, accounts: Account[], loggedIn: Set<string>): Promise<SlotEnd> => {
    // 사람이 이 Task 에 계정을 지정했으면 그 목록의 첫 계정, 아니면 그 provider 의 기본
    // 계정. 판정은 core 에 있다(accountToDispatchOn) — 이 파일에는 테스트가 닿지 않는다.
    // **갈아탈 순서(체인)는 여기서 넘기지 않는다** — worker-start 를 거쳐 가므로 그 체인은
    // deps.startWorker 래퍼가 다시 계산한다(그래야 CLI 로 띄운 워커도 같은 체인을 받는다).
    // **provider 는 이 Task 의 첫 계정이 정한다.** Slot 에는 그 칸이 없다 — 계정 id 를
    // provider 로 옮기려면 계정 목록을 봐야 하고 그것은 core 가 볼 수 없는 것이라
    // (schedule.ts 의 Slot 주석), 그 한 걸음이 여기 있다. 첫 id 가 목록에 없으면 판정에
    // 넘길 provider 자체가 없으므로 곧바로 Gate 다 — accountToDispatchOn 이 같은 id 를
    // 'assigned-unusable' 로 답할 자리이고, 사람이 할 일도 같다(지정을 고친다).
    // T5b: a Task with no account is auto: its provider is the default account's (claude first), and it starts on that
    // provider's account with most room (the automatic order below, which counts the live sessions so a wave spreads)
    const auto0 = slot.accountIds.length === 0
    const firstAccount = auto0
      ? (accounts.find((x) => providerOf(x) === 'claude' && loggedIn.has(x.id)) ?? accounts.find((x) => loggedIn.has(x.id)))
      : accounts.find((x) => x.id === slot.accountIds[0])
    if (auto0 && !firstAccount) return { kind: 'gate', reason: t(c.lang(), 'jobs.gate.noAccount', { provider: 'claude' }), why: `no account is logged in to run task ${slot.taskId} on` }
    if (!firstAccount)
      return {
        kind: 'gate',
        reason: t(c.lang(), 'jobs.gate.assignedAccountUnusable'),
        why: `the first account task ${slot.taskId} names (${slot.accountIds[0]}) is not one Astera holds`
      }
    const slotProvider = providerOf(firstAccount)
    const picked = accountToDispatchOn({
      assigned: slot.accountIds,
      provider: slotProvider,
      accounts,
      loggedInIds: loggedIn
    })
    if (!picked.ok) {
      // 조용히 넘기면 Run 이 이유 없이 서 있다 — 이 슬라이스가 없애려는 증상 그대로다.
      // Reviewer 슬라이스가 "쓸 수 있는 다른 provider 계정이 없다"에 내린 것과 같은 판단이다.
      // **지정한 계정을 못 쓰는 경우도 여기로 온다** — 목록의 첫 칸을 못 쓰는 것과 목록에
      // 쓸 것이 아예 없는 것, 둘 다다. 기본 계정으로도 뒤 칸으로도 갈아타지 않는 이유는
      // accountToDispatchOn 의 주석에 있다: 그가 아끼려던 계정에 일이 간다. 그러니 이
      // Gate 가 사람이 그 사실을 아는 유일한 자리다.
      return {
        kind: 'gate',
        reason:
          picked.reason === 'assigned-unusable'
            ? t(c.lang(), 'jobs.gate.assignedAccountUnusable')
            : t(c.lang(), 'jobs.gate.noAccount', { provider: slotProvider }),
        why:
          picked.reason === 'assigned-unusable'
            ? `the account task ${slot.taskId} is assigned (${slot.accountIds[0]}) cannot be used now: it is not logged in, or is not a ${slotProvider} account`
            : `no ${slotProvider} account is logged in to run task ${slot.taskId} on`
      }
    }
    let accountId = picked.accountId
    // W6-G: no new worker on a nearly spent account. Another account of the chain under the threshold takes it,
    // in rolling's order; with none, the slot waits (no Gate: nothing for a person to do) and a later pass retries.
    if (c.usageGuard) {
      const guard = c.usageGuard
      await guard.refresh()
      // T2: with "Pick accounts automatically" on, the provider's other accounts stand behind the Task's chain, least
      // used first, so a Task whose own accounts are spent starts on one with room instead of waiting (autoOrderOf).
      const auto =
        guard.autoAccounts && guard.view && guard.pauseAt
          ? autoOrderOf(guard as AutoAccountsGuard, { provider: slotProvider, accounts, loggedInIds: loggedIn, nowMs: c.nowMs() })
          : null
      const chain = auto ? (auto0 ? auto.order : withAutoOrder(picked.chain, auto.order, auto.over)) : picked.chain
      const usage = usageChoice(chain, (id) => guard.pauseOf(id))
      if (!usage.ok) return { kind: 'wait', why: usagePauseWhy(usage.pause) }
      if (usage.accountId !== undefined) accountId = usage.accountId
    }
    // **한 Run 은 두 방식 중 하나로만 돈다.** 섞지 않는 이유는 병합 대상이다 — 병합은
    // 깨끗한 작업 트리에만 적용되고, 워커 하나를 합칠 자리에 띄우면 그 폴더에 커밋 안 된
    // 변경이 남아 나머지 워크트리를 합칠 자리가 없어진다. 그래서 동시 실행 손잡이 하나가
    // 두 가지를 정한다: 1 이면 **Run 워크트리**에서 차례대로, 2 이상이면 전부 자기
    // 워크트리에서. 병렬인데 한 폴더는 고를 수 있어서는 안 되는 조합이다 — 서로를 덮어쓴다.
    //
    // **프로젝트 폴더에서 도는 워커는 없다.** 한때 1 이하가 그 뜻이었다(그리고 사용자가
    // 보고 있는 체크아웃에 에이전트가 썼다). 이제 Run 이 자기 워크트리를 갖고, 프로젝트
    // 폴더로 합치는 것은 사람이 상세 창에서 누른다.
    //
    // run 은 slotsToFill 이 만든 스냅숏이 **아니라** 여기서 새로 읽은 상태에서 찾는다 —
    // 그 사이(위) 계정 로그인 조회가 await 를 하나 두었고, 이 for 문의 앞선 슬롯이 이미
    // gateSlot 이나(아래) c.handle(worker-start) 로 실제 쓰기를 했을 수 있어,
    // 이 시점의 상태를 slotsToFill 이 봤던 것과 같다고 가정할 수 없다. run 과 task 가
    // 그래도 반드시 있는 것은 스냅숏이 같아서가 아니라, 이 활성화 동안 Run 이나 Task 를
    // 지우는 명령이 없기 때문이다(slotsToFill 이 이미 run.id === task.runId 인 run 이
    // 있는 Task 만 후보로 냈으므로 — schedule.ts). **이 루프의 동시성 논증은 모두 이
    // 전제(스냅숏이 아니라 슬롯마다 새로 읽는다) 위에 서 있다** — 여기를 "같은 스냅숏"
    // 이라고 잘못 적으면 다음에 이 루프의 레이스를 따지는 사람이 틀린 전제에서 시작한다.
    let state = c.getState()

    // **Run 워크트리를 여기서 만든다 — 게으르게.** Run 을 만들 때가 아닌 이유가 둘이다:
    // 예약 템플릿은 한 번도 돌지 않으므로 워크트리가 필요 없고, pendingStart Run 은
    // 사람이 '실행' 을 누르기 전까지 디스크에 아무것도 남기지 않아야 한다. 이 자리는
    // 둘 다 이미 지난 곳이다(slotsToFill 이 그 둘을 슬롯으로 내지 않는다).
    //
    // 병합 블록보다 앞에 두는 이유: 통합 병합의 대상이 Run 뿌리이므로(아래
    // integrateWorktrees) 그때 이미 있어야 한다. 동시 실행 2 이상인 Run 은 첫 Task 들이
    // 자기 워크트리로 가므로 Run 워크트리를 아무도 만들지 않는데, 그 Run 의 통합 Task 는
    // Run 워크트리에서 돌아야 한다.
    let run = state.runs.find((r) => r.id === slot.runId)!
    if (run.worktree === undefined) {
      try {
        // c.forkRunWorktree(앱과 Host 모두 integrateGit.ts 의 forkWorktree)가 프로젝트가 **서 있는
        // 브랜치**에서 갈라 준다. raw createWorktree 를 부르면 origin/HEAD 에서 갈라져 최종 병합이
        // 엉뚱한 조상을 끌고 온다 — 그 판단은 한 곳에만 있어야 한다.
        const runJob = jobOf(state, run)
        const base = runJob && deliveryBranchOf(state, runJob)
        const created = await c.forkRunWorktree({
          repoPath: runJob?.cwd ?? '',
          name: nameForRun({ id: run.jobId, objective: runJob ? jobNameOf(runJob) : '' }), // W7-D (#68): named as the plan is
          ...(base ? { base } : {})
        })
        const set = await c.handle('run-worktree-set', { run: run.id, worktree: created })
        if (set.status >= 400)
          return {
            kind: 'gate',
            reason: t(c.lang(), 'jobs.integration.runWorktreeNotRecorded', { error: JSON.stringify(set.body) }),
            why: `the run worktree could not be recorded: ${JSON.stringify(set.body)}`
          }
        log(`scheduler: run=${run.id} works in ${created}`)
        // **상태를 다시 읽는다 — run 만이 아니라 state 도.** run 은 아래 runRoot 와 limit
        // 이 그것에서 나오기 때문이다: 방금 기록한 워크트리가 없는 run 을 들고 가면 배치와
        // 통합 병합의 대상이 프로젝트 폴더가 되어, 이 블록이 막으려던 바로 그 결과가 된다.
        //
        // state 는 병합 판정(pendingMerges·workingInRunRoot) 때문이다. 이 자리에서 낡은
        // 스냅숏은 병합을 **덜** 센다 — 그 스냅숏의 뿌리는 프로젝트 폴더이므로 프로젝트
        // 폴더에서 돈 Dispatch 를 "뿌리에서 돌았다"고 보아 건너뛴다. 중간에 워크트리를
        // 갖게 된 Run 은 그런 Dispatch 를 그대로 들고 있고(이 배선 전에 뜬 워커들이다),
        // 그것들은 이제 합쳐야 하는 재료다. 낡은 스냅숏으로 물으면 그 일이 조용히 빠진다.
        state = c.getState()
        run = state.runs.find((r) => r.id === slot.runId)!
      } catch (e) {
        // 프로젝트 폴더가 답하지 않으면(끊긴 공유) `REPO_UNREACHABLE:` 이고 git 은 뜨지 않는다.
        // 저장소에 닿을 수 없으면 `NO_REPO:`, HEAD 가 분리됐으면 `NO_BASE:` 다 —
        // workerBaseFailure 가 그 문장을 만들고 forkWorktree 가 던진다. **저장소가 아닌
        // 폴더도 `NO_REPO:` 다** — forkWorktree 의 `rev-parse --git-dir` 탐침이 먼저
        // 실패하므로 createWorktree 까지 가지 않는다. 그쪽의 `NOT_GIT_REPO:`
        // (create.ts 의 createWorktree, repoRoot 가 null)는 git 은 돌지만 작업 트리가 없는
        // 저장소 — bare 저장소 — 만 남는다. 셋 다
        // 읽을 수 있는 접두사가 붙어 오므로 그대로 Gate 에 싣는다. 다음 상태 변경에 다시
        // 시도한다(사람이 저장소를 고치는 것 자체가 상태 변경은 아니지만, 그 Gate 를 푸는
        // 것이 상태 변경이다).
        const detached = detachedWait(slot.runId, String(e))
        if (detached) return detached
        return {
          kind: 'gate',
          reason: t(c.lang(), 'jobs.integration.runWorktreeNotMade', { error: String(e) }),
          why: `the run worktree could not be made: ${String(e)}`
        }
      }
    }
    // A plan delivered to main loses its worktree and plan branch, but the Run keeps the path, and a Task added to it
    // later would start in a folder that is not there (NO_REPO). The project repo is still asked first: only when it
    // is gone is that a Gate. Otherwise the plan worktree is made again, on the same path from the delivered base.
    if (run.worktree !== undefined && c.worktreeGone && (await c.worktreeGone(run.worktree))) {
      const gone = run.worktree
      try {
        const runJob = jobOf(state, run)
        const base = runJob && deliveryBranchOf(state, runJob)
        const created = await c.forkRunWorktree({
          repoPath: runJob?.cwd ?? '',
          name: nameForRun({ id: run.jobId, objective: runJob ? jobNameOf(runJob) : '' }),
          ...(base ? { base } : {})
        })
        if (!isSamePath(created, gone)) {
          // The name is taken (the plan branch still exists): the Run cannot be moved, so undo the fork and ask.
          await c.reap(created).catch(() => false)
          return {
            kind: 'gate',
            reason: t(c.lang(), 'jobs.integration.runWorktreeNotMade', { error: `${gone} came back as ${created}` }),
            why: `the run worktree ${gone} could not be recreated on its own path (it came back as ${created})`
          }
        }
        log(`scheduler: run=${run.id} worktree ${gone} was removed (delivered); made it again`)
      } catch (e) {
        return {
          kind: 'gate',
          reason: t(c.lang(), 'jobs.integration.runWorktreeNotMade', { error: String(e) }),
          why: `the run worktree could not be made again: ${String(e)}`
        }
      }
    }
    // Task 는 **워크트리 확보 블록 뒤에** 읽는다. 반드시 있는 것은 run 과 같은 이유이고
    // (slotsToFill 이 상태에서 골라낸 id 다), 여기까지 내려온 것은 이 루프의 "슬롯마다
    // 새로 읽는다" 전제를 그대로 지키기 위해서다 — 위 블록이 run-worktree-set 으로 쓰기를
    // 하므로, 그보다 앞에서 읽은 값은 그 쓰기를 못 본 스냅숏이 된다. 지금 읽는 필드가
    // 바뀌지 않는 것들(title·deps)이라 오늘은 무해하지만, 그 논증이 필요 없는 자리로
    // 옮기는 것이 전제를 지키는 값싼 방법이다.
    const task = state.tasks.find((t) => t.id === slot.taskId)!
    const runRoot = runRootOf(run, jobOf(state, run))

    // **통합 단계 — worker-start 앞이다.** 의존이 자기 워크트리에서 돌았다면 그 브랜치의
    // 커밋을 Run 뿌리로 먼저 합친다. 앱이 직접 합치고 **충돌할 때만 에이전트에게**
    // 넘기는 것이 이 기능의 결정이다: 사람을 부르는 것은 모든 작업이 끝났을 때로 미룬다.
    //
    // 통합 Task 자신은 이 단계를 지나지 않는다. 지나면 그 Task 의 deps(= 그 워크트리 Task
    // 들)를 보고 통합 Task 를 위한 통합 Task 를 만들고, 그것이 끝없이 이어진다 — 새 Task 는
    // 매번 새 id 라서 아래의 attempted 가 막지 못한다(integrate.ts 에 자세히 적었다).
    // T11: first onto what other plans of the project delivered since this one began. An integration Task does the
    // merging itself, so it starts as it is
    if (!isIntegrationTask(task)) {
      // T4: origin conflicts with the plan branch, and an integration Task merges it first
      const held = originSyncHold(state, slot.runId)
      if (held?.status === 'failed')
        return {
          kind: 'gate',
          reason: t(c.lang(), 'jobs.integration.taskFailed', { task: held.id }),
          why: `its integration task ${held.id}, merging origin into the plan branch, failed`
        }
      if (held) return { kind: 'wait', why: `it waits for integration task ${held.id} (${held.status}), which merges origin into the plan branch` }
      const fresh = await refreshRun(slot.runId, slot.taskId)
      if (fresh.kind === 'wait') return fresh
      if (fresh.kind === 'gate') return { kind: 'gate', reason: fresh.reason, why: fresh.reason }
      state = c.getState()
    }
    const merges = isIntegrationTask(task) ? [] : pendingMerges(state, slot.taskId)
    if (merges.length > 0) {
      // **이미 통합 Task 가 있으면 새로 만들지 않는다.** 아직 끝나지 않았으면 그것을
      // 기다린다. 실패했어도 만들지 않는다 — 즉시 실패하는 통합은 상태 변경마다 Task 를
      // 하나씩 늘리게 되고 그것은 경계가 없다. 보이는 정지가 조용한 쌓임보다 낫다(실패한
      // Task 는 그래프에 그대로 남고, 거기서 다시 띄우는 것이 사람의 길이다).
      const existing = integrationTaskFor(state, slot.taskId)
      // Only when the merge worker itself failed is it the owner's (owner spec 2026-10-18, part 2).
      if (existing?.status === 'failed')
        return {
          kind: 'gate',
          reason: t(c.lang(), 'jobs.integration.taskFailed', { task: existing.id }),
          why: `its integration task ${existing.id} failed, so the worktrees it depends on are not merged`
        }
      if (existing && existing.status !== 'completed') {
        log(
          `scheduler: task=${slot.taskId} waits for integration task=${existing.id} (${existing.status})`
        )
        return { kind: 'wait', why: `it waits for its integration task ${existing.id} (${existing.status}) to finish` }
      }
      // Run 뿌리에서 도는 워커가 있으면 합치지 않는다 — 그 워커가 읽은 트리를 그
      // 아래에서 갈아치우는 일이고, 그 실패는 조용하다(integrate.ts 에 이유가 있다).
      // 다음 상태 변경에 다시 본다. 그 워커가 끝나는 것 자체가 상태 변경이다.
      if (workingInRunRoot(state, slot.runId)) {
        log(`scheduler: task=${slot.taskId} waits — a worker is still working in ${runRoot}`)
        return {
          kind: 'wait',
          why: `the worktrees it depends on must be merged into ${runRoot} first, and a worker is still working there`
        }
      }
      // **여기서부터 git 이 돈다.** 위까지는 상태만 본다 — runScheduler 는 모든 저장마다
      // 불리고 그 대부분은 합칠 것이 없는 저장이므로, 그 바퀴에 git 프로세스를 띄우지 않는다
      // (슬롯이 없을 때 계정 조회 앞에서 빠지는 것과 같은 성격이다).
      // T3: a reuse Task's dep folder is kept, it starts there
      const integration = await c.integrate(runRoot, merges, pendingMergeHeads(state, slot.taskId), task.worktree === 'reuse' ? { reap: false } : undefined)
      if (integration.kind === 'human') {
        const reason = integration.message ? t(c.lang(), integration.message.key, integration.message.params) : integration.reason
        return { kind: 'gate', reason, why: integration.reason }
      }
      if (integration.kind === 'agent') {
        // 통합 Task 가 이미 completed 인데 아직 깨끗하지 않다면 넘길 곳이 없다 — 두 번째
        // 통합 Task 를 만들지 않기로 했으므로 사람에게 간다. 조용히 넘기면 사용자에게
        // 남는 것은 '완료된 통합 Task 와 이유 없이 서 있는 Task' 뿐이어서 문제가 보이지
        // 않는다(실패한 통합 Task 는 그래프에서 스스로 보이므로 그쪽은 Gate 가 아니다).
        if (existing) {
          return {
            kind: 'gate',
            reason: t(c.lang(), 'jobs.integration.stillCannotMerge', { reason: integration.reason }),
            why: `the worktrees it depends on still cannot be merged although the integration task finished: ${integration.reason}`
          }
        }
        // 통합 Task 도 **task-create 로** 만든다 — 앱이 createTask 를 직접 부르지 않는다.
        // 문은 하나다. `runId` 도 명시한다: 그 인자가 없으면 task-create 는 '가장 마지막에
        // 만들어진 Run' 을 쓰고(server.ts), 그것은 이 슬롯의 Run 이 아닐 수 있다.
        const created = await c.handle('task-create', {
          runId: slot.runId,
          // parentId 가 "이 Task 의 통합 Task" 라는 표식이다 — 다음 바퀴에 그것을 보고
          // 두 번 만들지 않는다(integrate.ts 의 integrationTaskFor).
          parent: slot.taskId,
          deps: worktreeDepsOf(state, slot.taskId),
          // task-create requires an account; the merge runs on the waiting Task's, and is not reviewed
          account: (task.accountIds ?? []).join(','),
          noReview: true,
          // The title shows in the graph, so it is the owner's language (c.lang(), like this file's Gate reasons); the
          // spec is read by an agent, so it stays English (as buildSpecFile's duties). The integration Task is found by
          // its parentId (integrate.ts isIntegrationTask), never by this title. 80 characters is what task-create
          // cuts a title it makes itself to.
          title: t(c.lang(), 'jobs.integration.title', { title: task.title }).slice(0, 80),
          spec: buildIntegrationSpec({
            mergeInto: runRoot,
            reason: integration.reason,
            worktrees: integration.worktrees
          })
        })
        if (created.status >= 400) {
          return {
            kind: 'gate',
            reason: t(c.lang(), 'jobs.integration.taskNotMade', { error: JSON.stringify(created.body) }),
            why: `the integration task that merges the worktrees it depends on could not be made: ${JSON.stringify(created.body)}`
          }
        }
        log(`scheduler: integration task created for task=${slot.taskId} — ${integration.reason}`)
        // 이번 회차에서 이 Task 는 띄우지 않는다. 통합 Task 는 방금의 setState 로 스케줄러가
        // 한 바퀴 더 돌 때 스스로 슬롯이 된다(deps 가 이미 전부 completed 이므로 ready 다).
        return {
          kind: 'wait',
          why: `the worktrees it depends on must be merged first, so an integration task was made for that (${String((created.body as { id?: unknown } | null)?.id ?? '')}); it runs first`
        }
      }
    }

    // 통합 Task 는 동시 실행 손잡이와 상관없이 Run 뿌리에 놓이므로(아래 배치 예외), 그
    // 자리에 이미 도는 워커와 **겹치지 않게 한다.** 접합점이 둘이면 통합 Task 도 둘이
    // 만들어질 수 있고, 그 둘을 같은 폴더에 함께 띄우면 서로의 index.lock 과 서로가 만든
    // 병합을 밟는다 — 한 폴더에 병렬 워커를 두지 않는다는 Task 배치 규칙의 이유가 그대로
    // 여기에도 있다. 뒤의 것은 다음 상태 변경에 다시 본다(앞의 것이 끝나는 것 자체가 상태
    // 변경이다).
    if (isIntegrationTask(task) && workingInRunRoot(state, slot.runId)) {
      log(
        `scheduler: integration task=${slot.taskId} waits — a worker is still working in ${runRoot}`
      )
      return { kind: 'wait', why: `it merges into ${runRoot}, and a worker is still working there` }
    }

    const limit = jobOf(state, run)?.concurrency ?? DEFAULT_CONCURRENCY
    // **통합 Task 는 Run 워크트리에서 돈다 — Task 별 워크트리 규칙의 예외다.** 예외인
    // 이유는 그 Task 의 일 자체가 "이 뿌리로 합치는 것" 이라서다: 자기 워크트리에서 돌면
    // origin 기준으로 갈라진 다른 브랜치에 합치게 되어 아무 값이 없고, buildSpecFile 이
    // 붙이는 커밋 의무("이 워크트리에 커밋하라")가 spec 본문("이 폴더에 합치고 커밋하라")과
    // 정면으로 부딪힌다(코디네이터가 검토 spec 을 구현자 템플릿으로 감싸지 않는 것과 같은
    // 부류의 충돌이다). 섞지 않는 원래 이유(합칠 폴더에 커밋 안 된 변경이 남으면 합칠
    // 자리가 없어진다)는 여기서도 지켜진다: 그 spec 이 끝에 작업 트리를 깨끗하게 두라고
    // 요구하고, 그 Dispatch 가 열려 있는 동안은 workingInRunRoot 가 앱의 병합을 막는다.
    //
    // **스케줄러의 배치는 'current' 를 더 이상 보내지 않는다.** 명시 경로 분기
    // (coordinator.ts)로 보내는 이유는 그쪽이 fs.stat 으로 존재를 확인해 주기 때문이다.
    // 'current' 를 보내는 곳은 **둘뿐이다**: 검토 Dispatch 는 구현자의 트리를 runCwd 로 넘겨
    // 검토자를 정확히 그 트리에, 커밋 의무 없이 세우고(startReview), CLI 에서는 사람이
    // `--worktree current` 를 직접 쓸 수 있다. 상세 창의 수동 띄우기 버튼은 셋째였는데
    // 이제 아무 배치도 보내지 않는다 — 그 결정은 worker-start 의 기본값이 Run 에게 묻는다
    // (server.ts).
    // T3: a `--worktree reuse` Task continues in its dep's worktree (kept for it when the dep merged), with the plan
    // branch merged in first: other finished Tasks' work, a fast-forward as the dep's commits are in it. A refusal
    // (worktreeRefusal), a folder gone or a merge that does not go clean places it as `new`: that fork has the dep's
    // work too, only not its build state.
    let reuse = isIntegrationTask(task) || limit <= 1 ? undefined : reuseFolderOf(state, task, runRoot)
    if (reuse !== undefined && !c.isRegisteredWorktree(reuse)) {
      log(`scheduler: task=${slot.taskId} cannot reuse ${reuse}: the folder is gone; it gets a new worktree`)
      reuse = undefined
    } else if (reuse !== undefined) {
      let caught: Integration
      try {
        caught = await c.integrate(reuse, [runRoot], undefined, { reap: false })
      } catch (e) {
        caught = { kind: 'human', reason: String(e) }
      }
      if (caught.kind !== 'merged') {
        log(`scheduler: task=${slot.taskId} cannot reuse ${reuse}: the plan branch did not merge into it (${caught.reason}); it gets a new worktree`)
        reuse = undefined
      }
    } else if (task.worktree === 'reuse' && !isIntegrationTask(task) && limit > 1)
      log(`scheduler: task=${slot.taskId} cannot reuse its dep's worktree (${worktreeRefusal(state, task) ?? 'its dep has no worktree of its own'}); it gets a new worktree`)
    const placement =
      reuse !== undefined
        ? { worktree: reuse }
        : isIntegrationTask(task) || limit <= 1
        ? { worktree: runRoot }
        : {
            // nameForTask 는 이미 slugify 를 거친 값(또는 그것이 던질 때의 Task id)을 낸다 —
            // 여기서 이미 유일성을 보장하지는 않지만, createWorktree 가 받는 이름에 slugify 를
            // 한 번 더 걸어도(naming.ts, 멱등이다) 값이 바뀌지 않고, 충돌(같은 이름의
            // 브랜치·경로)도 candidateName 접미사 루프로 스스로 피한다(create.ts) — 그래서
            // 여기서 접미사를 더 붙이지 않는다.
            worktree: 'new',
            name: nameForTask(task)
          }
    // **잃은 워커를 되살리는 시작이면 retryOf 로 잇는다**(P1 이월 5). 복구 Gate(재조정기의 review,
    // Host 의 잃은 워커 Gate)에 사람이 답하면 Task 가 ready 로 돌아와 이 자리로 온다 — 그 새 시도는
    // 재조정기의 re-dispatch(execute.ts)와 같은 재시도이므로 Timeline 이 재시도 칩을 보이게 같은 칸을
    // 채운다. 판정은 candidates 와 같은 규칙(가장 최근 Dispatch 가 잃은 것인가)이고, 사람이 멈춘
    // 시도(closedBy)나 결과를 보고한 시도는 잃은 것이 아니므로 잇지 않는다.
    const lost = lostAttemptOf(c.getState(), slot.taskId)
    const reply = await c.handle('worker-start', {
      task: slot.taskId,
      agent: slotProvider,
      account: accountId,
      ...placement,
      ...(lost ? { retryOf: lost.id } : {})
    })
    // **떠나는 Host 의 거절은 Gate 가 아니다**(R15). 물러나는 Host 는 retire 가 온 순간부터 모든
    // 시작을 거절하고, worker-start 는 그것을 `retry` 를 실은 409 로 답한다 — "이 Task 를 못
    // 띄운다" 가 아니라 "나중에, 다음 운전자에게 같은 명령을" 이다. 그 자리에 Gate 를 열면 사람이
    // 고칠 것이 없는 Task 가 blocked 로 선다. **이 활성화를 통째로 멈춘다**(break 가 아니라
    // return): 거절된 시작도 openDispatch 와 그 롤백을 커밋하므로 scheduleAgain 이 서 있고, break
    // 로는 다음 바퀴가 남은 슬롯마다 한 번씩 더 떠나는 Host 에게 시작을 청한다. 뒤의 회수도
    // 건너뛴다 — 떠나는 Host 가 세션을 닫고 git 을 돌리지 않는다. 다음 운전자의 첫 바퀴가 둘 다 본다.
    if (reply.status === 409 && typeof (reply.body as { retry?: unknown })?.retry === 'string')
      return { kind: 'leaving', reply }
    // W1-B: the app-wide cap filled between slotsToFill and here (a coordinator's worker took the room).
    // Nothing for a person to fix, so no Gate: the next pass after a worker ends places it.
    if (reply.status === 409 && (reply.body as { atCapacity?: unknown })?.atCapacity === true)
      return { kind: 'wait', why: 'the app-wide worker cap is reached' }
    // A review or repair took the Run's last slot between slotsToFill and here (they are counted, never
    // refused). Nothing for a person to fix, so no Gate: the next pass after a Dispatch closes places it.
    if (reply.status === 409 && (reply.body as { atRunLimit?: unknown })?.atRunLimit === true)
      return { kind: 'wait', why: 'the run is at its concurrency limit' }
    // W5-C: the plan was held from launching between slotsToFill and here. A person's choice, so no Gate.
    if (reply.status === 409 && (reply.body as { held?: unknown })?.held === true)
      return { kind: 'wait', why: 'the plan is held from launching new workers' }
    // W6-G: the account crossed `usagePauseAt` between the check above and here. It resumes on its own.
    if (reply.status === 409 && (reply.body as { usagePaused?: unknown })?.usagePaused !== undefined)
      return { kind: 'wait', why: String((reply.body as { error?: unknown }).error) }
    if (reply.status >= 400) {
      const detached = detachedWait(slot.runId, JSON.stringify(reply.body))
      return detached ?? { kind: 'refused', reply }
    }
    detachedSince.delete(slot.runId)
    return { kind: 'started', reply }
  }

  // 자동 진행. **setState 뒤에 매단다** — 새 Task 가 ready 가 되거나 자리가 비는 경로가 일곱이고
  // (task-create, worker_done, 검증 결과, 검토 결과, gate-resolve, worker-stop, task-update),
  // 명령마다 훅을 달면 하나를 빠뜨린다. 빠뜨렸을 때의 증상은 "Task 가 이유 없이 안 돈다"이고,
  // 그것은 이 기능 계열이 없애려는 바로 그 증상이다. setState 는 상태가 저장되는 유일한 문이다.
  //
  // 띄우는 길은 c.handle(handleCommand) 하나뿐이다 — openDispatch 나 deps.startWorker 를 직접 부르면
  // CLI 가 지나는 검사(회로 차단, 열린 Dispatch, 실패 롤백)를 앱만 건너뛰는 두 번째 문이 생긴다.
  let scheduling = false
  let scheduleAgain = false
  /** Who waits for `scheduling` to drop: a `dispatchOne` that arrived during a pass. */
  let idleWaiters: Array<() => void> = []
  const wakeIdle = (): void => {
    const waiting = idleWaiters
    idleWaiters = []
    for (const w of waiting) w()
  }
  const runScheduler = async (): Promise<void> => {
    // 재진입 가드 — 띄우기가 openDispatch 를 커밋하면 그것이 다시 setState 를 부른다. 도는 중이면
    // 표시만 남기고 빠지고, 끝난 뒤 한 번 더 돈다. 8cce9c2 의 startHead 재진입 방어와 같은 모양이다.
    if (scheduling) {
      scheduleAgain = true
      return
    }
    scheduling = true
    try {
      // 이 활성화에서 이미 한 번 손댄 Task. **없으면 아래 do-while 이 영원히 돈다.** worker-start 가
      // 세션을 띄우다 실패하면 server.ts 의 롤백이 Dispatch 를 배열에서 지우고 Task 를 ready 로
      // 되돌리는데, 그 롤백 자체가 setState 라서 scheduleAgain 이 서고, 다음 바퀴의 slotsToFill 은
      // 같은 자리를 그대로 다시 준다 — 롤백 경로는 consecutiveFailures 를 올리지 않으므로 회로
      // 차단도 걸리지 않는다(그것을 올리는 것은 closeDispatch 이고, 그 경로는 세션이 실제로 떴을
      // 때만 지난다). 그래서 실패 → 롤백 → 같은 실패가 CLI 를 무한히 다시 띄운다. 한 활성화 안에서
      // 한 Task 는 한 번만 건드린다: 다음 기회는 다음 상태 변경이 주고, 그때는 정말로 달라진 것이
      // 있다.
      //
      // **아래 gateSlot 이 생겼다고 이것이 남아돌지는 않는다.** Gate 가 열리면 Task 가 blocked 로
      // 가서 그 자리가 후보에서 빠지지만, gate-create 자체가 거절되거나 던지는 경우(그 이유는
      // gateSlot 에 적었다)에는 Task 가 ready 그대로 남는다. 그 경우에 회전을 막는 것은 이것뿐이다.
      const attempted = new Set<string>()
      do {
        scheduleAgain = false
        // **운전자에게 먼저 묻는다**(설계 §4.3) — 앱에서는 서버가 서 있는가(예전의 `if (!orch) return`),
        // Host 에서는 지금 Host 가 모는가다. 바퀴마다 묻는 이유는 아래 슬롯마다 묻는 것과 같다.
        if (!c.mayStart()) return
        // A finished Task lands on its plan branch first (mergeWaves), so a dependent its merge readies is placed in
        // this same lap, not at the next tick
        await mergeWaves()
        // **답할 사람이 없는 질문을 풀어 준다.** `ask` 는 부드리기라 워커가 답이 올 때까지 멈춰
        // 서 있는데, 그 답을 줄 코디네이터가 앱이 만든 Run 에는 없다(inbox.ts 의 머리말 —
        // 실측으로 잡힌 정지다). 사람에게 올리지 않는 이유도 거기 있다. 밖에서 모는 세션이 살아 있으면
        // 그가 답하므로 건드리지 않는다(JobRun.externalCoordinatorSessionId).
        //
        // **Gate 로 올릴 수 없다는 것도 이유의 하나다.** createGate 는 열린 Dispatch 를 가진
        // Task 를 거절하고(state.ts), `dispatched -> blocked` 전이 자체가 없다(types.ts 의
        // ALLOWED). 즉 기다리는 워커가 있는 동안 Gate 는 존재할 수 없다.
        //
        // `UI_CALLER` 는 열린 Dispatch 를 갖지 않으므로 COORDINATOR_ONLY 가드를 지난다
        // (server.ts 의 isWorker 판정). 실패는 로그로만 남긴다 — 이 자리에서 할 수 있는 것이
        // 없고, 다음 바퀴에 같은 질문이 다시 후보로 올라온다.
        for (const id of unattendedQuestions(c.getState(), (sessionId) => c.sessionAlive(sessionId))) {
          const answered = await c.handle('reply', { id, body: NO_COORDINATOR_ANSWER })
          log(
            answered.status >= 400
              ? `inbox: reply rejected message=${id} — ${JSON.stringify(answered.body)}`
              : `inbox: answered an unattended question message=${id} — no coordinator on this run`
          )
        }
        // Awaited only when wired, so a pass with no cap keeps its old timing.
        const maxConcurrentWorkers = c.maxConcurrentWorkers ? ((await c.maxConcurrentWorkers()) ?? null) : null
        // T13: a hold on new starts places nothing; a probe that fails reads as no hold (worker-start still refuses one).
        // A probe that answers at once is not awaited, so a pass that is not held keeps its old timing.
        let heldProbe: boolean | Promise<boolean> = false
        try {
          heldProbe = c.startHeld?.() ?? false
        } catch {
          heldProbe = false
        }
        const startHeld = typeof heldProbe === 'boolean' ? heldProbe : await heldProbe.catch(() => false)
        const slots = slotsToFill(c.getState(), { maxConcurrentWorkers, startHeld }).filter((s) => !attempted.has(s.taskId))
        // 띄울 자리가 없으면 계정 조회까지 가지 않는다. 이 함수는 **모든 저장마다** 불리고 그
        // 대부분은 띄울 것이 없는 저장이다 — 아래 조회에 계정마다 파일(macOS 에서는 Keychain)
        // 읽기가 하나씩 붙으므로, 빈 바퀴에 그것을 치르면 상태를 쓰는 모든 명령이 그만큼 느려진다.
        if (slots.length === 0) continue
        // 계정 조회는 **바퀴마다 한 번**이다. 슬롯마다 부르면 같은 파일 읽기가 슬롯 수만큼 되풀이되고,
        // 활성화 전체에 한 번만 부르면 do-while 이 여러 바퀴 도는 동안(그 사이 워커가 실제로 뜬다)
        // 로그인 상태가 낡는다. "한 바퀴 = 한 스냅숏"이 그 둘의 가운데다.
        //
        // 얻는 방식은 startReview 와 같다(core.ts 의 defaultAccountIdFor 도 같은 모양이다) — 로그인
        // 조회를 순차로 돌리면 계정 수만큼 늘어나므로 병렬로 편다.
        const accounts = await c.accounts()
        const loggedInIds = await Promise.all(
          accounts.map(async (a) => ((await c.loginStatus(a.id)) ? a.id : null))
        )
        const loggedIn = new Set(loggedInIds.filter((id): id is string => id !== null))
        for (const slot of slots) {
          // **슬롯마다 운전자를 다시 묻는다**(설계 §4.3). 이 for 는 await 를 여럿 지나고(계정 조회, 앞 슬롯의
          // worker-start), 그 사이 운전이 다른 프로세스로 넘어갈 수 있다 — 넘어간 뒤에 띄우는 자리는 두
          // 운전자가 같은 ready Task 를 두고 다투는 자리다. 멈추면 새 운전자의 다음 바퀴가 남은 자리를 본다.
          if (!c.mayStart()) break
          attempted.add(slot.taskId)
          // 슬롯 하나의 실패는 **그 슬롯에서 멈춘다.** 거절(status >= 400)과 예외는 여기서 같은
          // 뜻이다 — "이 자리는 지금 못 뜬다" — 이므로 같은 곳으로 보낸다. handleCommand 는 실제로
          // 던진다: 그 안의 setState 가 store.save 의 tmp+rename 을 지나고, 디스크가 찼거나
          // Windows 에서 rename 이 잠기면 거부된다. 잡지 않으면 그 예외가 이 for 를 뚫고 나가
          // **남은 슬롯이 통째로 버려진다** — 상관없는 다른 프로젝트의 Run 이 남의 실패 때문에
          // 서 있게 되고, 하나의 문제가 전부를 세우지 않는다는 이 루프의 전제가 거짓이 된다.
          try {
            const end = await placeSlot(slot, accounts, loggedIn)
            // **떠나는 Host 의 거절은 Gate 가 아니다**(R15). 물러나는 Host 는 retire 가 온 순간부터 모든
            // 시작을 거절하고, worker-start 는 그것을 `retry` 를 실은 409 로 답한다 — "이 Task 를 못
            // 띄운다" 가 아니라 "나중에, 다음 운전자에게 같은 명령을" 이다. **이 활성화를 통째로 멈춘다**
            // (break 가 아니라 return). 이유는 placeSlot 의 그 자리 주석에 있다.
            if (end.kind === 'leaving') {
              log('scheduler: the Host is leaving — no further slot this activation')
              return
            }
            if (end.kind === 'gate') await gateSlot(slot.taskId, end.reason)
            else if (end.kind === 'refused')
              await gateSlot(slot.taskId, t(c.lang(), 'jobs.integration.startFailed', { error: JSON.stringify(end.reply.body) }))
          } catch (e) {
            await gateSlot(slot.taskId, t(c.lang(), 'jobs.integration.startFailed', { error: String(e) }))
          }
        }
      } while (scheduleAgain)

      // **끝난 예약 회차의 워크트리를 걷는다.** 발화마다 폴더가 하나씩 쌓이던 것을 막는다.
      // 판정은 순수 함수가 하고(reapableChildRuns) 여기서는 그 목록을 지운다 — 합치지 않고
      // 지우지만 회차의 커밋은 브랜치에 남는다(removeWorktree 의 `branch -d` 가 합쳐지지 않은
      // 브랜치를 거부한다). 그 브랜치가 남았다는 사실은 reapWorktree 가 `branch deleted=false` 로
      // 로그에 남긴다.
      //
      // 슬롯 루프 뒤인 이유: 회차가 끝나는 순간은 마지막 Task 가 completed 되는 저장이고 그 저장
      // 에는 띄울 슬롯이 없다.
      //
      // **순차로 지운다.** reapWorktree 는 세션을 닫고 그 세션이 실제로 사라질 때까지 조건 폴링을
      // 하므로, 병렬로 부르면 같은 저장소의 git 을 여럿이 동시에 밟는다(run-delete 의
      // removeWorktrees 가 같은 이유로 순차다).
      //
      // **try/catch 를 두지 않는다.** reapWorktree 는 던지지 않는다 — boolean 을 돌려주고 실패는
      // 스스로 로그에 남긴다(reapWorktree 안의 catch 가 로그를 부른다; c.reap 이 그것이다). 감싸면 절대 실행되지
      // 않는 catch 가 하나 생기고, 다음에 읽는 사람은 그것을 "여기서 던질 수 있다"는 신호로 읽는다.
      // **운전자에게 한 번 더 묻는다.** 슬롯마다의 확인이 이 활성화를 break 로 끝냈다면 운전은 이미 다른
      // 프로세스로 넘어갔고, 그 새 운전자의 첫 바퀴가 같은 회차를 걷는다 — 두 프로세스가 같은 워크트리의
      // 세션을 닫고 `git worktree remove` 를 함께 돌리게 된다. 운전하지 않는 프로세스는 일을 하지 않는다.
      // 앱에서는 mayStart 가 언제나 참이므로(orch 는 한 번 서면 내려가지 않는다) 앱의 동작은 그대로다.
      if (!c.mayStart()) return
      // U4: finished Runs' coordinators are stopped (a manual Run's after its grace; L1: again until
      // confirmed), and stale start marks are dropped (L2).
      // 회수보다 앞이다.
      await tidyCoordinators()
      if (!c.mayStart()) return
      // 앱이 등록한 워크트리인가 — 앱에서는 core.worktrees, Host 에서는 자기 레지스트리다(c.isRegisteredWorktree).
      // A worktree that will not go (a file Windows keeps locked) is tried again after a growing wait, and given up
      // on after the waits reach their cap a few times (audit OR-4): it was a kill, a 5 s poll and a failed git
      // remove on every pass.
      const reapable = reapableChildRuns(c.getState(), (p) => c.isRegisteredWorktree(p))
      const stillThere = new Set(reapable.flatMap((r) => r.worktrees))
      for (const p of [...reapRetry.keys()]) if (!stillThere.has(p)) reapRetry.delete(p)
      for (const r of reapable)
        for (const w of r.worktrees) {
          const nowMs = c.nowMs()
          const retry = reapRetry.get(w)
          if (retry && nowMs < retry.nextAt) continue
          if (retry && !retry.gaveUp && retry.capped >= COORDINATOR_STOP_RETRY_CAP_TRIES) {
            // Said once, then tried again quietly every hour (final review I2): a worker someone held, or a folder
            // a window kept open, lets it go later, and a driver (often the Host) lives for days.
            retry.gaveUp = true
            log(`run=${r.runId}: gave up removing its worktree ${w} after ${retry.tries} attempts; trying again hourly`)
          }
          if (await c.reap(w)) reapRetry.delete(w)
          else if (retry?.gaveUp) reapRetry.set(w, { ...retry, nextAt: nowMs + REAP_QUIET_RETRY_MS })
          else reapRetry.set(w, nextTry(retry, nowMs).entry)
        }
    } finally {
      // finally 여야 한다 — 위의 `if (!c.mayStart()) return` 도, handleCommand 안에서 올라오는 예외(디스크가
      // 찬 store.save 가 그것이다)도 이 자리를 지나간다. 한 번이라도 놓치면 scheduling 이 true 로
      // 남아 스케줄러가 앱이 사는 내내 다시는 돌지 않는다.
      scheduling = false
      wakeIdle()
    }
  }

  // `overCoordinator`: the stall watchdog's start of a ready Task its coordinator left unstarted after being told
  const dispatchOne = async (taskId: string, opts?: { overCoordinator?: boolean }): Promise<{ status: number; body: unknown }> => {
    const refuse = (error: string): { status: number; body: unknown } => ({ status: 409, body: { error } })
    while (scheduling) await new Promise<void>((resolve) => idleWaiters.push(resolve))
    scheduling = true
    try {
      if (!c.mayStart()) return refuse('this process does not place Jobs right now')
      const s = c.getState()
      const task = s.tasks.find((x) => x.id === taskId)
      if (!task) return { status: 404, body: { error: `unknown task: ${taskId}` } }
      // slotsToFill's candidate test, less `appDriven`: the person has named this Task.
      if (task.runId === undefined) return refuse(`task ${taskId} belongs to a Job's plan, not to a run`)
      if (task.status !== 'ready') return refuse(`task ${taskId} is ${task.status}, not ready`)
      if (task.consecutiveFailures >= FAILURE_LIMIT)
        return refuse(`task ${taskId} has failed ${task.consecutiveFailures} times in a row (circuit break)`)
      if (s.dispatches.some((d) => d.taskId === taskId && !d.outcome && !d.endedAt))
        return refuse(`task ${taskId} already has a worker`)
      // **The run is judged here, after the wait, not only by the command layer** (review 3, M1): the
      // command read a state from before a pass it may have waited through, and `worker-start` checks
      // neither a pause nor a coordinator. A run paused, handed to a coordinator or finished meanwhile
      // gets no worker.
      const run = s.runs.find((r) => r.id === task.runId)
      const job = run ? jobOf(s, run) : undefined
      if (!run) return refuse(`task ${taskId} names a run that is gone`)
      if ((run.coordinatorSessionId !== undefined && opts?.overCoordinator !== true) || coordinatorStarting(run, c.nowMs()))
        return refuse(`run ${run.id} is driven by its coordinator, which places its tasks`)
      if (run.paused === true || job?.paused === true) return refuse(`run ${run.id} is paused`)
      // W5-C: held from launching meanwhile (jobs-hold)
      if (job?.dispatchHold) return refuse(`job ${job.id} is held from launching new workers`)
      // W1-C: archived meanwhile (lifecycle.ts)
      if (job !== undefined && !isJobActive(job)) return refuse(`job ${job.id} is archived`)
      if (job?.pendingStart === true || outcomeOf(s, run.id) !== 'running')
        return refuse(`run ${run.id} is not running`)
      const limit = job?.concurrency ?? DEFAULT_CONCURRENCY
      const mine = new Set(s.tasks.filter((t) => t.runId === run.id).map((t) => t.id))
      const openHere = s.dispatches.filter((d) => mine.has(d.taskId) && !d.outcome && !d.endedAt).length
      if (openHere >= limit) return refuse(`run ${run.id} is at its concurrency limit: ${openHere} of ${limit} workers are open`)
      const accounts = await c.accounts()
      const loggedIn = new Set(
        (await Promise.all(accounts.map(async (a) => ((await c.loginStatus(a.id)) ? a.id : null)))).filter(
          (id): id is string => id !== null
        )
      )
      if (!c.mayStart()) return refuse('this process stopped placing Jobs while the task was being placed')
      const slot: Slot = { runId: task.runId, taskId, accountIds: task.accountIds as string[] }
      const end = await placeSlot(slot, accounts, loggedIn)
      if (end.kind === 'started') {
        log(`scheduler: task=${taskId} placed on request`)
        const body = (end.reply.body ?? {}) as Record<string, unknown>
        return { status: end.reply.status, body: { ...body, taskId, runId: task.runId } }
      }
      if (end.kind === 'refused' || end.kind === 'leaving') return end.reply
      log(`scheduler: task=${taskId} was asked for and not placed — ${end.why}`)
      return refuse(`task ${taskId} was not placed: ${end.why}`)
    } finally {
      scheduling = false
      wakeIdle()
      // A pass that arrived while this one held the loop ran nothing; it runs now.
      if (scheduleAgain) void runScheduler().catch((e) => log(`scheduler: the pass after a placement on request failed: ${String(e)}`))
    }
  }

  /** 예약 템플릿의 발화. 판정은 core 의 firesDue 가 하고(그쪽에 테스트가 있다) 여기는 그 답대로
   *  명령을 부른다. */
  const orchFireTick = async (): Promise<void> => {
    const { fire, arm } = firesDue(c.getState(), armed, c.nowMs())
    // **아래 await 들보다 먼저 갈아 끼운다.** 회차를 만드는 데 15초가 넘게 걸리면 다음 tick 이
    // 겹쳐 도는데, 그때 무장이 아직 옛 값이면 같은 템플릿이 한 번 더 발화한다.
    armed = arm
    // **순차로 부른다.** 병렬로 띄우면 각 run-spawn 이 자기 진입 시점의 상태에 커밋해서 나중
    // 것이 앞선 것의 자식 Run 을 덮는다 — run-create 가 await 뒤에 getState() 를 다시 읽는 것과
    // 같은 위험이고, 그쪽은 한 명령 안의 await 를 다루지만 이쪽은 명령 사이의 await 다.
    for (const runId of fire) {
      // **발화마다 운전자를 다시 묻는다**(fix round 1, M1). 앞 발화의 run-spawn 은 코디네이터 기동까지
      // 기다리므로 그 사이 운전이 다른 프로세스로 넘어갈 수 있다. 넘어간 뒤의 발화는 버린다: 새 운전자의
      // 무장이 그 시각을 이미 지났을 수 있고, 두 프로세스가 같은 시각을 함께 발화하는 것보다 한 번 잃는
      // 편이 낫다(놓친 발화는 버린다는 규칙과 같은 쪽이다).
      if (!c.mayStart()) {
        log(`scheduled fire dropped job=${runId} — this process no longer drives`)
        continue
      }
      // 템플릿 하나의 실패가 나머지를 막아서는 안 된다 — 무장은 이미 다음 시각으로 넘어갔으므로,
      // 여기서 멈추면 뒤의 템플릿들은 이번 tick 에서 조용히 건너뛰어진다(재시도가 아니라 누락이다).
      try {
        // **Skipped while the Job's latest Run still runs**, as `jobs run` refuses then (the user's ruling
        // of 2026-09-25 on U1). The fire is consumed: `armed` already holds the next fire time, so this
        // one is neither retried on the next tick nor fired late, and the skip is logged once.
        const reply = await c.handle('run-spawn', {
          run: runId,
          unlessRunning: true
        })
        const running = reply.status === 409 ? (reply.body as { running?: unknown } | null)?.running : undefined
        if (typeof running === 'string') {
          log(`scheduled fire skipped job=${runId} — its run ${running} is still running`)
          continue
        }
        // run-spawn 은 `jobs run` 이 회차를 시작하는 그대로 시작한다(U1): 코디네이터 계정이 있으면 그
        // 회차의 코디네이터를 띄운다. **그것만 실패했다면 회차는 이미 있다**(N7) — 답이 그 회차를
        // `runId` 로 싣는다. 잃은 발화가 아니므로 다르게 적는다: 사람이 그 회차 줄의 ▶ 로 다시 띄운다.
        const child = (reply.body as { runId?: unknown } | null)?.runId
        if (reply.status >= 400 && typeof child === 'string')
          log(
            `scheduled run=${child} of job=${runId} has no coordinator — ${JSON.stringify(reply.body)}; ` +
              'restart it from the Jobs list'
          )
        // 실패한 발화는 잃는다 — 무장은 이미 다음 시각으로 옮겨졌으므로 다음 시각에 다시 시도한다.
        // 디스크가 찼거나 win32 에서 rename 이 잠긴 경우가 이 갈래다.
        else if (reply.status >= 400) log(`scheduled spawn failed run=${runId} status=${reply.status}`)
        else log(`scheduled spawn run=${runId} child=${JSON.stringify(reply.body)}`)
      } catch (e) {
        log(`scheduled spawn failed run=${runId}: ${String(e)}`)
      }
    }
  }

  /** 잠든 코디네이터를 깨운다. **판정은 core 에 있다**(unreadUpwardMail) — 이 파일에는 테스트가
   *  닿지 않으므로 규칙을 여기 두면 다음 편집을 막아 줄 것이 없다. 여기 남는 것은 순수 함수가
   *  가질 수 없는 것뿐이다: 세션에 타이핑하고, 바쁜지 보고, 로그를 남긴다.
   *
   *  **바쁜 세션은 건드리지 않는다.** 두 가지를 함께 막는다: (1) 턴 중인 코디네이터는 이미 일하고
   *  있어 깨울 것이 없고, (2) 권한 요청 대화상자는 턴 중에 뜨므로 그때 타이핑하면 Enter 가 화면의
   *  선택지를 승인해 버린다 — 롤링이 같은 위험을 훅 알림으로 막는다(claudeCoordinator.ts 의 onHookEvent).
   *  훅이 아니라 바쁨으로 막는 것은 더 거친 근사다: 대화상자가 떴는데 바쁨이 풀리는 런타임이
   *  있으면 이 가드는 새어 나간다. 그 경우를 실측한 적은 없다. */
  /** What each coordinator was last nudged about (audit OR-2), and whether a nudge pass is running: two ticks that
   *  overlapped typed the same line twice. */
  let nudgeMemo = new Map<string, NudgeMemo>()
  let nudging = false
  const nudgeSleepingCoordinators = async (): Promise<void> => {
    if (nudging) return
    nudging = true
    try {
      await nudgePass()
    } finally {
      nudging = false
    }
  }
  const nudgePass = async (): Promise<void> => {
    if (!c.mayStart()) return
    // 타이머 쪽의 정리(L1, L2) — 앱은 커밋 때만 pass 를 돌리므로, 커밋 없이 때가 온 재시도와 낡은
    // 표시는 이 틱이 맡는다. tidyCoordinators 는 던지지 않는다.
    await tidyCoordinators()
    if (!c.mayStart()) return
    // Before telling Gate answers, so the coordinator hears an auto-answer in this same tick
    await autoAnswer()
    if (!c.mayStart()) return
    await tellGateAnswers()
    if (!c.mayStart()) return
    await mergeWaves()
    if (!c.mayStart()) return
    await tellNotices()
    if (!c.mayStart()) return
    // Before the nudges, so what the watchdog tells is typed in this tick
    await watchStalls()
    if (!c.mayStart()) return
    const before = nudgeMemo
    // Push, not poll (2026-10-18): a coordinator at its prompt (idle) waits for no `check --wait`, so its new mail is
    // typed at the next tick. COORDINATOR_NUDGE_MS is kept only for a session whose state cannot be told.
    const s = c.getState()
    const mail = [
      ...unreadUpwardMail(s, { nowMs: c.nowMs(), staleMs: 0 }).filter((m) => c.sessionBusy(m.sessionId) === false),
      ...unreadUpwardMail(s, { nowMs: c.nowMs(), staleMs: COORDINATOR_NUDGE_MS }).filter((m) => c.sessionBusy(m.sessionId) === null)
    ]
    const planned = planNudges(mail, before, c.nowMs())
    nudgeMemo = planned.memo
    // A nudge not typed is not remembered as one: the next tick may type it.
    const notTyped = (m: { runId: string; sessionId: string }): void => {
      const key = nudgeKey(m)
      const was = before.get(key)
      if (was) nudgeMemo.set(key, was)
      else nudgeMemo.delete(key)
    }
    for (const m of planned.due) {
      if (c.sessionBusy(m.sessionId) === true) {
        notTyped(m)
        continue
      }
      // 세션이 없으면(사용자가 닫았다) 깨울 것이 없다 — 그 자리는 되띄우기가 맡는다.
      if (!c.sessionAlive(m.sessionId)) {
        notTyped(m)
        continue
      }
      // **영어다.** 코디네이터는 영어로 인계받았다(handover.ts) — 롤링이 워커의 재개 문구를
      // 앱의 UI 언어로 타이핑하다 같은 어긋남을 겪었고, 그 주석이 이유를 적어 두었다.
      c.typeInto(
        m.sessionId,
        `Your Run has ${m.messageIds.length} unread message(s). Run \`astera check --json\`, ` +
          'handle them, ack the batch, then end your turn: the next message wakes you.'
      )
      // Enter in the same burst as the text is read as part of the paste and only adds a line (2026-10-19:
      // six nudges piled up unsent in a coordinator's input box); the paste-then-Enter gap every other typist uses
      await new Promise((r) => setTimeout(r, ENTER_DELAY_MS))
      c.typeInto(m.sessionId, '\r')
      log(`coordinator nudged run=${m.runId} session=${m.sessionId} unread=${m.messageIds.length}`)
    }
  }

  // W8-E (#96): an answered Gate is a message in its Run's inbox, which ends the coordinator's `check --wait` within a
  // tick; unread, it is nudged about as any other mail is (below). Told once (inbox.ts gateAnswersToTell).
  const tellGateAnswers = async (): Promise<void> => {
    const s = c.getState()
    for (const g of gateAnswersToTell(s, c.nowMs())) {
      const task = s.tasks.find((t) => t.id === g.taskId)
      // `send` posts into its Task's Run, and a Task that is gone has none
      if (!task) continue
      try {
        const r = await c.handle('send', {
          type: 'status',
          taskId: g.taskId,
          subject: gateAnsweredSubject(g.id),
          body:
            `The owner answered the question on task ${g.taskId}: "${g.question.split('\n')[0].slice(0, 200)}"\n\n` +
            `Answer: ${g.resolution ?? ''}\n\nThe task is ${task.status} now; carry on (start it if it is ready).`
        })
        if (r.status >= 400) log(`run=${g.runId}: the gate-answered message was refused: ${JSON.stringify(r.body)}`)
      } catch (e) {
        log(`run=${g.runId}: the gate-answered message failed: ${String(e)}`)
      }
    }
  }

  // T21: the open questions Astera answers itself (autoAnswer.ts), each through `questions-answer` with one feed line.
  // A question tried once is not tried again in this process: a refusal is the owner's to see, not to repeat.
  // #117: a hands-off plan's questions are answered whatever the setting, each answer a decision on its Job; what has
  // no safe answer goes to the plan's coordinator, whose answer is recorded once it lands (`handedOver`).
  const autoTried = new Set<string>()
  // shortcut: in memory, so a coordinator answer that lands across a Host restart is not recorded; persist if missed
  const handedOver = new Map<string, OpenQuestion>()
  const decide = async (jobId: string, d: Omit<Decision, 'at'>): Promise<void> => {
    const at = new Date(c.nowMs()).toISOString()
    log(`job=${jobId}: decided for the owner (${d.kind}): ${d.choice} — ${d.question}`)
    try {
      await c.recordDecision?.(jobId, { at, ...d })
    } catch (e) {
      log(`job=${jobId}: the decision could not be recorded: ${String(e)}`)
    }
  }
  const handsOffJobOf = (s: OrchState, runId: string) => {
    const run = s.runs.find((r) => r.id === runId)
    const job = run && jobOf(s, run)
    return job !== undefined && handsOffOf(s, job) ? job : undefined
  }
  const autoAnswer = async (): Promise<void> => {
    if (c.autoAnswer === undefined) return
    try {
      const on = await c.autoAnswer()
      await recordHandedOver()
      const listed = await c.handle('questions-list', { status: 'open' })
      if (listed.status >= 400 || !Array.isArray(listed.body)) return
      const s = c.getState()
      const open = (listed.body as OpenQuestion[]).filter((q) => !autoTried.has(q.id))
      const handsOff = open.filter((q) => handsOffJobOf(s, q.runId) !== undefined)
      await holdRefused()
      const due: { a: AutoAnswer; decision?: Omit<Decision, 'at'>; hold?: { taskId: string; reason: string } }[] = on
        ? autoAnswersDue(s, open.filter((q) => !handsOff.includes(q)), c.nowMs()).map((a) => ({ a }))
        : []
      for (const step of handsOffStepsDue(s, handsOff, c.nowMs())) {
        if (step.kind === 'answer') {
          due.push({ a: step.answer, decision: step.decision, hold: step.hold })
          continue
        }
        if (step.kind === 'hold') {
          if (!c.mayStart()) return
          autoTried.add(step.id)
          const job = handsOffJobOf(s, open.find((x) => x.id === step.id)!.runId)
          if (job) await decide(job.id, step.decision)
          refusedHolds.set(step.hold.taskId, step.hold.reason)
          await holdRefused()
          continue
        }
        const q = step.question
        // T11: a worker's question in a Run with no live coordinator goes to the plan's planner, then to the default
        if (await askPlanner(s, q)) continue
        if (handedOver.has(q.id)) continue
        // `send` posts into a Task's Run: a question with no Task (a coordinator's own escalation) names one of its Run's
        const taskId = q.taskId || s.tasks.find((t) => t.runId === q.runId)?.id
        if (!taskId) continue
        if (await tell({ runId: q.runId, taskId, subject: `Decide for the owner: ${q.id}`, body: coordinatorDecideBody(q) })) handedOver.set(q.id, q)
      }
      for (const { a, decision, hold } of due) {
        if (!c.mayStart()) return
        autoTried.add(a.id)
        const q = open.find((x) => x.id === a.id)!
        const r = await c.handle('questions-answer', { id: a.id, answer: a.answer })
        if (r.status >= 400) {
          log(`run=${q.runId}: auto-answer of ${a.id} was refused: ${JSON.stringify(r.body)}`)
          continue
        }
        const job = decision && handsOffJobOf(c.getState(), q.runId)
        // The decision's plan.decided / plan.refused line is the feed's line for it
        if (decision && job) {
          await decide(job.id, decision)
          if (hold) {
            refusedHolds.set(hold.taskId, hold.reason)
            await holdRefused()
          }
          continue
        }
        const line = autoAnswerLine(c.getState(), q, a)
        log(`run=${q.runId}: ${line}`)
        try {
          c.activity?.({ ...watchdogActivity(c.getState(), q.runId, line, q.taskId || undefined), type: 'question.auto-answered' })
        } catch (e) {
          log(`run=${q.runId}: the auto-answer feed line could not be recorded: ${String(e)}`)
        }
      }
    } catch (e) {
      log(`auto-answer: the pass failed: ${String(e)}`)
    }
  }
  /** T11: the worker questions of hands-off Runs with no live coordinator put to the plan's planner, with when they were
   *  first tried and whether the planner was reached. shortcut: in memory, so a Host restart asks the planner again once. */
  const plannerAsked = new Map<string, { at: number; asked: boolean }>()
  /** T11: whether the Run has a coordinator to hand a question to: one that is alive, or one that is starting. */
  const coordinatorLive = (s: OrchState, runId: string): boolean => {
    const run = s.runs.find((r) => r.id === runId)
    return run !== undefined && (run.coordinatorStartingAt !== undefined || (run.coordinatorSessionId !== undefined && c.sessionAlive(run.coordinatorSessionId)))
  }
  /** T11: a worker's ask or escalation of a hands-off plan whose Run has no live coordinator: put to the plan's planner
   *  (`jobs-ask-planner`), its answer recorded once it lands (`handedOver`); answered with ESCALATION_DEFAULT_ANSWER, and
   *  that recorded, when no planner answered within PLANNER_ANSWER_WAIT_MS. false: the question is not the planner's. */
  const askPlanner = async (s: OrchState, q: OpenQuestion): Promise<boolean> => {
    if ((q.source !== 'ask' && q.source !== 'escalation') || coordinatorLive(s, q.runId)) return false
    const job = handsOffJobOf(s, q.runId)
    if (!job) return false
    const nowMs = c.nowMs()
    const seen = plannerAsked.get(q.id)
    if (seen && nowMs - seen.at >= PLANNER_ANSWER_WAIT_MS) {
      if (!c.mayStart()) return true
      plannerAsked.delete(q.id)
      handedOver.delete(q.id)
      autoTried.add(q.id)
      const r = await c.handle('questions-answer', { id: q.id, answer: ESCALATION_DEFAULT_ANSWER })
      if (r.status >= 400) {
        log(`run=${q.runId}: the default answer to ${q.id} was refused: ${JSON.stringify(r.body)}`)
        return true
      }
      const line = (t: string, max: number): string => (t.trim().split('\n')[0] ?? '').slice(0, max)
      const reached = seen.asked ? 'did not answer' : 'could not be reached'
      await decide(job.id, {
        kind: 'escalation',
        ...(q.taskId ? { taskId: q.taskId } : {}),
        question: line(q.question, 300),
        choice: line(ESCALATION_DEFAULT_ANSWER, 200),
        why: `the Run has no live coordinator and the plan's planner ${reached} within ${PLANNER_ANSWER_WAIT_MS / 60_000} minutes: the default`
      })
      return true
    }
    if (seen?.asked) return true
    const r = await c.handle('jobs-ask-planner', { id: job.id, question: q.id }).catch((e: unknown) => ({ status: 500, body: String(e) }))
    plannerAsked.set(q.id, { at: seen?.at ?? nowMs, asked: r.status < 400 })
    if (r.status < 400) handedOver.set(q.id, q)
    else log(`run=${q.runId}: the planner of job ${job.id} could not be asked ${q.id}: ${JSON.stringify(r.body)}`)
    return true
  }
  /** Item 2: the Tasks whose owner-only decision a hands-off plan refused, held once each (`holdForOwner`). One with a
   *  live worker waits until its Dispatch ends: a Task is not blocked under a running worker (types.ts ALLOWED).
   *  shortcut: in memory, so a restart while that worker runs forgets the hold; persist it if that is seen. */
  const refusedHolds = new Map<string, string>()
  const holdRefused = async (): Promise<void> => {
    for (const [taskId, reason] of refusedHolds) {
      if (!c.mayStart()) return
      const s = c.getState()
      const task = s.tasks.find((t) => t.id === taskId)
      if (task && s.dispatches.some((d) => d.taskId === taskId && !d.outcome && !d.endedAt)) continue
      refusedHolds.delete(taskId)
      if (!task || task.status === 'completed' || task.status === 'blocked') continue
      await holdForOwner(taskId, reason)
    }
  }
  /** #117: the questions handed to a hands-off coordinator that it has answered since, each recorded once. */
  const recordHandedOver = async (): Promise<void> => {
    const s = c.getState()
    for (const [id, q] of handedOver) {
      const m = s.messages.find((x) => x.id === id)
      const g = s.gates.find((x) => x.id === id)
      const answer = m ? (m.answered ? m.answerBody : undefined) : g?.status === 'resolved' ? g.resolution : undefined
      const job = handsOffJobOf(s, q.runId)
      if (!m && !g) handedOver.delete(id)
      if (answer === undefined || answer === '' || !job) continue
      handedOver.delete(id)
      const line = (t: string, max: number): string => (t.trim().split('\n')[0] ?? '').slice(0, max)
      await decide(job.id, {
        kind: m ? 'escalation' : 'gate',
        ...(q.taskId ? { taskId: q.taskId } : {}),
        question: line(q.question, 300),
        choice: line(answer, 200),
        why: answer.slice(0, 1000)
      })
    }
  }

  // DispatchLoop.tell
  const tell = async (n: CoordinatorNotice): Promise<boolean> => {
    try {
      const r = await c.handle('send', { type: 'status', taskId: n.taskId, subject: n.subject, body: n.body })
      if (r.status < 400) return true
      log(`run=${n.runId}: the "${n.subject}" message was refused: ${JSON.stringify(r.body)}`)
    } catch (e) {
      log(`run=${n.runId}: the "${n.subject}" message failed: ${String(e)}`)
    }
    return false
  }

  // Push, not poll: a finished Task (with the next ready ones named), then a ready Task left without a worker for a
  // minute while its coordinator is idle. Each told once (inbox.ts).
  const tellNotices = async (): Promise<void> => {
    for (const n of taskOutcomesToTell(c.getState(), c.nowMs())) await tell(n)
    const s = c.getState()
    for (const n of readyReminders(s, c.nowMs(), (id) => c.sessionBusy(id) === false)) await tell(n)
  }

  // Part 2: a Run's finished worktree Tasks go into its plan branch (integrate.ts wavesToMerge), a coordinator's Run or
  // the app's. One merge at a time per Run root, never under a worker working there (workingInRunRoot, as the slot's
  // merge). Both the scheduler's pass (after every commit) and the tick run it; one at a time, so two never merge the
  // same Task.
  let landing = false
  const mergeWaves = async (): Promise<void> => {
    if (landing) return
    landing = true
    try {
      await landWaves()
    } finally {
      landing = false
    }
  }
  const landWaves = async (): Promise<void> => {
    // A merging Task whose merge Task completed is completed with it. A merge Task left ready (its start was refused) is
    // started again; one that failed goes to the owner. In an app-driven Run only a merging Task's: the slot's own
    // merge Tasks (pendingMerges) are its scheduler's.
    const pre = c.getState()
    for (const m of pre.tasks) {
      const run = pre.runs.find((r) => r.id === m.runId)
      const parent = m.parentId === undefined ? undefined : pre.tasks.find((t) => t.id === m.parentId)
      if (!parent || !run) continue
      if (parent.status === 'merging' && m.status === 'completed') {
        await recordMerge({ runId: run.id, taskId: parent.id, runRoot: runRootOf(run, jobOf(pre, run)) })
        continue
      }
      if ((run.coordinatorSessionId === undefined && parent.status !== 'merging') || (m.status !== 'ready' && m.status !== 'failed')) continue
      if (!c.mayStart()) return
      // T1: a hands-off plan's failed merge Task starts again (startMergeWorker), so it waits for the plan branch too
      if ((m.status === 'ready' || handsOffJobOf(c.getState(), run.id)) && workingInRunRoot(c.getState(), run.id)) continue
      await startMergeWorker({ runId: run.id, taskId: parent.id, reason: 'the merge worker failed', worktrees: [] })
    }
    for (const w of wavesToMerge(c.getState(), (p) => c.isRegisteredWorktree(p))) {
      if (!c.mayStart()) return
      if (workingInRunRoot(c.getState(), w.runId)) continue
      await mergeIntoPlan(w)
    }
  }

  /** A Task's branch is in its plan branch: recorded on the Task (`mergedIntoPlanAt`; a merging Task is completed by it)
   *  and told to the Run's coordinator, if it has one. Never throws. */
  const recordMerge = async (w: { runId: string; taskId: string; runRoot: string }): Promise<void> => {
    try {
      const r = await c.handle('task-update', { id: w.taskId, mergedIntoPlan: true })
      if (r.status >= 400) log(`run=${w.runId}: task=${w.taskId}'s merge was not recorded: ${JSON.stringify(r.body)}`)
    } catch (e) {
      log(`run=${w.runId}: recording task=${w.taskId}'s merge failed: ${String(e)}`)
    }
    if (c.getState().runs.find((r) => r.id === w.runId)?.coordinatorSessionId === undefined) return
    await tell({
      runId: w.runId,
      taskId: w.taskId,
      subject: planMergedSubject(w.taskId),
      body: `${w.taskId}'s branch is merged into the plan branch (${w.runRoot}).\n\n${nextActionOf(c.getState(), w.runId)}`
    })
  }

  /** One finished Task's worktree into its plan branch: merged, it is recorded (recordMerge); not, a merge worker takes
   *  it, or, for a merging Task git cannot merge at all, the owner's Gate (it never completes without its merge). The
   *  integration's answer, or what stopped it. Never throws. */
  const mergeIntoPlan = async (w: { runId: string; taskId: string; runRoot: string; worktree: string }): Promise<Integration> => {
    let result: Integration
    try {
      // T3: kept while a Task not finished will continue in it; that Task's own merge reaps it
      result = await c.integrate(w.runRoot, [w.worktree], undefined, reusedLater(c.getState(), w.taskId) ? { reap: false } : undefined)
    } catch (e) {
      result = { kind: 'human', reason: String(e) }
    }
    // A worktree that still holds uncommitted work is kept (integrateWorktrees does not reap it) and not counted merged:
    // the merge worker takes it, as a conflict, so the work reaches the plan branch instead of being lost
    const left = result.kind === 'merged' ? [...(result.dirty ?? []), ...(result.unchecked ?? [])] : []
    if (result.kind === 'merged' && left.length === 0) {
      await recordMerge(w)
      return result
    }
    if (result.kind === 'merged')
      result = {
        kind: 'agent',
        reason: `${left.join(', ')} still holds uncommitted changes (or its git status could not be read): the committed work was merged, the rest is only in that folder. Commit it there, merge it into the plan branch, then report.`,
        worktrees: [{ path: w.worktree, branch: null }]
      }
    log(`run=${w.runId}: task=${w.taskId} did not merge into ${w.runRoot}: ${result.reason}`)
    // T1: a hands-off plan gives a git problem the merge worker can mend to it (uncommitted changes, a merge left half done)
    const mendable = result.kind === 'human' && result.message !== undefined && MENDABLE_INTEGRATION.has(result.message.key) && handsOffJobOf(c.getState(), w.runId) !== undefined
    if (result.kind === 'human' && !mendable && c.getState().tasks.find((t) => t.id === w.taskId)?.status === 'merging') {
      await gateSlot(w.taskId, `${w.taskId}'s branch (${w.worktree}) could not be merged into the plan branch (${w.runRoot}): ${result.reason}`)
      return result
    }
    try {
      await startMergeWorker({
        runId: w.runId,
        taskId: w.taskId,
        reason: result.reason,
        worktrees: result.kind === 'agent' ? result.worktrees : [{ path: w.worktree, branch: null }]
      })
    } catch (e) {
      log(`run=${w.runId}: the merge worker for task=${w.taskId} failed to start: ${String(e)}`)
    }
    return result
  }

  // DispatchLoop.startMergeWorker. The merge Task is told to the coordinator as it starts and as it fails; it is a
  // normal worker (worker-start), in the Run's worktree, on the merged Task's first account, else the one with most room.
  const startMergeWorker = async (a: {
    runId: string
    taskId: string
    reason: string
    worktrees: { path: string; branch: string | null }[]
    /** T11: the merge Task is the one under `taskId` whose spec holds this (a delivered commit), not any merge Task. */
    key?: string
  }): Promise<void> => {
    let s = c.getState()
    const run = s.runs.find((r) => r.id === a.runId)
    const forTask = s.tasks.find((t) => t.id === a.taskId)
    if (!run || !forTask) return
    const runRoot = runRootOf(run, jobOf(s, run))
    const mergeOf = (st: OrchState): Task | undefined =>
      a.key === undefined ? integrationTaskFor(st, a.taskId) : st.tasks.find((t) => t.parentId === a.taskId && t.spec.includes(a.key!))
    let merge = mergeOf(s)
    // T1: a hands-off plan starts its failed merge worker again (failed -> dispatched), FAILURE_LIMIT attempts in all
    const failures = merge ? s.dispatches.filter((d) => d.taskId === merge!.id && d.outcome === 'failed').length : 0
    if (merge?.status === 'failed' && (handsOffJobOf(s, a.runId) === undefined || failures >= FAILURE_LIMIT)) {
      // The merge worker could not do it: now it is the owner's. The Gate goes on the failed merge Task (failed ->
      // blocked), so it is opened once; the owner's answer readies the Task and the next tick starts it again.
      await gateSlot(merge.id, t(c.lang(), 'jobs.integration.mergeWorkerFailed', { task: a.taskId, root: runRoot, reason: a.reason }))
      return
    }
    if (merge && merge.status !== 'ready' && merge.status !== 'failed') return
    if (!merge) {
      const created = await c.handle('task-create', {
        runId: a.runId,
        parent: a.taskId,
        deps: [],
        account: (forTask.accountIds ?? []).join(','),
        noReview: true,
        title: t(c.lang(), 'jobs.integration.title', { title: forTask.title }).slice(0, 80),
        spec: buildIntegrationSpec({ mergeInto: runRoot, reason: a.reason, worktrees: a.worktrees })
      })
      if (created.status >= 400) {
        log(`run=${a.runId}: the merge task for task=${a.taskId} could not be made: ${JSON.stringify(created.body)}`)
        return
      }
      s = c.getState()
      merge = mergeOf(s)
      if (!merge) return
    }
    if (s.dispatches.some((d) => d.taskId === merge!.id && !d.outcome && !d.endedAt)) return
    // T1: its first account when that one is logged in; else (an auto Task, or that account cannot be used) worker-start
    // picks the account with most room, on the provider placeSlot gives an auto Task. Only no account at all is a Gate.
    const accounts = await c.accounts()
    const loggedIn = (await Promise.all(accounts.map(async (x) => ((await c.loginStatus(x.id)) ? x : null)))).filter((x): x is Account => x !== null)
    const named = loggedIn.find((x) => x.id === merge!.accountIds?.[0])
    const on = named ?? loggedIn.find((x) => providerOf(x) === 'claude') ?? loggedIn[0]
    if (!on) {
      await gateSlot(merge.id, t(c.lang(), 'jobs.gate.noAccountAnyProvider'))
      return
    }
    const start = (id?: string) => c.handle('worker-start', { task: merge!.id, agent: providerOf(on), ...(id ? { account: id } : {}), worktree: runRoot })
    let reply = await start(named?.id)
    // That account is out of usage (paused until its window resets): any other with room, as worker-start picks
    if (named && reply.status === 409 && (reply.body as { usagePaused?: unknown })?.usagePaused !== undefined) reply = await start()
    // Refused (the Run's cap, a pause): the merge Task stays ready and the next tick starts it again.
    if (reply.status >= 400) {
      log(`run=${a.runId}: the merge worker for task=${a.taskId} did not start: ${JSON.stringify(reply.body)}`)
      return
    }
    await tell({
      runId: a.runId,
      taskId: merge.id,
      subject: `merge worker ${merge.id} started`,
      body:
        `${a.taskId}'s branch did not merge into the plan branch (${runRoot}): ${a.reason}\n\n` +
        `Astera started merge worker ${merge.id} to resolve it. Do not start workers that work in the plan branch until it ` +
        'reports; the next message says how it ended.'
    })
  }

  // W7-C (#73): see DispatchLoop.usageResumed. Ready Tasks of a Run a coordinator places are the ones its refused
  // worker-starts held; the message names them. A Run paused, held or not active places nothing, so is not told.
  const usageResumed = async (accountId: string): Promise<void> => {
    if (!c.mayStart()) return
    const s = c.getState()
    const open = new Set(s.dispatches.filter((d) => !d.outcome && !d.endedAt).map((d) => d.taskId))
    for (const run of s.runs) {
      if (run.coordinatorSessionId === undefined || run.paused) continue
      const job = jobOf(s, run)
      if (!job || !jobActive(job) || job.dispatchHold) continue
      const held = s.tasks.filter((t) => t.runId === run.id && t.status === 'ready' && !open.has(t.id)).map((t) => t.id)
      if (held.length === 0) continue
      try {
        const r = await c.handle('send', {
          type: 'status',
          taskId: held[0],
          subject: 'usage resumed',
          body:
            `Account ${accountId} is under the usage pause threshold again. ` +
            `Retry the worker-start of the ready task(s) now: ${held.join(', ')}.`
        })
        if (r.status >= 400) log(`run=${run.id}: the usage-resumed message was refused: ${JSON.stringify(r.body)}`)
      } catch (e) {
        log(`run=${run.id}: the usage-resumed message failed: ${String(e)}`)
      }
    }
  }

  // DispatchLoop.watchStalls (stallWatch.ts): the detection is pure; here each remedy is applied and gets one feed line
  let stallMemo: Map<string, StallEntry> = new Map()
  let stallAt = -Infinity
  let watching = false
  const watchStalls = async (): Promise<void> => {
    if (c.stallWatch === undefined || watching || c.nowMs() - stallAt < STALL_WATCH_MS) return
    watching = true
    stallAt = c.nowMs()
    try {
      if (!(await c.stallWatch())) {
        stallMemo = new Map()
        return
      }
      // T1: with "Pick accounts automatically" on, held only while the provider has no account with room
      const usage = await stallPauseProbe({
        auto: c.usageGuard?.autoAccounts?.() === true,
        paused: (id) => (c.usageGuard?.pauseOf(id) ?? null) !== null,
        accounts: () => c.accounts(),
        loginStatus: (id) => c.loginStatus(id)
      })
      const planned = stallRemedies(c.getState(), c.nowMs(), stallMemo, {
        busy: (id) => c.sessionBusy(id),
        isRegistered: (p) => c.isRegisteredWorktree(p),
        ...usage
      })
      stallMemo = planned.memo
      for (const r of planned.due) {
        if (!c.mayStart()) return
        try {
          await applyRemedy(r)
        } catch (e) {
          log(`run=${r.runId}: watchdog: ${r.kind} failed: ${String(e)}`)
        }
      }
    } catch (e) {
      log(`watchdog: the check failed: ${String(e)}`)
    } finally {
      watching = false
    }
  }
  /** The feed line (and its log line) of one watchdog action. */
  const watchdogLine = (runId: string, reason: string, taskId?: string): void => {
    log(`run=${runId}: watchdog: ${reason}`)
    try {
      c.activity?.(watchdogActivity(c.getState(), runId, `${reason[0].toUpperCase()}${reason.slice(1)}`, taskId))
    } catch (e) {
      log(`run=${runId}: watchdog: the feed line could not be recorded: ${String(e)}`)
    }
  }
  const mins = (ms: number): number => Math.max(1, Math.round(ms / 60_000))
  const applyRemedy = async (r: StallRemedy): Promise<void> => {
    switch (r.kind) {
      case 'tell-start': {
        const account = (await c.accounts()).find((a) => a.id === r.task.accountIds?.[0])
        const ok = await tell(startNotice(r.runId, r.task, r.since, account ? providerOf(account) : 'claude'))
        watchdogLine(
          r.runId,
          ok
            ? `told the coordinator to start ${r.task.title}: ready ${mins(c.nowMs() - r.since)} min with a free slot and no worker`
            : `${r.task.title} is ready ${mins(c.nowMs() - r.since)} min with no worker, and the coordinator could not be told`,
          r.task.id
        )
        return
      }
      case 'place': {
        const reply = await dispatchOne(r.task.id, { overCoordinator: true })
        if (reply.status >= 400) {
          const why = (reply.body as { error?: unknown } | null)?.error
          watchdogLine(r.runId, `could not start ${r.task.title}: ${typeof why === 'string' ? why : JSON.stringify(reply.body)}`, r.task.id)
          return
        }
        watchdogLine(r.runId, `started ${r.task.title}, the coordinator had not in ${mins(c.nowMs() - r.since)} min`, r.task.id)
        await tell({
          runId: r.runId,
          taskId: r.task.id,
          subject: `watchdog: task ${r.task.id} started by Astera`,
          body:
            `${r.task.id} (${r.task.title}) stayed ready with a free slot after you were told, so Astera started its worker. ` +
            `Do not start it again; its report comes to you as usual.\n\n${nextActionOf(c.getState(), r.runId)}`
        })
        return
      }
      case 'tell-busy': {
        const ok = await tell({
          runId: r.runId,
          taskId: readyWithoutWorker(c.getState(), r.runId)[0]?.id ?? '',
          subject: `watchdog: coordinator busy since ${new Date(r.since).toISOString()}`,
          body:
            `You have been busy for ${mins(c.nowMs() - r.since)} minutes without starting a worker, opening a Gate or sending ` +
            `a message, and there is work waiting:\n\n${nextActionOf(c.getState(), r.runId)}\n\n` +
            'Start it, or end your turn: the next message wakes you. A coordinator still stuck in 5 minutes is replaced.'
        })
        watchdogLine(
          r.runId,
          ok
            ? `the coordinator was busy ${mins(c.nowMs() - r.since)} min with nothing started; told it what is ready`
            : `the coordinator is busy ${mins(c.nowMs() - r.since)} min with nothing started, and could not be told`
        )
        return
      }
      case 'refresh': {
        // A refresh is its own feed line (activity.ts coordinator.refreshed, with this reason): only a failure adds one
        const reply = await refreshRunCoordinator(c, r.runId, `watchdog: busy ${mins(c.nowMs() - r.since)} min, nothing started`)
        if (reply.status >= 400)
          watchdogLine(r.runId, `the coordinator is stuck ${mins(c.nowMs() - r.since)} min and could not be replaced: ${JSON.stringify(reply.body)}`)
        else log(`run=${r.runId}: watchdog: replaced the coordinator ${r.sessionId}, busy ${mins(c.nowMs() - r.since)} min with nothing started`)
        return
      }
      case 'merge': {
        // Not under a worker working in the plan branch: forgotten, so a later check tries again
        if (workingInRunRoot(c.getState(), r.runId)) {
          stallMemo.delete(r.key)
          return
        }
        const result = await mergeIntoPlan({ runId: r.runId, taskId: r.task.id, runRoot: r.runRoot, worktree: r.worktree })
        if (result.kind === 'merged') {
          watchdogLine(r.runId, `merged ${r.task.title} into the plan branch; it had waited since it completed`, r.task.id)
          return
        }
        const merge = integrationTaskFor(c.getState(), r.task.id)
        const s = c.getState()
        const started = merge !== undefined && s.dispatches.some((d) => d.taskId === merge.id && !d.outcome && !d.endedAt)
        watchdogLine(
          r.runId,
          started
            ? `${r.task.title} did not merge into the plan branch (${result.reason}); started merge worker ${merge.id}`
            : `could not merge ${r.task.title} into the plan branch, and no merge worker started: ${result.reason}`,
          r.task.id
        )
        return
      }
      case 'draft-pr': {
        const { ok, line } = await askDraftPr(r.runId, r.done)
        log(line)
        watchdogLine(
          r.runId,
          ok
            ? `the plan branch after ${r.done} task(s) had not been pushed; it is now`
            : `the plan branch after ${r.done} task(s) is still not pushed: ${line.replace(/^run=\S+: /, '')}`
        )
        return
      }
    }
  }

  return {
    run: runScheduler,
    dispatchOne,
    fireTick: orchFireTick,
    nudge: nudgeSleepingCoordinators,
    usageResumed,
    tell,
    startMergeWorker,
    watchStalls,
    /** 운전하지 않는 동안에는 **무장을 들고 있지 않고 버린다.** 들고 있으면 서 있지 않던 동안 지나간
     *  시각이 그대로 남아, 다시 서는 순간 그 시각들이 한꺼번에 발화한다 — 09:00 예약이 15:00 에 도는
     *  것이고, 아무도 그 시각을 잡지 않았다. 놓친 발화는 버리는 것이 이 기능의 결정이므로(설계 2·5절)
     *  다시 서는 것이 재시작과 같아야 한다: 재시작하면 이 Map 은 비어 있고, firesDue 의 첫 바퀴가
     *  nextFireAt(rule, now) 으로 다시 무장하기만 한다. */
    forgetArming: () => {
      armed = new Map()
    },
    armOnly: () => {
      armed = firesDue(c.getState(), armed, c.nowMs()).arm
    },
    nextFireOf: (runId) => armed.get(runId) ?? null
  }
}
