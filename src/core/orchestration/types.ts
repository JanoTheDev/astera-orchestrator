// Pure data for cross-vendor orchestration. This file imports no values — it can end up in the
// renderer compilation target, so no fs/path dependency may leak in (the same rule as
// providers/meta.ts).
import type { Provider } from '../providers/meta'
import type { ScheduleRule } from '../scheduler/rule'
import type { PrState } from '../github/types'

export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'dispatched'
  | 'validating'
  | 'reviewing'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'blocked'
export type Outcome = 'succeeded' | 'failed'
/** Observed state of the session a Dispatch owns. outcome_unknown = cannot be proven (section 7 of
 *  the orchestration guide) */
export type WorkerState = 'ready' | 'failed' | 'stopped' | 'outcome_unknown'
export type MessageType =
  | 'status'
  | 'worker_done'
  | 'question'
  | 'escalation'
  | 'heartbeat'
  | 'decision_gate'

/** 한 Run 이 동시에 열어 둘 Dispatch 수의 기본값. 사람이 Run 을 만들 때 바꾼다. */
export const DEFAULT_CONCURRENCY = 3
// W6-C: the most workers that run at once, app-wide (`maxConcurrentWorkers`) and in one Job (`Job.concurrency`)
export const MAX_CONCURRENT_WORKERS = 100

/** Run 수준 완료 수렴 정책. **있으면 켜진 것이다** — 빈 객체도 켜진 것이고, 비운 칸은 아래 상수를 쓴다
 *  (core/orchestration/convergence.ts 의 policyOf). 없는 Run 은 지금까지의 동작이다: 검증·검토 실패가
 *  failed 가 되고 코디네이터가 --retry-of 로 다시 띄운다. 설계 D12. */
export interface ConvergencePolicy {
  /** repair 를 몇 번까지 여는가. 기본 FAILURE_LIMIT. k 번째 연속 실패가 k ≤ 이 값이면 k 번째 repair 를 열고,
   *  이 값+1 번째 실패가 소진이다(설계 §5.1) */
  maxFixAttempts?: number
  /** 검토 라운드 상한. 기본 MAX_REVIEW_ROUNDS */
  maxReviewRounds?: number
  /** 이 severity 이상이 blocking. 기본 'high' — critical·high 가 막고, 'medium' 으로 낮추면 medium 도 막는다 */
  blockingSeverity?: 'high' | 'medium'
  /** 시간 예산, 분 (명세 §40). 없으면 시간 예산이 없다 — 시도 횟수만이 상한이다.
   *
   *  시계는 이 Task 가 **처음 validating 이 된 때**부터 돈다(`Task.convergenceStartedAt`). Task 를
   *  만든 때가 아닌 이유: 의존 Task 를 기다린 시간이 수렴 예산에 들어가면 안 된다.
   *
   *  넘겨도 **도는 수리를 죽이지 않는다** — 명세 §13 의 "자동 무한 재실행 금지" 는 새로 띄우지
   *  말라는 것이고, 돌고 있는 워커를 끊으면 그 시도의 결과를 잃는다. */
  maxTotalMinutes?: number
}
// W6-C: raised from 2. A Job's `convergence.maxReviewRounds` still overrides it.
export const MAX_REVIEW_ROUNDS = 5
/** check 하나의 타임아웃. RunConfig 에 타임아웃 칸이 없어 P0 는 상수다 (설계 §7). 이름이 비슷한
 *  DEFAULT_CHECK_TIMEOUT_MS(아래) 와는 다른 값이다 — 그것은 `check --wait` 롱폴의 5분 마감이고,
 *  이것은 완료 수렴 check 하나가 돌 수 있는 30분 상한이다. */
export const CHECK_TIMEOUT_MS = 30 * 60_000
/** checkHistory 가 configId 마다 들고 있는 라운드 수의 상한 */
export const HISTORY_MAX = 8

/** One finding of a plugin check (plugin Phase 5 C4), as the Host kept it after its checks and cuts (C5). */
export interface CheckDiagnostic {
  file?: string
  line?: number
  message: string
  severity?: 'error' | 'warning'
}

export interface CheckResult {
  /** A run configuration's id, or `plugin:<pluginId>` for a plugin's check (plugin Phase 5 C6) */
  configId: string
  /** RunConfig.name 을 찍어 둔다 — 구성이 뒤에 지워져도 화면과 fix 요청이 이름을 부를 수 있게. A plugin check's is
   *  the plugin's display name */
  name: string
  /** not-run: 앞의 check 가 실패해 돌지 않았다(설계 D9). timed-out: validator 가 두 번 타임아웃을 내면
   *  Gate 로 가므로 판정 함수에는 도달하지 않지만, 화면과 Journal 을 위해 값이 있다. error: a plugin check that
   *  could not be made, twice (plugin Phase 5 C9): no code failure, a question to a person */
  status: 'passed' | 'failed' | 'timed-out' | 'not-run' | 'error'
  exitCode?: number
  /** ANSI 를 벗긴 마지막 4000자. not-run 에는 없다 */
  outputTail?: string
  startedAt?: string
  endedAt?: string
  /** 라운드 사이에서 fail→pass→fail 로 흔들렸다(설계 §7). 자동으로 무시되지 않는다 — 표시만이다 */
  unstable?: true
  /** A plugin check's own words (C4): what it found, or why it could not be made */
  summary?: string
  /** A plugin check's findings, at most 20 (C5, 5d); a passed check keeps none */
  diagnostics?: CheckDiagnostic[]
  /** How many findings it gave, when more than `diagnostics` holds (the Host kept 20, or an event left them out) */
  diagnosticsTotal?: number
  /** Where a plugin check's whole report is, http or https (C5) */
  externalUrl?: string
  /** A person let this round go on without this check (C9 `skip-check`); its status is `not-run` */
  skipped?: true
}

export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
/** What fixing a review issue needs, as the reviewer says (T3). Only `code` is a repair's work; the others are a
 *  running dev server, device, browser or service slot (`environment`), work outside the Task as written (`scope`), a
 *  standing permission (`permission`), or a call only a person makes (`person`). */
export type ReviewNeeds = 'code' | 'environment' | 'scope' | 'permission' | 'person'
export interface ReviewIssue {
  id: string
  severity: ReviewSeverity
  /** 앱이 정책으로 계산한다(convergence.ts 의 isBlocking). 리뷰어가 쓴 값이 아니다 */
  blocking: boolean
  title: string
  description: string
  file?: string
  line?: number
  suggestedFix?: string
  /** Absent means `code` */
  needs?: ReviewNeeds
}

/** 왜 이 Dispatch 가 열렸는가 — check 가 실패했거나 검토가 blocking 이슈를 냈다 */
export type RepairReason = 'check-failure' | 'review-failure'
/** 앱이 특별히 다루는 Gate. exhausted 의 해소는 retry-once / mark-failed 로 갈라지고(server.ts 의
 *  gate-resolve), blocked 는 보통 Gate 처럼 풀린다 — 질문이 왜 막혔는지 말한다 */
// `review-needs-decision` (T3): the review's blocking issue needs something no code change gives (ReviewNeeds). Its
// free-text answer opens one repair outside the budget that carries it (`Dispatch.decision`).
export type GateKind = 'convergence-exhausted' | 'convergence-blocked' | 'check-unavailable' | 'review-needs-decision'
// W6-C: why a Gate opened, when that is something the notices act on. `review-rounds-exhausted`: the reviewer rejected
// the work `maxReviewRounds` times (W6-B escalates it with a sound).
export type GateReason = 'review-rounds-exhausted'

/** worker-start 가 세션을 띄우기 전에 Dispatch 에 적어 두는 자리표시자와 같은 모양(server.ts 의
 *  pendingSessionId). 순수 층은 node:crypto 를 못 쓰므로 newId 의 hex 를 빌린다 — 어떤 세션도 가리키지
 *  않으면 되는 값이다. continuity/events.ts 의 isPlaceholder 가 같은 접두사를 본다. */
export const placeholderSessionId = (): string => `pending:${newId('p').slice(2, 10)}`
export const isPlaceholderSessionId = (id: string): boolean => id.startsWith('pending:')

/** A repository this app has been used in. **The project is a registered thing now, not a path the
 *  app infers every time** (docs/2026-09-21-job-run-split-and-projects-design.md §6): the public CLI
 *  has to name one in a way that survives being typed into a script, and a path is not that.
 *
 *  Registered where the app already decides what the project is — `orch.list` maps the active tab's
 *  folder back to its repository — so the list is the repositories a person has actually opened Jobs
 *  for, and it fills without anyone being asked to add anything. */
export interface Project {
  id: string
  /** The repository root, in the spelling it was registered with. Compared with `isSamePath`, never
   *  with `===`: win32 ignores case and the same root arrives spelled several ways. */
  path: string
  /** What to show. Defaults to the last segment of `path`; kept as a field rather than derived so a
   *  person can change it later without the name moving when a folder does. */
  name: string
  addedAt: string
  // ── W6-H delivery (delivery.ts) ──
  /** How a finished plan lands: `pr` opens one pull request (`run-open-pr`), `push` merges it into `deliveryBranch` and
   *  pushes with no review by a person (`deliverByPush`), T6 `merge` merges it there on this computer and pushes nothing.
   *  Absent reads as `'pr'`. A Job may override it. */
  delivery?: DeliveryMode
  /** The branch a `push` delivery lands on. Absent: the repository's default branch. */
  deliveryBranch?: string
  // ── W7-B project settings (projects.ts `setProjectSettings`); each absent field reads as its PROJECT_DEFAULTS entry ──
  /** W7-A: a plan of this project starts on its own once it holds, with no approval by the owner. */
  autoApprove?: boolean
  /** #117: plans of this project run hands-off (`handsOffOf`): they start on their own, their coordinator answers its
   *  own escalations, and their workers and planner run with permissions bypassed. Implies auto-approve. */
  handsOff?: boolean
  /** The run configuration (run-configs.json) that is this project's test command: the check a new Task of the
   *  project is validated with when it names none (`createTask`). */
  testConfigId?: string
  /** Workers at once for a new plan of this project (`Job.concurrency`), 1–MAX_CONCURRENT_WORKERS. */
  concurrency?: number
  /** Review rounds for a new plan of this project (`ConvergencePolicy.maxReviewRounds`). */
  reviewRounds?: number
  /** W6-D: `Job.replan` for a new plan of this project. */
  replan?: 'waves' | 'off'
  /** The default branch found when the project was added or created; shown, never used to pick a base. */
  defaultBranch?: string
  // W10-A Run as written by name (promptNames.ts)
  /** The folder, repository-relative, whose `<id>-*.md` files the prompt ids typed in Run as written name. Absent: the
   *  first such plan detects it (`detectPromptsDir`) and saves it here. */
  promptsDir?: string
  // ── T3 workspaces (projects.ts) ──
  /** A sub-project of the workspace (root project) with this id: the same repository (`path` is the parent's) under its
   *  own name. A project with sub-projects is a workspace; every plan of a workspace shares one file guard, lease and
   *  overlap scope (schedule.ts `projectKeyOf`). One level only: a parent is always a root. */
  parentId?: string
  /** Repository-relative folders a sub-project usually works in; shown, never enforced. */
  focus?: string[]
  /** A root's: `jobs-set --areas` files a plan under the sub-project named after its first area, creating it
   *  (`autoProjectFor`). Absent reads as true. */
  autoProjects?: boolean
  // ── T5 project policy ──
  /** Kinds of decision the owner grants in advance (`protected-paths`, `migrations`; short kebab-case words): the
   *  coordinator writes a covered grant itself instead of escalating it (handover.ts, exec/autoAnswer.ts `grantOf`). */
  grants?: string[]
  /** The coordinator's model for this project's plans, over the plan-size rule (roleModels.ts `resolveCoordinatorModel`). */
  coordinatorModel?: string
  // ── T4 origin sync (exec/originSync.ts) ──
  /** `off`: running plans of this project are not kept in sync with origin (a repository with no network). Absent: on. */
  originSync?: 'off'
  /** The command run in every new plan and Task worktree to install dependencies. Absent: detected from the lockfile
   *  (core/worktrees/setup.ts); `off`: none; anything else runs as given. */
  setupCommand?: string
  // ── T7 same-file Tasks (schedule.ts `serialFilesOf`) ──
  /** Two Tasks on the same files never run at once, and a done Task's files stay leased until its plan delivers (the
   *  W6-C guard and T9 leases). Absent: they run side by side and the merge worker settles a conflict. Read on the
   *  workspace (root project), whose plans share one guard. */
  serialFiles?: boolean
}

/** W7-B: what a project nobody set up reads as. */
export const PROJECT_DEFAULTS = {
  delivery: 'pr',
  autoApprove: false,
  handsOff: false,
  serialFiles: false,
  concurrency: DEFAULT_CONCURRENCY,
  reviewRounds: MAX_REVIEW_ROUNDS,
  replan: 'waves'
} as const

/** #117: one call a hands-off plan made in the owner's place (`Job.decisions`). */
export type Decision = { at: string; kind: 'approval' | 'escalation' | 'gate' | 'refused'; taskId?: string; question: string; choice: string; why: string }

/** #119: an issue "Let Astera pick" picked or skipped, and why (`Job.pick`). */
export type IssuePick = { number: number; title: string; why: string }

/** W6-H: how a finished plan lands (`deliveryOf`). */
/** T6 `merge`: the plan merges into the delivery branch in the project folder on this computer, validated, never pushed.
 *  `manual`: nothing is delivered by itself. The plan's integration branch is pushed for safekeeping and the finished plan
 *  waits for the owner (`awaiting-review`), who creates the PR or merges from the app (`run-deliver --as pr|push`). */
export type DeliveryMode = 'pr' | 'push' | 'merge' | 'manual'

/** 계획. **무엇을 시킬 것인가이고, 그것이 실제로 돈 기록은 JobRun 이다**
 *  (docs/2026-09-21-job-run-split-and-projects-design.md §4).
 *
 *  두 층은 예약 Job 에 이미 있었다 — 예약이 걸린 Run 이 템플릿이고 발화마다 자식 Run 이 생겼다.
 *  이름이 없어서 셋(템플릿·회차·보통 Run)이 한 배열에 섞였고, `--run` 없는 task-create 가 템플릿에
 *  떨어져 모든 회차로 복사되는 일이 실제로 있었다. 이제 배열이 둘이라 그 코드를 쓸 수 없다. */
export interface Job {
  id: string
  objective: string
  cwd: string
  /** The project this Job belongs to. **Authoritative when present**; `runsForProject` falls back to
   *  deriving it from `cwd` for every Job made before this field existed. That fallback is a read
   *  path for old rows only — nothing is created without this field, so the two never compete as
   *  sources of truth (the `accountId` migration in store.ts records what happens when they do). */
  projectId?: string
  createdAt: string
  /** 동시에 열어 둘 Dispatch 수. 없으면 DEFAULT_CONCURRENCY. */
  concurrency?: number
  /** 이 Run 을 관리할 **코디네이터 세션**을 띄울 계정. 하나다.
   *
   *  **워커 계정과 층이 다르다.** 워커 계정은 Task 가 정하고(`Task.accountIds`), 이것은 그
   *  Task 들을 돌리는 세션의 것이다.
   *
   *  **Task 처럼 목록이 아닌 이유.** 목록은 "한도에 걸렸을 때 갈아탈 순서" 를 뜻하고, 그 값이
   *  있으면 롤링이 계정을 갈아타며 세션을 새로 띄운다. 관리자에게 그것을 주지 않기로 했다 —
   *  계정이 하나면 롤링은 갈아타지 않고 리셋까지 기다린 뒤 **같은 세션에서** 이어간다
   *  (RollCycle.onLimit 은 계정 수가 1이면 언제나 대기를 낸다). 관리 중이던 Run 의 맥락을 잃지
   *  않는 쪽이 이 자리에서는 더 중요하다.
   *
   *  **없으면 코디네이터 없이 앱이 돌린다.** 사이드바는 더 이상 그 상태를 만들지 않지만, 이 칸이
   *  생기기 전에 만든 Run 과 CLI 로 만든 Run 이 그 갈래다 — UI 가 만들지 못하는 것과 코드가 다루지
   *  못하는 것은 다르다. 그때 워커의 질문을 풀어 주는 것은 앱의 그물이다(inbox.ts). */
  coordinatorAccountId?: string
  /** 앱이 이 Job 을 스스로 돌리는가. **UI 가 만든 Job 에만 참이다** — 코디네이터가 만든 Job 을
   *  앱이 함께 돌리면 둘이 같은 ready Task 를 두고 경합하고, 진 쪽(대개 코디네이터)의
   *  worker-start 가 `dispatch already open` 을 받는다. 코디네이터 LLM 에게는 자기 명령이 이유
   *  없이 실패하기 시작하는 일이고, 그것을 어떻게 다룰지는 우리가 통제할 수 없다.
   *
   *  **회차가 아니라 계획의 칸이다** — "누가 이 계획을 운전하는가" 는 회차마다 달라지지 않는다.
   *  예전에는 회차마다 복사됐다(spawnScheduledRun 이 `autoDispatch: true` 를 찍었다). */
  autoDispatch?: boolean
  /** 발화 시각마다 이 Job 의 한 회차를 돌리는 규칙. **있으면 이 Job 은 예약이다** — 계획 자체는
   *  한 번도 돌지 않고 발화마다 회차를 하나 만든다. 세션 예약의 ScheduleConfig 가 아니라 그 규칙
   *  부분만인 이유: ScheduleConfig 는 command 를 필수로 요구하는데(isValidScheduleConfig) Job 에는
   *  타이핑할 명령이 없다 — Task 가 곧 일이다. */
  schedule?: ScheduleRule
  /** 이 Job 이 지금까지 만든 회차의 수. **번호를 여기서 뽑는다.**
   *
   *  회차 개수로 세지 않는 이유가 이 필드의 존재 이유다 — 회차 기록은 사람이 지우고 30일 TTL 도
   *  지우므로(store.ts), 개수로 세면 "N회차"가 뒤로 간다. 실제로 그렇게 보고됐다.
   *  없으면 0 으로 읽는다(이 필드가 생기기 전에 만들어진 Job). */
  fireCount?: number
  /** 사람이 아직 '실행' 을 누르지 않았다. **있으면 이 Job 은 아무것도 시작하지 않는다.**
   *
   *  **회차가 0개인 것으로는 대신할 수 없다.** 보통 Job 이라면 그것으로 충분하지만, 예약 Job 의
   *  회차는 발화가 만드는 것이라 "아직 회차가 없다" 와 "아직 무장하지 않았다" 가 같은 말이 아니다.
   *  무장하지 않은 채로 두는 것이 요점이다 — 여기서 무장해 두면 사람이 Task 를 짜는 동안 지나간
   *  시각이 그대로 첫 발화가 되어, 버튼을 누르는 순간 이미 밀린 회차가 돈다.
   *
   *  **paused 와 다른 칸인 이유.** 둘 다 "돌지 않는다" 를 만들지만 사람에게는 다른 상황이고 다른
   *  버튼이다: 이것은 "아직 시작하지 않았다"(초안이고 '실행' 이 한 번 걷는다), paused 는 "돌던 것을
   *  세워 뒀다"('⏸' 와 '▶' 가 오간다). 한 칸으로 겸하게 했더니 세운 뒤에 '실행' 버튼과 '▶' 가
   *  **같은 일을 하는 두 버튼**으로 나란히 떴다. */
  pendingStart?: boolean
  /** 사람이 이 예약을 세워 뒀다. **있으면 발화하지 않는다.**
   *
   *  돌던 회차를 함께 세우는 것은 JobRun.paused 다 — 세우는 순간 그 Job 의 회차 전부에 붙는다.
   *  이 칸 하나로 겸할 수 없는 이유는 그쪽 주석에 있다. */
  paused?: boolean
  /** 완료 수렴 정책. 있으면 이 Job 의 검증·검토 실패는 앱이 repair 로 되돌린다(설계 D2·D12) */
  convergence?: ConvergencePolicy
  /** Where the Job came from: a job source and its item (plugin Phase 4 J15). Set only by the Host, when it makes the
   *  Job from that item (`jobs-create-from-source`); no caller of `jobs-create` can give it. */
  source?: JobSourceRef
  // ── W1-A role models ──
  /** Per-Job model override per role, ahead of the app's setting (resolveRoleModel, roleModels.ts).
   *  Empty or absent: the app's setting. */
  models?: Partial<Record<'coordinator' | 'planner' | 'worker' | 'reviewer', string>>
  // W1-C plan lifecycle (lifecycle.ts)
  /** What a person named this plan (`jobs rename`). Absent: it is named by its source's title or its objective
   *  (jobNameOf). One line, at most JOB_TITLE_MAX characters. */
  title?: string
  /** When the plan was archived (`jobs archive`). **Present: it starts no new work** (isJobActive) and default lists
   *  hide it; its running sessions are left alone unless the archive asked to close them. */
  archivedAt?: string
  /** A later plan's delivery carried this plan's branch to the base (deliveredBy.ts), so its work landed though its own
   *  delivery did not. The plan's outcome stays as recorded; it reads Delivered. On the Job, not a Run's `deliveryState`:
   *  the fact is about the plan (a Run's own delivery says nothing of another plan's), and the row reads one place. */
  deliveredBy?: { jobId: string; at: string; commit?: string }
  // W6-A: the planner found everything asked for already built (`plan-nothing-to-do`). The Job is archived with it.
  /** When, and the planner's summary (its inputs/existing.md). */
  nothingToDo?: { at: string; summary: string }
  // W1-B: global scheduling.
  /** Where this Job stands when the app-wide `maxConcurrentWorkers` leaves fewer slots than ready
   *  Tasks: higher first (`slotsToFill`). Absent reads as 0. Any integer, negative included. */
  priority?: number
  // W2-A planner stage (planner.ts, exec/plannerStart.ts)
  /** Every planner session `jobs plan` started for this Job, oldest first. **Never emptied**: a session
   *  named here may only plan (plannerRefusal), for as long as it lives, also after the plan is approved. */
  plannerSessionIds?: string[]
  /** The plan's own chat (`jobs-chat-ensure`, console.ts ensureChat): a plain chat session the owner keeps open at any
   *  phase. The latest live id, followed across account rolls; archiving the Job leaves it alone. */
  chatSessionId?: string
  // W5-C holds (schedule.ts appDriven, command.ts jobs-hold)
  /** A person said "stop launching new tasks for this plan" (`jobs-hold`). **Present: no new worker is placed** (no
   *  slot from `slotsToFill`, `worker-start` and `tasks dispatch` refuse), and nothing is closed: running workers
   *  carry on, finish and report as before. `jobs-unhold` takes it away. */
  dispatchHold?: true
  // W6-D wave replanning (replan.ts, exec/replanStart.ts)
  /** Whether a planner looks at the rest of the plan between waves and once more when the last wave is done.
   *  Absent reads as `'waves'`; only a planned Job replans (`replanOn`). */
  replan?: 'waves' | 'off'
  /** How many follow-up waves the completion pass has added to this Job; the 4th escalates (REPLAN_FOLLOW_UPS_MAX). */
  replanFollowUps?: number
  /** The replan under way: its Run, its kind, the wave it stands before, how many Tasks were completed when it began
   *  (`done`), and its planner session once started. **Present: no Task of that Job starts** (`waveOpen`). */
  replanning?: ReplanMark & {
    startedAt: string
    sessionId?: string
    /** The Job was held (`dispatchHold`) before the replan began, so its end leaves the hold. */
    heldBefore?: true
    /** The Tasks it cancelled, as "title: reason". */
    cancelled?: string[]
    /** The deps it dropped from not-started Tasks, as "title: dropped dep titles: reason". */
    droppedDeps?: string[]
    /** The Run's Tasks when it began, id to `updatedAt`: what it added and changed is read against this. */
    before?: Record<string, string>
    /** W7-A: the owner's feedback this replan was started for (`PlanFeedback.at`); its summary is that feedback's change. */
    feedbackAt?: string
    /** T2: the owner opened a chat with the planner on the finished plan (`jobs-chat`): it answers questions and adds
     *  follow-up Tasks only when asked. Like feedback, its follow-ups never count toward REPLAN_FOLLOW_UPS_MAX. */
    chat?: true
  }
  /** The last replan that ended, for this boundary (`replansDue` reads it so a boundary replans once). `escalated`:
   *  why it was handed to the person instead (the plan did not hold, or a 4th follow-up wave); the hold stays then. */
  lastReplan?: ReplanMark & { at: string; summary: string; escalated?: string }
  // W6-H delivery (delivery.ts)
  /** This plan's own delivery, ahead of its project's (`deliveryOf`). Absent: the project's. */
  delivery?: DeliveryMode
  /** This plan's own target branch, its "main", ahead of its project's `deliveryBranch` (`deliveryBranchOf`): the Run
   *  worktree forks from it, and its PR, push or merge lands on it. Absent: the project's. */
  deliveryBranch?: string
  /** The reasoning effort its Task workers use when a Task has none of its own (resolveWorkerEffort). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  // W7-E planner review and final check
  /** Whether this plan's Tasks are reviewed by a fresh reviewer before they count as done. `jobs plan` sets it to
   *  true unless `--no-review` (there or at `jobs create`) set false; `task-create` then marks each new Task of the
   *  Job `reviewRequested`. Absent: no default, each Task's own `--review` decides. */
  review?: boolean
  /** The account `jobs plan` last ran this Job's planner on. A plan with no coordinator account replans on it
   *  (`replanAccountOf`, replan.ts). T5b: the account it actually started on, which may differ from the one named. */
  plannerAccountId?: string
  /** T5b (decision 6): the account the owner named for this plan's planner or coordinator, kept as a preference only:
   *  a start takes it while it has room, else the account with most room (chooseStartAccount), and records that one
   *  in `plannerAccountId` / `coordinatorAccountId`. Absent: none named, the start picks. */
  preferredAccountId?: string
  /** T25: why this plan's planner or coordinator start is waiting (no account has room: which, weekly or 5-hour, when the
   *  earliest limit resets). Set while the start is held, gone once it runs or is given up (exec/workerStart.ts). */
  startWait?: string
  // W7-A plan feedback (exec/plannerFeedback.ts)
  /** This plan's own auto-approve, ahead of its project's (`autoApproveOf`). Absent: the project's. */
  autoApprove?: boolean
  /** #117: this plan's own hands-off, ahead of its project's (`handsOffOf`). Absent: the project's. */
  handsOff?: boolean
  /** #117: what was decided for the owner on a hands-off plan, appended in order. */
  decisions?: Decision[]
  /** T1 chat-first planning: how the planner works: `chat` brainstorms with the person in its terminal, `auto` decides
   *  alone. Absent: `chat`, except `auto` on a hands-off plan (`handsOffOf`) and one an agent session made (set at creation). */
  planning?: 'chat' | 'auto'
  /** T7 objective coverage: the objective items the planner deliberately left out of the plan, each with why
   *  (`jobs-set --left-out`). `validatePlan` accepts an item listed here as covered. */
  leftOut?: LeftOutItem[]
  /** #119: why each issue was picked or skipped by "Let Astera pick". */
  pick?: { at: string; picked: IssuePick[]; skipped: IssuePick[] }
  /** What the owner told the planner (`jobs-feedback`), oldest first, with what the planner changed for each. */
  feedback?: PlanFeedback[]
  /** When the plan started on its own, with no approval step (`jobs-auto-start`). */
  autoStartedAt?: string
  /** #116: when the planner last ended a turn on a plan that holds and the plan waits on the owner (`jobs-plan-ready`,
   *  from the Host's Stop hook): an "ask" plan, or an auto-approve plan whose own start did not go through. Cleared when
   *  a new planner round starts and when the plan starts. Absent: still planning, so there is nothing to approve. */
  planReadyAt?: string
  /** The owner rejected the plan (`jobs-reject`): it is archived with this, and unarchiving keeps it as a record. */
  rejected?: { at: string; reason?: string }
  /** T20: when the plan's Tasks last lost one (a cancelled Task leaves no row to carry a later `updatedAt`). */
  planCancelledAt?: string
  /** T20: the plan's own planner started it because the owner said so in the planner's terminal; `words` are theirs, verbatim. */
  approvedFromChat?: { at: string; words: string }
  // W8-C plan after plan (schedule.ts / blocked.ts / exec/dispatchLoop.ts)
  /** The Job this one is queued after. **Present: it stays `pendingStart`** and its planner is not started until that
   *  Job is delivered (`afterDelivered`); then the Host starts its planner and the project's approval setting decides. */
  after?: string
  // W8-C prompts mode (promptWaves.ts, `jobs-create --mode prompts`)
  /** Run as written: the owner's prompts this plan was made from, one entry per prompt. `source` is the file name or
   *  `doc#<heading>`, `sha256` its text's, `taskId` the Task Astera wrote for it, `skipped` why it got none ("already
   *  done: …"). Present: the planner may not add, cancel or rewrite a Task, and `validatePlan` checks each prompt. */
  verbatim?: { title: string; source: string; sha256: string; taskId?: string; skipped?: string }[]
  // W10-A Run as written by name (promptNames.ts)
  /** The prompts the owner named in the text instead of attaching them: the folder they came from, each id's file
   *  (repository-relative), the ids left out and why, and how "all of" / "next waves" picked. Shown at approval. */
  byName?: { dir: string; picked: { id: string; path: string }[]; skipped: { id: string; why: string }[]; why: string[] }
  // W8-C plan after plan
  /** When the Host escalated that the Job named by `after` stopped (gave up or archived) while this one waits on it
   *  (`afterSweep`, after.ts). Once per stop: cleared when that Job is no longer stopped. */
  afterStopNotified?: string
  // W8-D several plans in one repo (overlap.ts)
  /** Where this plan's Tasks meet another active or queued plan's of the same project (`overlapsOf`): the Host
   *  refreshes it on every commit that changes either plan's Tasks (`refreshOverlaps`). Absent: none. It never blocks
   *  approval; the cross-plan file guard (schedule.ts `editingByProject`) keeps the two apart at run time. */
  overlaps?: PlanOverlap[]
  /** One to three short words for where this plan works (`auth`, `api`, `ui`), set by its planner or `jobs-set --areas`;
   *  `jobs-list --area` filters by them. */
  areas?: string[]
}

/** W8-D: one Task of a plan (`taskId`) meeting one of another plan's (`jobId`, `otherTaskId`), by an overlapping affected
 *  path (`path`, the first of this Task's that collides) or by the same linked issue (`issue`). */
export interface PlanOverlap {
  taskId: string
  jobId: string
  otherTaskId: string
  by: 'path' | 'issue'
  path?: string
  issue?: number
}

/** W7-A: one message of the owner to a plan's planner. `plan`: before approval, to the planner session itself; `run`:
 *  while it runs, through a W6-D replan. `changes`: one short line per change the planner made for it, once it ended. */
export interface PlanFeedback {
  at: string
  text: string
  phase: 'plan' | 'run'
  changes?: string[]
  /** T1: sent while a replan ran and its planner could not take it: the next replan starts with it when that one ends. */
  queued?: true
}

/** W6-D: which boundary a replan is for. `wave` is the wave about to start; a completion pass stands after the last. */
export interface ReplanMark {
  runId: string
  mode: 'wave' | 'completion'
  wave: number
  done: number
}

/** A job source's item a Job was made from: the source (a plugin's id, or `github`), the item's id there, how a person
 *  names it (`Linear ENG-123`), and where to open it. */
export interface JobSourceRef {
  id: string
  itemId: string
  label: string
  /** The ticket's title, to name the Job by where it is shown (plugin 4d): the first line of the context's objective,
   *  at most 300 characters. Someone else's text, so it never goes into the objective's own first line (J14). Absent on
   *  a Job made before 4d. */
  title?: string
  url?: string
}

/** 한 번의 실행. **계획이 실제로 돈 기록이고, 계획 자체는 Job 이다.**
 *
 *  **id 는 옛 Run 의 것을 그대로 물려받는다** — Task.runId, 그 아래 Dispatch, 저널에 이미 적힌
 *  runId 가 전부 이것을 가리키고 있었다. 새 id 를 받는 것은 Job 쪽이다(설계 §5). */
/** A commit range: `base` is where the work started (set once), `head` where it stands (moves with it). Absent fields
 *  were not recorded yet, or the work predates Phase 10. */
export interface GitRange {
  base?: string
  head?: string
}

export interface JobRun {
  id: string
  jobId: string
  /** 몇 번째 회차인가. **1 부터.** 만드는 순간 Job.fireCount 에서 찍어 두므로 앞 회차를 지워도
   *  남은 번호가 바뀌지 않는다. */
  ordinal: number
  createdAt: string
  /** 지금 이 회차를 관리하고 있는 세션 — **Astera 가 띄운 코디네이터다.** 깨우기와 안전망이 이 칸의
   *  유무로 판단하고, 안전망은 밖에서 모는 세션(`externalCoordinatorSessionId`)도 함께 본다.
   *  세션이 사라지면 배선이 이 칸을 지운다.
   *
   *  **사라진 코디네이터를 앱이 다시 띄우지는 않는다.** 탭을 닫는 것은 사람의 결정이고, 곧바로
   *  다시 열면 그 결정을 무시하는 것이다 — 크래시와 구별할 방법도 없다(`kill` 은 표시를 남기지
   *  않는다). 대신 사이드바의 Job 줄에 다시 띄우는 버튼이 나온다(JobRow.coordinatorMissing).
   *  그동안 워커의 질문은 앱의 그물이 풀어 준다(inbox.ts). */
  coordinatorSessionId?: string
  /** The coordinator named by `coordinatorSessionId` is stopped at a usage limit (S6 limits D1).
   *  `since` is when the roll tap first heard the stop; `resetsAt` is the reset it waits for, absent
   *  while the stop is a switch to another account (no reset to wait for).
   *
   *  **It lives on the slot because a coordinator has no Dispatch**, which is where a worker's stop is
   *  recorded (`Dispatch.resumes`). It follows the slot: `rekeyCoordinator` carries it, `attachCoordinator`
   *  starts without it and `detachCoordinator` drops it. The roll tap clears it on every resume or leave
   *  path (exec/rollTap.ts), and `runs wait` reads it (command.ts, limitedUntil). */
  coordinatorStop?: { since: string; resetsAt?: string }
  /** A coordinator start for this Run is in flight since this time (Task 1 fix round 1, I1). **In the
   *  state, not in a process's memory**, because the two starters are two processes: a fire in the
   *  driving Host, and the ▶ on a Run row in the app, which runs the app's own `run-start`. Committed
   *  before the start (in the very commit that makes the Run, for a fire) and dropped by the attach or
   *  by the failure. While it holds, `run-start --run` does nothing, the view shows no ▶, and the Run
   *  counts as running. **Read through `coordinatorStarting`**, which ignores a mark older than
   *  `COORDINATOR_START_WINDOW_MS`: a process that died mid-start must not pin it. */
  coordinatorStartingAt?: string
  /** A stop of the coordinator this slot names was decided at this time and is not confirmed yet
   *  (limits pass L1). `retireCoordinator` (command.ts) writes it after it asks the session to stop,
   *  whether the stop went through, failed or threw, and **keeps the slot**: only the exit release
   *  (`coordinatorReleaseOf`, and the boot sweep) empties it, once the session is really gone, and
   *  `detachCoordinator` drops this mark with it. While it holds, the driving loop sends
   *  `run-coordinator-stop` again after a backoff (dispatchLoop.ts), so a stop that did not land is
   *  retried rather than remembered as done. A new coordinator (`attachCoordinator`) starts without it;
   *  a roll's rekey carries it, since the stop is meant for whatever session the slot follows. */
  coordinatorStopPending?: string
  /** T5: the model the coordinator in `coordinatorSessionId` was started on (`resolveCoordinatorModel`); absent: the
   *  CLI's default, or a coordinator started before this was recorded. */
  coordinatorModel?: string
  /** The session that drives this Run from outside: it made the Run with `run-create` (with no coordinator account),
   *  or took it over with `check --run`, and Astera neither started nor owns it (2026-10-13, spec E1). **Only the inbox net reads it**
   *  (`unattendedQuestions`, inbox.ts): while that session is alive, a worker's question is left to it. Nothing stops,
   *  nudges or types into the session through this field, and nothing empties it when the session ends: whether it
   *  lives is asked when a question is judged, because a chat session's end never reaches the orchestration (E4). A
   *  roll moves it (`rekeyExternalCoordinator`). */
  externalCoordinatorSessionId?: string
  /** 이 회차의 워커들이 일하는 워크트리. **없으면 아직 만들어지지 않았다** — 첫 워커를 띄우기
   *  직전에 만들고 기록한다: 예약의 게으른 포크는 배선이 `run-worktree-set` 으로(src/main/ipc.ts),
   *  코디네이터가 있는 Job 의 첫 실행은 command.ts 가 직접(Host 도 만든다, Host S3).
   *
   *  **Job.cwd 를 덮어쓰지 않고 따로 두는 이유가 이 칸의 존재 이유다.** `cwd` 는 어느 프로젝트의
   *  것인가를 정하고(runsForProject → repoPathOf, view.ts), 그 판정은 워크트리 레지스트리 항목이
   *  살아 있을 때만 워크트리를 저장소로 되돌린다. 회차의 워크트리를 걷으면 그 항목이 사라지므로,
   *  `cwd` 가 워크트리였다면 그 회차가 프로젝트 목록에서 사라진다 — 지울 문까지 함께. 그래서
   *  `cwd` 는 "속한 프로젝트이자 최종 병합 대상", 이 칸은 "일하는 자리" 다.
   *  둘을 함께 읽는 자리는 runRootOf(integrate.ts) 하나다. */
  worktree?: string
  /** The git range this Run worked over (remote runtime design Phase 10): its base when it began and its head as it
   *  moved, recorded by the Host, so its changed files and diffs outlive a reaped worktree. */
  git?: GitRange
  /** 예약을 세울 때 이 회차도 함께 멈췄다.
   *
   *  **Job.paused 하나로 겸할 수 없다.** Dispatch 를 닫는 것만으로는 회차가 멈추지 않는다 — 닫힌
   *  자리에 그 회차의 다음 ready Task 가 곧바로 뜬다. 재개는 Job 의 것만 걷으므로 멈춘 회차는
   *  이어지지 않는다. */
  paused?: boolean
  /** The app (or the Host) places this Run's Tasks itself, although its Job has no `autoDispatch`.
   *  **Only a Run of a scheduled Job with no coordinator account has it**, stamped by `startJobRun`
   *  as the Run is made (U1: a fire behaves like `jobs run`, which a Job without a coordinator account
   *  has placed automatically). Read through `placedByApp` (state.ts), never on its own.
   *
   *  **Why the Run, when `Job.autoDispatch` says the plan's field is the Job's.** Two reasons, both
   *  about what is already on disk (R2). A scheduled Job never carried `autoDispatch` (run-create
   *  withheld it), so a rule that needs the Job's field needs a migration. And a rule derived from
   *  the Job alone (`schedule` and no coordinator account) would reach back to every Run those Jobs
   *  fired before this field existed: their Tasks sat `ready` with nobody placing them, and they would
   *  all start at once on the first pass after an upgrade. Deciding at the fire and stamping the Run
   *  places only what fires from now on. Before the Job/Run split every fired Run carried the same
   *  flag (`spawnScheduledRun`), so this is the old shape back, for this one case. */
  autoDispatch?: boolean
  // ── W2-D: the plan's one pull request (`run-open-pr`) ──
  /** The pull request opened from this Run's integration branch when it completed, or why it could not be. Present:
   *  the driving loop does not try again (`run-open-pr --force` does). */
  pr?: RunPr
  /** T6: when `runs-pr-sync` last checked this Run that has no `pr` record (a manual plan awaiting review): the same
   *  2-minute skip as `pr.landedCheckedAt`. A Run with a `pr` keeps its stamp there. */
  landedCheckedAt?: string
  // ── W6-H: a `push` delivery (`run-deliver`) ──
  /** The pushed commit, or why the push stopped (escalated). Present: the driving loop does not try again
   *  (`run-deliver --force` does). */
  delivery?: RunDelivery
  // ── T3: delivery that finishes by itself (delivery.ts deliveryAttempt) ──
  /** The plan's end delivery (`run-deliver`): pending once seen running, then each attempt, retried with backoff and
   *  asked of the owner once. Persisted, so a restarted Host resumes it. */
  deliveryState?: DeliveryProgress
  /** The plan branch pushed (and, for `pr`, the draft PR updated) after each Task (`run-draft-pr`), retried alike.
   *  `tasksDone`: how many of the Run's Tasks were completed at the last push that went through. */
  branchPush?: DeliveryProgress & { tasksDone?: number }
  // Coordinator rotation (exec/coordinatorRotate.ts)
  /** The fresh coordinators this Run was given (`run-coordinator-refresh`), oldest first, the last 20: why (`wave 3`,
   *  `context 72%`), the session it replaced and the one it started. The feed says "Coordinator refreshed (…)" for each,
   *  and the renderer closes a replaced session's ended tab. */
  coordinatorRefreshes?: { at: string; reason: string; from: string; to: string; wave?: number; contextPct?: number }[]
  // T4 origin sync (exec/originSync.ts)
  /** When the plan branch was last synced with origin (`run-origin-synced`): the next sync is 10 minutes later, or at a
   *  wave boundary. */
  lastOriginSyncAt?: string
}

export interface Task {
  id: string
  /** 이 Task 가 어느 회차의 것인가. **정의 Task 에는 없다** — 그쪽은 jobId 를 든다. 둘 중 하나만
   *  있다(설계 §4.1). */
  runId?: string
  /** 이 Task 가 어느 Job 의 정의인가. **회차에 속한 Task 에는 없다.** 정의는 배치되지 않는다 —
   *  회차가 시작될 때 베껴질 뿐이다. */
  jobId?: string
  title: string
  spec: string
  deps: string[]
  parentId?: string
  status: TaskStatus
  result?: string
  /** What the worker could not reach (environment limits, refused commands), from its succeeded report. A Task with
   *  gaps did not go as planned, so a replan looks at what depends on it. */
  gaps?: string
  /** T12: what this machine could not run and why ("flock: not found on Windows"), from a succeeded report's
   *  `--not-provable`, or from a failed report a hands-off plan took as one (exec/notProvable.ts). In a hands-off plan it
   *  is accepted with a recorded decision and is no deviation; elsewhere it counts like `gaps` (replan.ts wentAsPlanned). */
  notProvable?: string
  filesModified?: string[]
  /** 이 Task 의 워커를 띄울 계정들, **순서대로**.
   *
   *  **이 목록이 provider 의 유일한 출처다.** 예전에는 Run 이 provider 를 들고 있었고(`Run.provider`)
   *  이 칸은 비워 둘 수 있었다 — 비면 그 provider 의 기본 계정으로 갔다. 이제 Run 은 provider 를
   *  모르므로, 계정이 없으면 **어느 CLI 로 띄울지 알 방법이 없다.** 그래서 자동 디스패치는 계정 없는
   *  Task 를 고르지 않고(schedule.ts 의 slotsToFill), 만드는 두 자리가 모두 계정을 요구한다
   *  (server.ts 의 task-create, NewTaskModal).
   *
   *  **그래도 optional 인 이유:** orchestration.json 은 프로세스보다 오래 살고 Run 은 30일 남는다.
   *  이 규칙 전에 만들어진 Task 와 손으로 고친 파일에는 이 칸이 없다. 그런 Task 는 조용히 멈추는
   *  대신 디스패치 시점에 Gate 를 연다 — 사람이 계정을 넣으면 곧바로 돈다.
   *
   *  **목록 안의 계정은 서로 같은 provider 여야 한다.** 섞이면 첫 계정으로 띄운 CLI 가 한도에 걸렸을
   *  때 다른 CLI 계정으로 갈아타려 하고, 그것은 갈아타기가 아니라 다른 프로그램을 띄우는 일이다.
   *  task-create 가 그 목록을 거절하고, UI 는 첫 계정이 고른 provider 로 이후 칸을 좁힌다.
   *
   *  첫 계정으로 띄우고, 나머지는 **한도에 걸렸을 때 갈아탈 순서**다 — 배선이 이 목록을 그대로
   *  세션의 롤링 체인(rollAccountIds)으로 넘긴다. 계정이 하나면 갈아탈 곳이 없어 리셋까지 기다린다
   *  (RollCycle.onLimit 은 계정 수가 1이면 언제나 대기를 낸다).
   *
   *  못 쓰는 지정이 실제로 도달했을 때 무엇을 하는지는 accountToDispatchOn
   *  (core/accounts/dispatchAccount.ts)이 정한다 — **첫 계정**을 못 쓰면 뒤 계정을 올려세우지 않고
   *  그대로 실패해 Gate 를 열고, 첫 계정을 쓸 수 있으면 **뒤 계정** 중 못 쓰는 것만 순서를 지키며
   *  제자리에서 빠진다. */
  accountIds?: string[]
  /** 이 Task 를 완료로 판정할 실행 구성의 id. 없으면 worker_done 을 그대로 믿는다 —
   *  "문서를 고친다" 같은 Task 에 빌드를 거는 것은 틀린 판정이므로 검증 없음이 기본이다. */
  validateConfigId?: string
  /** 순서대로 도는 check 들 — 각각 RunConfig id 다. **validateConfigId 는 이 칸이 생기기 전의 Task 를
   *  읽을 때만 쓴다**(convergence.ts 의 checkConfigIdsOf 가 둘을 합친다); 새 Task 는 이 칸에 쓴다 */
  validateConfigIds?: string[]
  /** 마지막 검증 라운드의 check 별 결과. 라운드마다 덮어쓴다 — 이력은 Journal 과 status 메시지에 */
  checks?: CheckResult[]
  /** configId → 라운드별 판정. unstable 판정의 근거(convergence.ts 의 unstableChecks) */
  checkHistory?: Record<string, ('passed' | 'failed')[]>
  /** A round a person let go on past a check that could not be made (plugin Phase 5 C9 `skip-check`): the attempt whose
   *  work it checks, the results it had, the skipped one last, and the checks still to run. startValidation reads it
   *  through `liveCheckResume`, which holds it to that attempt; the round's verdict clears it, and so does any move out
   *  of `validating` (5a final review C1): the skip is for that round of that work, never for new work. */
  checkResume?: { dispatchId: string; done: CheckResult[]; rest: string[] }
  /** The failed checks of the last round that failed, as `failureSummary` words them. `checks` is
   *  overwritten each round, so this is what still says why a repair ran after the recheck passed. */
  lastFailure?: string
  /** 마지막 검토의 이슈 전부, blocking 여부 포함 */
  reviewIssues?: ReviewIssue[]
  /** 이 Task 가 처음 validating 이 될 때 찍은 완료 정책의 지문(설계 G3, 명세 §37).
   *  `completionPolicyHash` 의 값이다 — 해시가 아니라 읽을 수 있는 정규 문자열이다. */
  policySnapshot?: { key: string; capturedAt: string }
  /** 그 지문이 라운드 사이에 달라졌다(명세 §36). **막지 않고 표시한다** — 사람이 검사를 정당하게
   *  고쳤을 수 있고, 판정은 리뷰어와 사람의 몫이다(§38 이 의심 파일에 대해 하는 것과 같다).
   *  한 번 참이면 그 Task 가 끝날 때까지 참이다: 되돌려 놓아도 "그 사이에 바뀌어 있었다" 는 사실은
   *  남는다. */
  policyChanged?: true
  /** 완료 정책을 만족하지 않은 채 사람이 완료로 옮겼다 (설계 G4, 명세 §30). 이유는 사람이 적은 것
   *  그대로다 — 저널의 TASK_COMPLETED_WITH_OVERRIDE 가 이 칸을 읽는다. */
  completionOverride?: { reason: string; at: string }
  /** 이 Task 가 **처음 validating 이 된** 때 — 시간 예산의 시계(ConvergencePolicy.maxTotalMinutes).
   *  한 번만 찍고 덮지 않는다: 라운드마다 다시 찍으면 예산이 영원히 리셋된다. */
  convergenceStartedAt?: string
  /** 사람이 이 Task 의 자동 수정을 멈췼다(task-update --convergence off). 도는 repair 는 끝까지 가고 그
   *  판정은 Gate 다(설계 §5.1) */
  convergenceOff?: true
  /** When the app merged this completed Task's worktree into its plan branch (the Run's worktree): the wave merge and
   *  the stall watchdog record it (`task-update --merged-into-plan`). What finishedSessions.ts mergedIntoPlan reads. */
  mergedIntoPlanAt?: string
  /** 이 attempt 가 check 의 동작을 바꾸는 파일을 건드렸다(설계 §8.3). 실패 사유가 아니라 표시다 */
  suspiciousFiles?: string[]
  /** T2: the files git saw this Task change (repo-relative, deduped), written when its validation starts, each round
   *  anew; the worker's filesModified stands in when git has no baseline. Once completed, its plan's lease covers these
   *  rather than `affectedPaths` (schedule.ts `leasesByProject`); an empty list leases nothing. Absent: not known. */
  changedFiles?: string[]
  /** 이 Task 를 **다른 provider** 가 읽어 "요구가 충족됐는가"를 판정할지. task-create --review 가
   *  켠다. 검증(validateConfigId)과 독립이고, 둘 다 걸리면 검증이 먼저다 — 컴파일도 안 되는 코드를
   *  읽으라고 에이전트 세션을 태우는 것은 낭비다. */
  reviewRequested?: boolean
  /** Consecutive failure count. 3 means circuit break */
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
  // ── W1-A role models ──
  /** How hard the planner judged this Task; picks the worker model through the difficulty map
   *  (app setting, defaults light=haiku, standard=sonnet, hard=opus — roleModels.ts). */
  difficulty?: 'light' | 'standard' | 'hard'
  /** This Task's own model, ahead of everything else for its worker (resolveWorkerModel). */
  model?: string
  /** This Task's own reasoning effort, ahead of the difficulty map's for its worker (resolveWorkerEffort). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** The provider this Task asks for. Honoured only when that provider has an account; otherwise the
   *  worker runs on claude and the Dispatch says why (pickTaskProvider). The account list
   *  (`accountIds`) still decides what actually starts. */
  provider?: Provider
  // W2-A planner stage (planner.ts): what the planner hands each worker. `spec` stays the work's description.
  /** The worker's explicit prompt. The worker spec file carries it under `spec` (workerSpecOf). */
  prompt?: string
  /** What must hold for this Task to count as done, one check per entry. */
  acceptanceCriteria?: string[]
  /** The files or modules this Task expects to touch, so parallel Tasks can be kept apart. */
  affectedPaths?: string[]
  /** `--no-files`: this ops, audit or docs Task changes no repository file, so it names none (validatePlan accepts the empty list). */
  noFiles?: true
  /** Why the planner picked this Task's `difficulty`, `provider` or `model`: one line. The repair ladder also writes
   *  here when it steps up ("repair N after a failed review: sonnet/medium → sonnet/high", stepRepairLadder). */
  modelReason?: string
  // ── W2-D GitHub links (core/github/taskLinks.ts) ──
  /** This Task's issue, branch, commits and pull requests. GitHub is the tracker; this only points at it. */
  links?: TaskLinks
  // ── W6-A check what exists (planner.ts) ──
  /** Why this Task is planned at all: what the planner found of its item before planning (inputs/existing.md).
   *  `validatePlan` refuses a plan Task without one, so no worker opens on unchecked work. */
  basis?: TaskBasis
  // W8-C prompts mode
  /** The `Job.verbatim` source this Task is, byte for byte (Run as written). */
  verbatimOf?: string
  // T7 objective coverage (objectiveItems.ts)
  /** The numbers of the Job's objective items this Task covers (`--covers 1,3`); `validatePlan` checks every item is
   *  covered here or left out on the Job (`Job.leftOut`). */
  covers?: number[]
  // T9 task kinds (planner.ts kindOf)
  /** What sort of work this Task is; picks the skills its worker is told to use (`--kind`). Absent: `kindOf` reads it
   *  from the title and spec. */
  kind?: TaskKind
  // T3 worktree per Task (planner.ts worktreeRefusal)
  /** Where its worker starts (`--worktree`): `new` a worktree of its own, forked from the plan branch; `reuse` the
   *  worktree and branch of its one dep, kept for it, with the plan branch merged in. Absent: as `new`, placed by the
   *  Run's concurrency. */
  worktree?: 'new' | 'reuse'
}

/** T9: the kinds of work a Task can be. */
export const TASK_KINDS = ['bugfix', 'feature', 'refactor', 'ui', 'audit', 'docs', 'test', 'ops'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

/** T7: one objective item the plan leaves out on purpose: its number (objectiveItems.ts) and why. */
export interface LeftOutItem {
  item: number
  reason: string
}

/** W6-A: an item's state as the planner found it. `built` gets no Task, so it is not one of these. */
export const BASIS_STATES = ['missing', 'partial', 'broken'] as const
export interface TaskBasis {
  state: (typeof BASIS_STATES)[number]
  /** file:line, an issue or PR number, a Job id. */
  evidence: string
}

/** 한 번의 정지와 그 재개. **이 배열이 없으면 "몇 번 이어졌는가" 를 되살릴 방법이 아예 없다** —
 *  롤은 Dispatch 를 닫지 않고 `sessionId`·`accountId` 만 고쳐 쓰고(rollTap 의 rekeyDispatch),
 *  `stopSnapshot` 은 정지마다 덮어써서 직전 하나만 남는다.
 *
 *  **정지와 재개를 한 항목에 담는다.** 둘을 따로 두면 짝을 맞추는 규칙이 하나 더 생기고, 그 규칙이
 *  어긋나는 날 화면이 "세 번 멈추고 두 번 이어졌다" 를 그린다. **마지막** 항목의 `resumedAt` 부재가
 *  곧 "지금 기다리는 중" 이다 — 화면이 그것으로 판정한다. 앞쪽에 열린 채 남은 항목은 지금이 아니라
 *  **끝내 이어지지 않은 정지**를 말한다('stalled' 로 끝난 에피소드가 그 갈래다). */
export interface ResumeEntry {
  /** ISO. 정지가 감지된 시각 */
  stoppedAt: string
  /** 정지를 일으킨 롤 상태 그대로 — `stopSnapshot.reason` 과 같은 값이다 */
  reason: 'waiting' | 'switching'
  /** ISO. `'waiting'` 일 때만(`RollStateEvent.nextRetryAt`). 계정을 바꾸는 쪽은 기다리지 않는다 */
  resetsAt?: string
  /** 정지 시점의 계정 */
  fromAccountId: string
  /** ISO. 재개가 실제로 일어난 시각. **없으면 아직 기다리는 중이다** */
  resumedAt?: string
  /** 재개 후의 계정. 같은 계정에서 이어갔으면 `fromAccountId` 와 같다 — 제자리 재개가 그 갈래다 */
  toAccountId?: string
}

export interface Dispatch {
  id: string
  taskId: string
  provider: Provider
  accountId: string
  /** App session id. The key that ties this to a tab, and the basis for the caller's identity */
  sessionId: string
  /** The provider's own id for this worker's conversation: Claude's statusLine `session_id`, Codex's
   *  rollout `session_id`. Learned after the process is up (the rolling coordinators read it), so
   *  absent until then, and replaced when a roll respawns the process. This is what a native resume
   *  (`claude --resume`, `codex resume`) needs and what the app forgot at every restart before Job
   *  Continuity (P0 design §8). */
  nativeSessionId?: string
  cwd: string
  specPath: string
  retryOf?: string
  startedAt: string
  workerState: WorkerState
  outcome?: Outcome
  endedAt?: string
  /** The git range this attempt worked over in its `cwd`, recorded by the Host (remote runtime design Phase 10). */
  git?: GitRange
  /** Who closed this Dispatch, when a person did. Absent means the worker ended on its own — it
   *  exited, it crashed, or the app went down under it.
   *
   *  **Recovery reads exactly this.** `workerState` cannot tell the two apart: a clean exit and a
   *  `worker-stop` both land on `stopped`. Without the distinction the boot sweep would restart work
   *  a person deliberately stopped — and for `abandon`, whose whole promise is that the resources may
   *  still be live, it would put a second worker in the same worktree. `pause` is here for the same
   *  reason: a paused schedule fire is documented not to continue (docs/jobs.md), so resuming the
   *  schedule must not resurrect its Tasks. */
  closedBy?: 'stop' | 'abandon' | 'pause'
  /**
   * The reset time (epoch ms) for when this Dispatch was judged to have ended at a usage limit.
   * The app derives it from transcript/rollout signals and fills it in — the orchestrator does not
   * write it (read-only). Absent means "either it was not a limit, or it could not be determined",
   * and the two are not distinguished (section 7 of the orchestration guide).
   */
  limitResetsAt?: number
  /** 정지 시점에만 잡을 수 있는 값들. **나머지 Checkpoint 재료는 여기 담지 않는다** — Job 상태·git·
   *  검증 결과는 대기가 몇 시간이어도 디스크에 그대로 있고, 재개 직전에 읽는 것이 더 정확하다
   *  (그 사이 브랜치와 파일이 움직인다). 여기 있는 것은 그때 읽으면 **이미 늦은** 것뿐이다:
   *  - headCommit: 기다리는 동안 워크트리가 바뀌었는지 판정할 기준점. 비교 대상이 없으면 판정 자체가
   *    불가능하다(spec §13).
   *  - reason·resetsAt: 이 정지를 일으킨 `RollStateEvent` 가 들고 있던 값. **`workerState` 와
   *    `limitResetsAt` 이 이것을 대신하지 못한다** — 롤된 Dispatch 는 닫히지 않으므로
   *    (rollTap.ts 의 `rekeyDispatch`) `workerState` 는 'ready' 로 남고, `limitResetsAt` 은
   *    `closeDispatch` 와 실패 보고 probe 만 쓴다. 즉 롤 경로에서는 둘 다 비어 있고, 그 상태로
   *    조립한 브리핑은 "왜 여기 있는가" 를 말해야 하는 절에서 "아직 기록된 정지가 없다" 를 낸다.
   *    리셋 시각은 그 이벤트(`RollStateEvent.nextRetryAt`)에만 있어서, 여기 옮겨 두지 않으면
   *    그대로 사라진다.
   *
   *  transcript 끝 위치는 **한동안 여기 있었고 지웠다** — 조립기(checkpoint.ts)가 순수 모듈이라
   *  transcript 파일을 열 방법이 없어 그 값을 읽는 코드가 아예 없었다(SPEC §8, DESIGN §22). */
  stopSnapshot?: {
    headCommit: string | null
    /** 정지를 일으킨 롤 상태 그대로 — 'waiting'(같은 계정의 리셋을 기다린다) 또는
     *  'switching'(다른 계정으로 넘어간다). */
    reason: 'waiting' | 'switching'
    /** ISO. 'waiting' 일 때만 있다(`RollStateEvent.nextRetryAt`) — 계정을 바꾸는 쪽은 기다리지
     *  않으므로 리셋 시각이라는 값 자체가 없다. */
    resetsAt?: string
  }
  /** 이 Dispatch 가 멈추고 이어진 이력. 화면의 "기다리는 중" 과 "N 번 이어졌다" 가 이것을 읽는다
   *  (`core/orchestration/view.ts`). 항목이 없으면 이 칸 자체가 없다. */
  resumes?: ResumeEntry[]
  /** Cleanup held back at the user's request (worker-retain) */
  retained: boolean
  /** 이 Dispatch 가 구현이 아니라 검토인가. 한 Task 에 구현 Dispatch 와 검토 Dispatch 가 함께
   *  붙으므로, worker_done 이 도착했을 때 어느 쪽인지 아는 유일한 방법이다. */
  review?: boolean
  /** 이 Dispatch 가 구현이 아니라 수리인가, 그리고 왜. review 와 배타적이다. 직전 시도는 retryOf 가
   *  가리킨다 — attempt = Dispatch 라는 기존 모델 그대로다(설계 D4) */
  repair?: RepairReason
  /** 이 Dispatch 가 소진 Gate 의 retry-once(설계 §5.2)로, 사람이 예산 밖에 열어 준 것인가
   *  (`openDispatch` 의 `ignoreCircuit`). **연 시점에 한 번 적어 두는 사실**이다 — repairCountOf 로
   *  "지금 몇 번째인가" 를 나중에 되짚어 판정하지 않는다: 이 Dispatch 를 잃고 recovery 가 재시작하면
   *  잃은 것과 새로 연 것 둘 다 repairCountOf 에 잡혀 그 되짚기가 예산을 넘겼다고 잘못 말한다(전체
   *  브랜치 리뷰, Finding 3). 여기 적어 두면 recovery 가 재시작한 Dispatch 로 이 값을 그대로 옮겨
   *  적을 수 있어(`LostAttempt.grantedExtra`), "사람이 허락했다" 는 문구가 재시작을 거쳐도 참으로
   *  남는다. */
  grantedExtra?: true
  /** The answer to a `review-needs-decision` Gate this repair acts on (T3). Such a repair is outside the budget and
   *  `repairCountOf` does not count it: the rounds before it failed on something no code change fixed. */
  decision?: string
  // ── W1-A role models ──
  /** The model this attempt's session was started with (`--model` / `-m`), resolved by
   *  `resolveWorkerModel` / `resolveReviewerModel` (roleModels.ts). Absent: the CLI's own default. */
  model?: string
  /** Why the model or provider is not what the Task asked for (a provider with no account, a
   *  same-provider review moved off the implementer's model). Absent when nothing was overridden. */
  modelNote?: string
  /** The reasoning effort this attempt's session was started with. Absent: the CLI's own default. */
  effort?: string
  /** Why the effort is not what was asked (clamped to the model's levels, raised on retry, levels unknown). */
  effortNote?: string
  // W5-C holds (command.ts worker-hold)
  /** A person paused this worker (`worker-hold`). The session stays open and the Dispatch stays open, so its slot
   *  stays taken (`slotsToFill` counts every open Dispatch); nothing is typed into it from an agent session
   *  (`sessions-send` refuses). `worker-unhold` takes it away. */
  held?: true
}

export interface Message {
  id: string
  runId: string
  type: MessageType
  taskId?: string
  dispatchId?: string
  subject: string
  body: string
  outcome?: Outcome
  filesModified?: string[]
  options?: string[]
  answered: boolean
  answerBody?: string
  replyTo?: string
  createdAt: string
  deliveryId?: string
  ackedAt?: string
  /** T4: a `question` that asks the owner to run this owner-only command for its worker (state.ts `createApproval`).
   *  Stored verbatim when asked: approving replays exactly this, as the app. */
  approval?: { cmd: string; args: Record<string, unknown> }
}

/** The batch check returns. The same batch replays until --ack (section 5 of the orchestration guide) */
export interface Delivery {
  id: string
  runId: string
  messageIds: string[]
  createdAt: string
  ackedAt?: string
}

export interface Gate {
  id: string
  runId: string
  taskId: string
  question: string
  options?: string[]
  kind?: GateKind
  // W6-C
  reason?: GateReason
  status: 'open' | 'resolved'
  resolution?: string
  createdAt: string
  resolvedAt?: string
}

/** Maximum messages in one Delivery batch */
export const DELIVERY_MAX = 50
/** Consecutive failure ceiling. On reaching it, the Task is left in the failed terminal state */
export const FAILURE_LIMIT = 3

/** Default long-poll deadline for ask --wait. server.ts and the CLI (src/cli/run.ts) both take it
 *  from here — split into two copies, the client hangs up before the server does and the contract
 *  that a timeout is information rather than an error (section 4.7 of the orchestration guide)
 *  breaks. */
/**
 * `jobs wait` · `runs wait` 의 기본 마감.
 *
 * **다른 둘보다 훨씬 길다.** check 와 ask 는 코디네이터가 되풀이하는 루프의 한 바퀴이지만,
 * 이것은 "끝날 때까지" 를 뜻한다 — 가이드가 말하는 실제 코딩 작업은 15~60분이라 분 단위 기본값은
 * 쓸 때마다 타임아웃이 된다.
 *
 * Node 의 `server.requestTimeout`(기본 5분)은 **요청을 받는 시간**만 재고 응답을 붙잡아 두는
 * 시간은 재지 않는다(2초 requestTimeout 으로 5초 응답을 돌려 확인했고, 이미 10분을 기다리는
 * ask 가 그 증거다). 그래서 한 시간을 붙잡아도 끊기지 않는다.
 */
// The three deadlines are the SDK package's (packages/client/src/deadlines.ts): the Host waits by them, and the CLI
// and @astera-app/client wait past them. The renderer-safe door, since this file is in the renderer's program too.
export { DEFAULT_ASK_TIMEOUT_MS, DEFAULT_CHECK_TIMEOUT_MS, DEFAULT_WAIT_TIMEOUT_MS } from '../publicProtocol'

const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  pending: ['ready', 'dispatched', 'blocked'],
  ready: ['dispatched', 'blocked'],
  // A Task with a live worker is not gated: a Gate decides the task DAG the coordinator manages, and
  // halting a running worker is worker-stop's job, not a Gate's. `blocked` is nevertheless reachable
  // from `dispatched` because recovery needs it — when a worker is lost and the app cannot prove it is
  // safe to continue, the question goes to a person, and `blocked` plus a Gate is how this app asks.
  // The rule above still holds regardless: createGate refuses while a Dispatch is open, so the only
  // Tasks that can take this edge are ones whose worker is already gone.
  // dispatched -> validating: 워커가 성공을 보고했지만 그 Task 에 검증이 걸려 있는 경우.
  // 검증이 없으면 지금처럼 곧바로 completed 로 간다.
  // dispatched -> reviewing: 검증이 걸리지 않고 검토만 걸린 Task 의 성공 보고.
  dispatched: ['completed', 'failed', 'validating', 'reviewing', 'merging', 'blocked'],
  // validating -> blocked 는 검증을 아예 돌릴 수 없을 때다(구성이 없다, cwd 가 사라졌다). 그 판단은
  // 사람의 것이므로 Gate 를 연다. validating -> dispatched 는 검증이 도는 동안에는 없다 — 그 사이에는
  // 판정이 도착할 자리가 없기 때문이다. 그 금지는 판정이 도착하기 전까지다: 판정이 도착한 뒤에는 앱이
  // repair Dispatch 를 여는 전이로 이 칸에 들어오고, 그 유일한 문은 state.ts 의 openRepairDispatch 다
  // (설계 §5).
  // validating -> reviewing: 검증이 통과했고 검토가 걸려 있다. 순서는 검증 -> 검토다.
  validating: ['completed', 'failed', 'blocked', 'reviewing', 'merging', 'dispatched'],
  // reviewing -> blocked 는 검토를 아예 돌릴 수 없을 때다(쓸 수 있는 다른 provider 계정이 없다,
  // 검토자가 보고 없이 죽었다). 그 판단은 사람의 것이므로 Gate 를 연다. reviewing -> dispatched 는
  // 검토가 도는 동안에는 없다 — validating 과 같은 이유로 판정이 도착할 자리가 없다. 그 금지도 판정이
  // 도착하기 전까지다: 판정이 도착한 뒤에는 앱이 repair Dispatch 를 여는 전이로 이 칸에 들어오고, 그
  // 유일한 문은 state.ts 의 openRepairDispatch 다(설계 §5).
  reviewing: ['completed', 'failed', 'blocked', 'merging', 'dispatched'],
  // merging: the work succeeded and the app lands its worktree on the plan branch (state.ts doneStatusOf). A clean merge
  // or its merge Task completes it; a merge git cannot do blocks it on a Gate. Never completed without the merge.
  merging: ['completed', 'failed', 'blocked', 'ready'],
  completed: [],
  // failed -> blocked is allowed: failed is by definition a state with no open dispatch
  // (applyWorkerDone sets outcome and endedAt together) — so there is no reason to block the flow
  // of "put a Gate on a failed Task to ask a human whether to retry or give up".
  failed: ['dispatched', 'blocked'],
  blocked: ['ready', 'pending']
}

export const canTransition = (from: TaskStatus, to: TaskStatus): boolean =>
  ALLOWED[from].includes(to)

/** Promote pending Tasks whose deps are all completed to ready. blocked is left alone —
 *  that state is owned by a Gate and only gate-resolve can release it. */
export function recomputeReady(tasks: Task[]): Task[] {
  const done = new Set(tasks.filter((t) => t.status === 'completed').map((t) => t.id))
  return tasks.map((t) =>
    t.status === 'pending' && t.deps.every((d) => done.has(d)) ? { ...t, status: 'ready' } : t
  )
}

/** The 'tsk_1a2b3c4d5e6f7a8b' shape (16 hex). Why not the leading digits of crypto.randomUUID: this
 *  file is committed to importing no values, so node:crypto cannot be pulled in. Four Math.random
 *  calls make the 16 characters — an id is an identifier inside a single local process and
 *  unguessability is not required.
 *
 *  Widened from 8 hex (32 bits): at 10,000 messages the birthday problem puts the collision
 *  probability at ≈1.2%, and on a collision `s.messages.find(m => m.id === id)` returns a different
 *  message so a reply answers the wrong question — silently wrong. The prefixes (`msg_`, `dsp_`,
 *  `tsk_`, …) and the format are unchanged (only the length grew). */
export function newId(prefix: string): string {
  const quarter = (): string =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0')
  return `${prefix}_${quarter()}${quarter()}${quarter()}${quarter()}`
}

// ── W2-D GitHub links ──
/** Where a Task stands on GitHub (SPEC §7). Every field is a pointer: the issue, the branch its worker worked on, the
 *  commits it added (oldest first) and the pull requests that carry them. */
export interface TaskLinks {
  /** `closes`: the repository's workflow created this issue for this plan, so the plan's PR says "Closes #n". */
  issue?: { number: number; url: string; closes?: boolean }
  branch?: string
  prs?: { number: number; url: string; state: PrState }[]
  commits?: string[]
}

/** W6-H: a Run's push delivery: the branch and the commit pushed, or the reason it stopped. */
export interface RunDelivery {
  at: string
  branch?: string
  sha?: string
  error?: string
}

/** T3: where a delivery (or a plan-branch push) stands. `delivered-by-owner`: the owner said they push it, and git
 *  confirmed the commits reached the base. */
export type DeliveryStep = 'pending' | 'delivering' | 'delivered' | 'retrying' | 'failed' | 'needs-owner' | 'delivered-by-owner'
  // A `manual` plan finished: waiting for the owner to review it and create a PR or merge
  | 'awaiting-review'
  // T1: the owner dismissed a failed delivery (`run-delivery-dismiss`): no longer failed, never attempted again
  | 'dismissed'

/** T3: a delivery's attempts, persisted on the Run. `nextRetryAt` is when the driving loop tries again by itself;
 *  `questionId` the one owner question (an escalation message) raised after the last automatic attempt; `ownerPushes`
 *  the owner answered they push it themselves (checked until git confirms it). */
export interface DeliveryProgress {
  state: DeliveryStep
  attempts: number
  lastError?: string
  nextRetryAt?: string
  lastAttemptAt?: string
  questionId?: string
  ownerPushes?: true
  /** T2: the plan this delivery waits for before it validates (exec/deliveryWait.ts): one that outranks this plan, meets
   *  it and is landing now, so this one merges origin and validates once, after it. `escalated`: when the owner was told
   *  it waited 30 minutes. */
  waitingFor?: { jobId: string; since: string; escalated?: string }
  // ── T1: delivery state machine ──
  /** Why the last attempt stopped, as a code the app can act on (integrateGit.ts PushStop, e.g. `main-diverged`). */
  lastCode?: string
  /** A delivered state's remark: `closed on GitHub` for a pull request closed without merging. */
  note?: string
}

/** The plan's pull request: its URL and number once opened, or the error that stopped it. */
export interface RunPr {
  at: string
  url?: string
  number?: number
  error?: string
  /** W7-E: no PR was opened and that is no failure: the project has no remote. Says where the work is. */
  note?: string
  /** W7-E: with `note`, the branch that holds the plan's work. */
  branch?: string
  /** W8-C: opened as a draft after a wave while later waves remain; cleared when it is marked ready after the final
   *  check. **Present: the plan is not delivered yet.** */
  draft?: true
  // W8-C draft PR
  /** With `draft`: how many waves were done when the branch was last pushed and the body written (draftPr.ts). */
  wavesDone?: number
  // W8-A commit attribution
  /** The merge commit whose notes the squash remap wrote (`attribution-remap`): set, the remap is done. */
  attributed?: string
  /** T11: when the merge of `attributed` was seen, on `baseRefName`: the other plans of the project are refreshed onto it. */
  attributedAt?: string
  baseRefName?: string
  // T1: delivery state machine
  /** The pull request was merged or closed on GitHub: the plan's delivery ended there (`gh pr view --json state`). */
  landed?: 'merged' | 'closed'
  /** T6: when `runs-pr-sync` last asked GitHub about this PR and found it still open; repeated calls skip it for 2 minutes. */
  landedCheckedAt?: string
}
