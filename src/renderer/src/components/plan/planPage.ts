// The plan page's pure parts (moved out of pages/PlanPage.tsx): the event labels, the head counts, the manual-start
// rule and the wave line. Pure, so the node-only test suite reaches them.
import type { MessageKey } from '../../../../core/i18n'
import type { JobEvent, JobRow, JobTask, MessageType, TaskStatus } from '../../../../core/types'
import { DEFAULT_CONCURRENCY } from '../../../../core/orchestration/types'
import { approveSlot } from './planTalkModel'
import { currentWaveOf, type PlanSection, type PlanWave } from './planBoard'

/** 종류 배지의 문구. message 는 messageType 이 정한다.
 *  heartbeat 과 decision_gate 는 timeline.ts 의 SKIP 이 걸러 지금은 도달하지 않지만, 맵을
 *  온전하게 두면 그 규칙이 바뀌어도 문구가 없는 배지가 나오지 않는다. */
export const MSG_LABEL: Record<MessageType, MessageKey> = {
  status: 'jobs.event.status',
  worker_done: 'jobs.event.workerDone',
  question: 'jobs.event.question',
  escalation: 'jobs.event.escalation',
  heartbeat: 'jobs.event.heartbeat',
  decision_gate: 'jobs.event.decisionGate'
}

export const KIND_LABEL: Record<Exclude<JobEvent['kind'], 'message'>, MessageKey> = {
  'run-created': 'jobs.event.runCreated',
  'task-created': 'jobs.event.taskCreated',
  'dispatch-started': 'jobs.event.dispatchStarted',
  'gate-opened': 'jobs.event.gateOpened',
  'gate-resolved': 'jobs.event.gateResolved',
  'limit-hit': 'jobs.event.limitHit',
  resumed: 'jobs.event.resumed',
  'runtime-lost': 'jobs.event.runtimeLost',
  recovery: 'jobs.event.recovery'
}

/** A recovery line's summary is the strategy as the journal stored it (core/continuity/timelineRows.ts
 *  carries the row through verbatim) — the journal is the source of truth, so the data stays raw and
 *  the wording happens here. A strategy this map does not know falls back to the raw string: a new
 *  strategy showing as `resume-native` reads better than showing as nothing. */
export const RECOVERY_LABEL: Record<string, MessageKey> = {
  'resume-native': 'jobs.recovery.resumeNative',
  redispatch: 'jobs.recovery.redispatch',
  recheck: 'jobs.recovery.recheck',
  'smart-resume': 'jobs.recovery.smartResume',
  review: 'jobs.recovery.review'
}

/** 사람을 부르는 메시지. 이 셋만 이벤트 표식으로 blocked 글리프(사람을 기다린다)를 빌린다 —
 *  나머지는 기록 한 줄일 뿐이다. */
export const CALLS_FOR_A_PERSON: ReadonlySet<MessageType> = new Set<MessageType>([
  'question',
  'escalation',
  'decision_gate'
])

/** 헤더에서 따로 세는 다섯. 순서는 눈이 가야 하는 차례다 — 사람을 기다리는 것이 먼저다 */
export const HEAD_STATES: readonly TaskStatus[] = ['blocked', 'completed', 'failed', 'ready', 'pending']

/** Which delivery actions the plan header offers (T2). Retry: any delivery that has started. It's already pushed: the
 *  owner settles a failed or owner-held one (`run-deliver --ownerPushed`). Dismiss: a failed one only (`run-delivery-dismiss`). */
export function deliveryActionsOf(row: Pick<JobRow, 'delivery'>): { retry: boolean; alreadyPushed: boolean; dismiss: boolean } {
  const state = row.delivery?.state
  const held = state === 'failed' || state === 'needs-owner'
  return { retry: state !== undefined && state !== 'pending', alreadyPushed: held, dismiss: state === 'failed' }
}

/** The header's per-status counts, in HEAD_STATES order, zero counts left out. */
export const headCountsOf = (tasks: readonly JobTask[]): (readonly [TaskStatus, number])[] =>
  HEAD_STATES.map((status) => [status, tasks.filter((tk) => tk.status === status).length] as const).filter(([, n]) => n > 0)

/** busy 가 담는 값은 노드 동작의 대상 Task id 인데, 실행 버튼에는 대상 Task 가 없다. Task id 와
 *  겹칠 수 없는 값을 하나 둔다 — id 는 `tsk_` 로 시작하므로(core/orchestration/types.ts 의 newId)
 *  이 문자열과 같아질 수 없다. UI_CALLER 가 세션 id 와 겹치지 않게 하는 것과 같은 방식이다. */
export const RUN_START = 'run:start'

/** 병합 버튼의 busy 센티넬. RUN_START 와 같은 이유로 Task id 와 겹칠 수 없는 값이다 */
export const RUN_MERGE = 'run:merge'

/** 시각의 표시 형태 — 날짜는 버리고 시:분:초만 남긴다. 한 Run 이 여러 날에 걸치는 경우가 드물고,
 *  좁은 칸에서 날짜는 전부 같은 값이라 자리만 먹는다.
 *
 *  **문자열을 자르지 않는다.** `JobEvent.at` 은 ISO-Z(UTC)이므로 `at.slice(11, 19)` 는 UTC 를
 *  그린다 — KST 사용자에게는 아홉 시간 이른 시각이고, 워커가 방금 한 일이 오늘 아침에 일어난 것처럼
 *  보인다. Date 로 파싱해 지역 시각으로 옮기는 것이 이 값의 유일한 올바른 표시다. 정렬은 core 의
 *  ISO 문자열이 하므로(timeline.ts) 표시를 바꾸는 것이 순서에 영향을 주지 않는다.
 *
 *  형식은 Intl 이 아니라 손으로 맞춘다 — 로케일마다 12시간제와 구분자가 달라지면 한 화면에서 눈으로
 *  순서를 따라가기 어렵고, 이 칸은 tabular-nums 로 자리를 맞춰 둔 고정폭 칸이다. */
export const timeOf = (at: string): string => {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

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
export const canManualStartOf = (run: JobRow | undefined): boolean =>
  (run?.concurrency ?? DEFAULT_CONCURRENCY) <= 1 &&
  run !== undefined &&
  run.schedule === undefined &&
  run.pendingStart !== true

/** What opens the next wave, for the one line under "Wave n of m". */
export type WaveNext =
  | { kind: 'replan'; n: number }
  | { kind: 'opens'; n: number; left: number }
  | { kind: 'last'; left: number }
  | { kind: 'done' }

export interface WaveStatus {
  /** 1-based wave being worked on, and the wave count. */
  at: number
  of: number
  /** null when the Tasks of the current wave are not known yet (the detail's layers have not arrived). */
  next: WaveNext | null
}

/** "Wave n of m" and what opens the next one. The row's `wave` (core's count) wins over the one counted here from the
 *  detail's layers; the Tasks still open in the current wave come from `waves`. A replan under way (`replanWave`,
 *  0-based) is said instead of the count. null: the plan has no Tasks yet. */
export function waveStatusOf(row: Pick<JobRow, 'wave' | 'replanWave'> | undefined, waves: readonly PlanWave[]): WaveStatus | null {
  const of = row?.wave?.of ?? waves.length
  if (of === 0) return null
  const cur = currentWaveOf(waves)
  const at = row?.wave?.at ?? (cur === -1 ? waves.length : cur + 1)
  if (row?.replanWave !== undefined) return { at, of, next: { kind: 'replan', n: row.replanWave + 1 } }
  const wave = waves[at - 1]
  if (wave === undefined) return { at, of, next: null }
  const left = wave.tasks.length - wave.done
  if (at < of) return { at, of, next: left > 0 ? { kind: 'opens', n: at + 1, left } : null }
  return { at, of, next: left === 0 ? { kind: 'done' } : { kind: 'last', left } }
}

/** T8: where the plan tab scrolls on opening: a Task (expanded), the Plan settings, the Steps or the Activity; null
 *  for the top. `openPlan(jobId, section)` carries it (planBoard planSectionOf keeps `settings` and `task-<id>`). */
export type PlanAnchor = { kind: 'task'; taskId: string } | { kind: 'settings' } | { kind: 'steps' } | { kind: 'activity' }

export function planAnchorOf(section: PlanSection | undefined): PlanAnchor | null {
  if (section === undefined || section === 'overview') return null
  if (section === 'settings') return { kind: 'settings' }
  if (section === 'waves') return { kind: 'steps' }
  if (section === 'files' || section === 'changes' || section === 'journal') return { kind: 'activity' }
  return { kind: 'task', taskId: section.slice('task-'.length) }
}

/** The plan page's open: its section and `seq`, which counts the opens. Opening the section it already shows is still
 *  a new open, so the anchor scroll keys on `seq`, not on the section alone (PlanPage.tsx). */
export type PlanOpen = { section?: PlanSection; seq: number }

export const nextPlanOpen = (prev: PlanOpen, section?: PlanSection): PlanOpen => ({ section, seq: prev.seq + 1 })

/** The element id an anchor scrolls to; each section and Task row of the plan tab carries its own. */
export const planAnchorId = (a: PlanAnchor): string => (a.kind === 'task' ? taskAnchorId(a.taskId) : `plan-${a.kind}`)
export const taskAnchorId = (taskId: string): string => `plan-task-${taskId}`

/** What the plan header shows where Approve & execute stands. The button shows for every plan that waits for approval
 *  and has Tasks. It is enabled once the plan is ready (approveSlot); before that, or while `planProblems` hold it, it is
 *  disabled and "Not ready to approve" stands beside it with the problems. */
export interface ApproveView {
  show: boolean
  /** Approve can be pressed now. */
  ready: boolean
  /** Why it cannot (JobRow.planProblems), shown next to the button without opening the talk. */
  problems: readonly string[]
}

export function approveViewOf(row: Pick<JobRow, 'pendingStart' | 'planned' | 'planReady' | 'autoApprove' | 'handsOff' | 'planProblems' | 'archivedAt' | 'tasks'>): ApproveView {
  const problems = row.planProblems ?? []
  const show = row.pendingStart === true && row.archivedAt === undefined && row.tasks.length > 0
  return { show, ready: show && approveSlot(row) === 'approve' && problems.length === 0, problems: show ? problems : [] }
}
