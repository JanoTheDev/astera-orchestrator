import {
  DEFAULT_CONCURRENCY,
  FAILURE_LIMIT,
  MAX_CONCURRENT_WORKERS,
  type Dispatch,
  type Job,
  type JobRun,
  type Task,
  type TaskStatus
} from './types'
import { jobOf, placedByApp, type OrchState } from './state'
import { isJobActive } from './lifecycle'
import { waveOpen } from './replan'

/** 지금 워커를 띄워야 할 자리 하나.
 *
 *  **provider 칸이 없다.** 예전에는 Run 이 provider 를 들고 있어서 이 자리에 실어 보낼 수 있었다.
 *  이제 provider 는 Task 의 계정에서 나오는데, 계정 id 를 provider 로 옮기려면 계정 목록을 봐야
 *  하고 그것은 core 가 아니라 앱이 아는 것이다(이 파일이 지키는 경계). 그래서 계정만 싣고, 배선이
 *  `accountIds[0]` 에서 provider 를 알아낸다. */
export interface Slot {
  runId: string
  taskId: string
  /** 사람이 이 Task 에 지정해 둔 계정들, 순서대로(Task.accountIds). **여기서 판정하지 않고 그대로
   *  실어 보낸다** — 쓸 수 있는지는 계정 목록과 로그인 여부를 봐야 알고, 그 둘은 앱이 아는
   *  것이다(위 주석). 배선이 accountToDispatchOn 에 넘긴다.
   *
   *  **비어 있지 않다.** slotsToFill 이 계정 없는 Task 를 아예 고르지 않으므로(그런 Task 는 어느
   *  CLI 로 띄울지 알 수 없다), 이 칸은 언제나 있고 언제나 하나 이상이다. */
  accountIds: string[]
}

/**
 * 앱이 스스로 돌리는 회차인가.
 *
 * **아래 두 함수가 이 하나를 쓴다.** 예전에는 같은 네 줄이 두 곳에 복사되어 있었고 그 옆에
 * "하나라도 어긋나면 앱이 돌리지 않는 Run 의 Task 에 Gate 가 열린다" 는 경고가 적혀 있었다 —
 * 어긋날 수 없게 하는 편이 경고보다 낫다.
 *
 * `placedByApp` 은 "누가 이 회차를 운전하는가" 다: 계획의 `autoDispatch`, 또는 코디네이터 계정이
 * 없는 예약 Job 의 회차에 발화가 찍은 회차의 `autoDispatch`(U1, JobRun.autoDispatch). 나머지는
 * `pendingStart` 가 "아직 시작하지 않았다", `Job.paused` 가 "예약을 세워 뒀다", `run.paused` 가
 * "세울 때 함께 멈춘 회차" 다.
 */
export function appDriven(s: OrchState, run: JobRun): boolean {
  const job = jobOf(s, run)
  if (!job || !placedByApp(job, run)) return false
  if (!jobActive(job)) return false
  // **세워 둔 회차도 배치하지 않는다.** 일시 중지가 도는 워커를 닫아도, 그 자리에 그 회차의 다음
  // ready Task 가 곧바로 뜨면 "일시 중지" 가 "지금 도는 Task 하나만 멈춤" 이 된다.
  if (run.paused) return false
  // W5-C: "stop launching" holds placement only. Not in `jobActive`: the held plan's open workers still run, so they
  // still count against the app-wide cap (`workersAgainstCap`).
  if (job.dispatchHold) return false
  return true
}

// W1-B: global concurrency across plans.

/** Whether a Job may take new work: not waiting for its first start, not paused, not archived
 *  (`isJobActive`, W1-C's one archive rule). */
export function jobActive(job: Job): boolean {
  return !job.pendingStart && !job.paused && isJobActive(job)
}

const isOpen = (d: Dispatch): boolean => !d.outcome && !d.endedAt

/** Workers that count against the app-wide cap (`maxConcurrentWorkers`): every open Dispatch — a
 *  review and a repair are processes too — whose Run is live: its Job active (`jobActive`) and the Run
 *  itself not paused. Who placed it does not matter: a coordinator's workers share the machine with
 *  the app's. */
export function workersAgainstCap(s: OrchState): number {
  const live = new Set(
    s.runs
      .filter((r) => {
        const job = jobOf(s, r)
        return job !== undefined && jobActive(job) && !r.paused
      })
      .map((r) => r.id)
  )
  const runOf = new Map(s.tasks.map((t) => [t.id, t.runId]))
  return s.dispatches.filter((d) => {
    if (!isOpen(d)) return false
    const runId = runOf.get(d.taskId)
    return runId !== undefined && live.has(runId)
  }).length
}

/** What `slotsToFill` takes besides the state: the app-wide cap from app settings. `null` or absent is
 *  MAX_CONCURRENT_WORKERS (`workerCapOf`). */
export interface ScheduleLimits {
  maxConcurrentWorkers?: number | null
}

// W6-C: the app-wide cap never passes MAX_CONCURRENT_WORKERS. Read here, not only when the setting is parsed, because
// every caller that cannot read the settings file answers null.
export const workerCapOf = (cap: number | null | undefined): number =>
  cap === null || cap === undefined ? MAX_CONCURRENT_WORKERS : Math.min(cap, MAX_CONCURRENT_WORKERS)

// W6-C: never two workers on the same files.

/** The directory prefix a path names: the part before its first `*`, with `./` and trailing slashes dropped. */
const prefixOf = (p: string): string => {
  const posix = p.replace(/\\/g, '/')
  const star = posix.indexOf('*')
  return (star === -1 ? posix : posix.slice(0, star)).replace(/^(\.\/)+/, '').replace(/\/+$/, '')
}

/** Whether two affected paths can name the same file: equal, or one a directory prefix of the other (`src/a` and
 *  `src/a/b.ts`, not `src/ab`). A glob counts as the directory before its first `*`, so `*` alone is the whole repo. */
export function pathsOverlap(a: string, b: string): boolean {
  const x = prefixOf(a)
  const y = prefixOf(b)
  return x === '' || y === '' || x === y || y.startsWith(`${x}/`) || x.startsWith(`${y}/`)
}

/** The first of `others` whose affected paths overlap `task`'s, with the first of `task`'s paths it collides on. A
 *  Task with no affected paths overlaps nothing. */
export function sameFilesAs(
  task: Pick<Task, 'id' | 'affectedPaths'>,
  others: readonly Task[]
): { task: Task; path: string } | undefined {
  for (const path of task.affectedPaths ?? [])
    for (const other of others)
      if (other.id !== task.id && (other.affectedPaths ?? []).some((q) => pathsOverlap(path, q))) return { task: other, path }
  return undefined
}

/** Statuses in which a Task's worker, checks, review or repair is at its files. */
const EDITING: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['dispatched', 'validating', 'reviewing'])

/** The Tasks at their files right now, by Job id: an editing status or an open Dispatch. */
export function editingByJob(s: OrchState): Map<string, Task[]> {
  const jobOfRun = new Map(s.runs.map((r) => [r.id, r.jobId]))
  const open = new Set(s.dispatches.filter(isOpen).map((d) => d.taskId))
  const out = new Map<string, Task[]>()
  for (const t of s.tasks) {
    if (!EDITING.has(t.status) && !open.has(t.id)) continue
    const jobId = t.runId === undefined ? undefined : jobOfRun.get(t.runId)
    if (jobId === undefined) continue
    const list = out.get(jobId)
    if (list) list.push(t)
    else out.set(jobId, [t])
  }
  return out
}

/** 지금 띄워야 할 것들. **부수 효과가 없고 같은 입력에 같은 답을 준다** — 이 판정이 순수해야
 *  하는 이유는 이것이 이 슬라이스에서 기계가 검사할 수 있는 유일한 부분이기 때문이다(스케줄러를
 *  매다는 자리는 main 의 배선이라 테스트가 없다).
 *
 *  **앱이 운전하는 회차만 본다**(appDriven). 코디네이터가 만든 Job 을 앱이 함께 돌리면 둘이 같은
 *  ready Task 를 두고 경합한다(Job.autoDispatch 의 주석 참고).
 *
 *  **계정이 없는 Task 는 건너뛴다.** 계정이 provider 의 유일한 출처이므로(Task.accountIds), 계정이
 *  없으면 어느 CLI 로 띄울지 알 수 없다. 만드는 두 자리가 모두 계정을 요구하지만 입력은 명령이
 *  아니라 파일이다 — orchestration.json 은 프로세스보다 오래 살고, 이 규칙 전에 만들어진 Task 와
 *  손으로 고친 파일에는 그 칸이 없다. graph.ts 가 순환을 다루는 것과 같은 이유다.
 *
 *  건너뛴 Task 가 조용히 멈추지는 않는다 — 아래 tasksMissingAccounts 가 그것들을 따로 내고,
 *  배선이 그 목록에 Gate 를 연다(accountToDispatchOn 이 거절할 때와 같은 자리).
 *
 *  **W1-B: one queue per Run, one shared cap.** Each Run keeps its own `concurrency`; on top of that
 *  `limits.maxConcurrentWorkers` caps every live worker in the app (`workersAgainstCap`, so the
 *  coordinators' workers and open reviews take room too). Slots are handed out one at a time: the
 *  highest `Job.priority` first, and among equals the Run with the fewest open workers, then the one
 *  served longest ago (its newest Dispatch) — so with a cap of one, two plans of equal priority take
 *  turns instead of the first in the array winning every freed slot. That order is read off the state
 *  alone, which keeps this function pure. */
export function slotsToFill(s: OrchState, limits: ScheduleLimits = {}): Slot[] {
  const open = s.dispatches.filter(isOpen)
  const runOf = new Map(s.tasks.map((t) => [t.id, t.runId]))
  let globalRoom = workerCapOf(limits.maxConcurrentWorkers) - workersAgainstCap(s)
  // W6-C: what each Job's workers are editing, grown as this pass hands out slots
  const editing = editingByJob(s)
  const queues = s.runs.flatMap((run, order) => {
    if (!appDriven(s, run)) return []
    const job = jobOf(s, run)
    const mine = s.dispatches.filter((d) => runOf.get(d.taskId) === run.id)
    const openHere = mine.filter(isOpen).length
    const room = (job?.concurrency ?? DEFAULT_CONCURRENCY) - openHere
    if (room <= 0) return []
    const candidates = s.tasks.filter(
      (t) =>
        t.runId === run.id &&
        t.status === 'ready' &&
        // worker-start 가 어차피 회로 차단으로 거절한다. 여기서 걸러야 같은 실패가 매 저장마다
        // 로그를 채우지 않는다 — 그 로그는 진짜 문제를 덮는다
        t.consecutiveFailures < FAILURE_LIMIT &&
        // 계정이 없으면 provider 를 알 수 없다(이 함수 머리말) — 고르지 않는다
        (t.accountIds?.length ?? 0) > 0 &&
        // ready 인데 열린 Dispatch 가 있는 조합은 만들어질 수 없지만, 판정이 그 사실에 기대지
        // 않는다. 기대면 그 불변식이 깨지는 날 두 워커가 같은 Task 를 잡는다
        !open.some((d) => d.taskId === t.id) &&
        // W6-D: a later wave waits for the earlier ones and for a replan under way
        waveOpen(t, s) &&
        // W6-C: not while another worker of this Job edits the same files
        !sameFilesAs(t, editing.get(run.jobId) ?? [])
    )
    if (candidates.length === 0) return []
    const lastServed = Math.max(-Infinity, ...mine.map((d) => Date.parse(d.startedAt) || -Infinity))
    return [{ run, order, priority: job?.priority ?? 0, room, openHere, lastServed, candidates }]
  })
  const slots: Slot[] = []
  while (globalRoom > 0) {
    let best: (typeof queues)[number] | undefined
    for (const q of queues) {
      if (q.room <= 0 || q.candidates.length === 0) continue
      if (
        !best ||
        q.priority > best.priority ||
        (q.priority === best.priority &&
          (q.openHere < best.openHere ||
            (q.openHere === best.openHere &&
              (q.lastServed < best.lastServed || (q.lastServed === best.lastServed && q.order < best.order)))))
      )
        best = q
    }
    if (!best) break
    const t = best.candidates.shift()!
    // accountIds 는 위 필터가 비어 있지 않음을 보장한다(Slot.accountIds 의 주석)
    slots.push({ runId: best.run.id, taskId: t.id, accountIds: t.accountIds as string[] })
    best.room--
    best.openHere++
    best.lastServed = Infinity
    globalRoom--
    // W6-C: the Task just placed now holds its files, so another ready Task on them waits for the next pass
    const jobId = best.run.jobId
    editing.set(jobId, [...(editing.get(jobId) ?? []), t])
    for (const q of queues) if (q.run.jobId === jobId) q.candidates = q.candidates.filter((c) => !sameFilesAs(c, [t]))
  }
  return slots
}

/** 계정이 없어서 **띄울 수 없는** ready Task 들. slotsToFill 이 건너뛴 것들 중, 사람이 그 사실을
 *  알아야 하는 것만 낸다.
 *
 *  **왜 따로 내는가.** slotsToFill 은 "지금 띄울 자리"를 내고, 계정 없는 Task 는 그 자리가 아니다.
 *  그런데 그것을 그냥 빼고 끝내면 Run 이 이유 없이 서 있는다 — 이 하위 시스템이 없애려는 증상
 *  그대로다(core/orchestration/exec/dispatchLoop.ts 의 gateSlot 주석). 그래서 같은 Run 필터를 지나되 답이 다른 두 함수로 가른다.
 *
 *  **한 번만 열린다.** Gate 가 열리면 Task 는 blocked 로 가고(state.ts 의 createGate) 이 판정은
 *  ready 만 보므로 다음 바퀴에는 나오지 않는다. 사람이 계정을 넣고 Gate 를 풀면 다시 ready 가 되고
 *  그때는 slotsToFill 이 집어 간다.
 *
 *  회로 차단(FAILURE_LIMIT)에 걸린 Task 는 내지 않는다 — slotsToFill 이 같은 이유로 걸러내고, 그
 *  Task 에 대해 사람이 할 일은 계정 지정이 아니다. */
export function tasksMissingAccounts(s: OrchState): { runId: string; taskId: string }[] {
  const out: { runId: string; taskId: string }[] = []
  const open = s.dispatches.filter((d) => !d.outcome && !d.endedAt)
  for (const run of s.runs) {
    // slotsToFill 과 **같은** 판정을 쓴다(appDriven). 어긋나면 앱이 돌리지 않는 회차의 Task 에
    // Gate 가 열린다 — 코디네이터가 계정 없이 만든 Task 는 그가 worker-start 로 직접 띄운다.
    if (!appDriven(s, run)) continue
    for (const t of s.tasks) {
      if (t.runId !== run.id) continue
      if (t.status !== 'ready') continue
      if (t.consecutiveFailures >= FAILURE_LIMIT) continue
      if ((t.accountIds?.length ?? 0) > 0) continue
      if (open.some((d) => d.taskId === t.id)) continue
      out.push({ runId: run.id, taskId: t.id })
    }
  }
  return out
}
