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
// T9 a plan's leases end when it delivers
import { afterStandOf } from './after'

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

// W6-C: never two workers on the same files. T9: nor two plans, until the first has delivered.

/** File systems that ignore case (Windows, macOS): paths compare case-folded there. Read lazily: this file runs in the
 *  renderer too, where `process` may be absent. */
const foldsCase = (): boolean => {
  const platform = (globalThis as { process?: { platform?: string } }).process?.platform
  return platform === 'win32' || platform === 'darwin'
}

/** What an affected path names, relative to the repository: `/` separators, `.` and `..` resolved, a leading `./` or `/`
 *  and the project root (`root`, when the path is absolute inside it) dropped, cut at its first `*`. `''` is the whole
 *  repository (`.`, `*`, empty). `partial`: the glob cut a name in two (`src/foo*`), so it covers every name that
 *  starts with `path`, not only the directory. */
function scopeOf(p: string, root?: string): { path: string; partial: boolean } {
  const fold = foldsCase()
  let posix = p.trim().replace(/\\/g, '/')
  const star = posix.indexOf('*')
  const partial = star > 0 && posix[star - 1] !== '/'
  if (star !== -1) posix = posix.slice(0, star)
  if (fold) posix = posix.toLowerCase()
  const base = root?.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = base && fold ? base.toLowerCase() : base
  if (r && (posix === r || posix.startsWith(`${r}/`))) posix = posix.slice(r.length)
  const out: string[] = []
  for (const seg of posix.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else out.push(seg)
  }
  return { path: out.join('/'), partial: partial && out.length > 0 }
}

const covers = (x: { path: string; partial: boolean }, y: { path: string }): boolean =>
  x.path === '' || y.path === x.path || y.path.startsWith(`${x.path}/`) || (x.partial && y.path.startsWith(x.path))

/** Whether two affected paths can name the same file: equal, or one a directory prefix of the other (`src/a` and
 *  `src/a/b.ts`, not `src/ab`), after `scopeOf` (so `./src/a`, `/src/a`, `<root>/src/a` and `src/x/../a` are all
 *  `src/a`). A glob counts as the directory before its first `*`, so `*` alone is the whole repo; one that cuts a name
 *  (`src/foo*`) covers every path starting with that name (`src/foobar.ts`). Case-folded on Windows and macOS. */
export function pathsOverlap(a: string, b: string, root?: string): boolean {
  const x = scopeOf(a, root)
  const y = scopeOf(b, root)
  return covers(x, y) || covers(y, x)
}

/** T9: a Task that holds its files after its worker is done: completed in a plan that has not delivered yet. */
export interface Lease {
  /** The plan that holds it. */
  jobId: string
  /** Runs this lease does not hold back: its own plan's (a plan never waits for itself), and those of a plan that
   *  outranks it while waiting on it in a cycle (`leasesByProject`: the older plan proceeds). */
  exemptRuns: ReadonlySet<string>
}

/** An entry of the file guard: a Task at its files (`lease` absent) or holding them until its plan delivers. `root` is
 *  its project's folder, so a path written absolute compares with a relative one (`pathsOverlap`). */
export type FileHolder = Task & { lease?: Lease; root?: string }

/** The first of `others` whose affected paths overlap `task`'s, with the first of `task`'s paths it collides on. A
 *  Task with no affected paths overlaps nothing. A lease (`FileHolder.lease`) never holds back its exempt runs. */
export function sameFilesAs(
  task: Pick<Task, 'id' | 'affectedPaths'> & { runId?: string },
  others: readonly FileHolder[]
): { task: FileHolder; path: string } | undefined {
  for (const path of task.affectedPaths ?? [])
    for (const other of others) {
      if (other.id === task.id) continue
      if (other.lease && task.runId !== undefined && other.lease.exemptRuns.has(task.runId)) continue
      if ((other.affectedPaths ?? []).some((q) => pathsOverlap(path, q, other.root))) return { task: other, path }
    }
  return undefined
}

/** Statuses in which a Task's worker, checks, review or repair is at its files. */
const EDITING: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['dispatched', 'validating', 'reviewing'])

/** W8-D: the repository a Job works in, as the file guard keys it: its project, else (a Job made before projects) its
 *  folder. Two plans with the same key edit the same files; two with different keys never block each other.
 *  shortcut: an old Job without `projectId` matches by its exact `cwd` string only; such Jobs are no longer made. */
export const projectKeyOf = (job: Pick<Job, 'projectId' | 'cwd'>): string => job.projectId ?? `cwd:${job.cwd}`

/** T9: whether plan `a` goes before plan `b` when both want the same files: the higher `priority`, then the one created
 *  first, then the smaller id (so the order is total and every pass agrees). */
export function planOutranks(a: Pick<Job, 'id' | 'priority' | 'createdAt'>, b: Pick<Job, 'id' | 'priority' | 'createdAt'>): boolean {
  const pa = a.priority ?? 0
  const pb = b.priority ?? 0
  if (pa !== pb) return pa > pb
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt
  return a.id < b.id
}

/** Not started yet: its plan may still wait on another plan's lease for it. */
const NOT_STARTED: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['pending', 'ready'])

/** T9: the completed Tasks whose files stay leased, by project: those of each plan's latest Run while the plan has not
 *  delivered (`afterStandOf` 'waiting': no landed push, no opened PR, not stopped or archived). Their changes sit on an
 *  undelivered branch, so another plan editing the same files from an older base would conflict at delivery.
 *
 *  **Never a deadlock.** Plan X waits on plan Y when a not-started Task of X overlaps one of Y's leases. When Y also
 *  waits (directly or through others) on X and X outranks Y (`planOutranks`), Y's leases do not hold X back: the older
 *  plan proceeds and the younger waits. Every cycle has a highest-ranked plan, and its edge out of the cycle drops. */
export function leasesByProject(s: OrchState): Map<string, FileHolder[]> {
  const jobById = new Map(s.jobs.map((j) => [j.id, j]))
  const latest = new Map<string, JobRun>()
  for (const r of s.runs) {
    const had = latest.get(r.jobId)
    if (!had || r.ordinal > had.ordinal) latest.set(r.jobId, r)
  }
  const runById = new Map(s.runs.map((r) => [r.id, r]))
  const runsOf = new Map<string, string[]>()
  for (const r of s.runs) runsOf.set(r.jobId, [...(runsOf.get(r.jobId) ?? []), r.id])
  // The leases each plan holds, and each plan's Tasks still to start
  const held = new Map<string, Task[]>()
  const waiting = new Map<string, Task[]>()
  for (const t of s.tasks) {
    const run = t.runId === undefined ? undefined : runById.get(t.runId)
    if (!run || latest.get(run.jobId) !== run) continue
    if (t.status === 'completed' && (t.affectedPaths?.length ?? 0) > 0) held.set(run.jobId, [...(held.get(run.jobId) ?? []), t])
    else if (NOT_STARTED.has(t.status)) waiting.set(run.jobId, [...(waiting.get(run.jobId) ?? []), t])
  }
  for (const jobId of [...held.keys()]) if (afterStandOf(s, jobId) !== 'waiting') held.delete(jobId)
  if (held.size === 0) return new Map()
  // The wait graph between plans of one project: X -> Y when a Task of X still to start overlaps a lease of Y
  const edges = new Map<string, Set<string>>()
  for (const [x, tasks] of waiting) {
    const jx = jobById.get(x)
    if (!jx) continue
    for (const [y, leases] of held) {
      const jy = jobById.get(y)
      if (y === x || !jy || projectKeyOf(jx) !== projectKeyOf(jy)) continue
      if (tasks.some((t) => sameFilesAs(t, leases.map((l) => ({ ...l, root: jy.cwd }))))) edges.set(x, new Set([...(edges.get(x) ?? []), y]))
    }
  }
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>()
    const stack = [from]
    while (stack.length > 0) {
      const at = stack.pop()!
      if (at === to) return true
      if (seen.has(at)) continue
      seen.add(at)
      stack.push(...(edges.get(at) ?? []))
    }
    return false
  }
  const out = new Map<string, FileHolder[]>()
  for (const [y, leases] of held) {
    const jy = jobById.get(y)
    if (!jy) continue
    const exempt = new Set(runsOf.get(y) ?? [])
    for (const [x, to] of edges) {
      const jx = jobById.get(x)
      if (jx && to.has(y) && planOutranks(jx, jy) && reaches(y, x)) for (const id of runsOf.get(x) ?? []) exempt.add(id)
    }
    const key = projectKeyOf(jy)
    const lease: Lease = { jobId: y, exemptRuns: exempt }
    out.set(key, [...(out.get(key) ?? []), ...leases.map((t) => ({ ...t, lease, root: jy.cwd }))])
  }
  return out
}

/** What holds files right now, by project (`projectKeyOf`), whichever plan of it they belong to (W8-D): the Tasks at
 *  their files (an editing status or an open Dispatch), then (T9) the leases of plans not yet delivered
 *  (`leasesByProject`). The file guard of `slotsToFill`, the board and `worker-start` all read this one list. */
export function editingByProject(s: OrchState): Map<string, FileHolder[]> {
  const jobById = new Map(s.jobs.map((j) => [j.id, j]))
  const jobOfRun = new Map<string, Job>()
  for (const r of s.runs) {
    const job = jobById.get(r.jobId)
    if (job) jobOfRun.set(r.id, job)
  }
  const open = new Set(s.dispatches.filter(isOpen).map((d) => d.taskId))
  const out = new Map<string, FileHolder[]>()
  for (const t of s.tasks) {
    if (!EDITING.has(t.status) && !open.has(t.id)) continue
    const job = t.runId === undefined ? undefined : jobOfRun.get(t.runId)
    if (job === undefined) continue
    const key = projectKeyOf(job)
    out.set(key, [...(out.get(key) ?? []), { ...t, root: job.cwd }])
  }
  for (const [key, leases] of leasesByProject(s)) out.set(key, [...(out.get(key) ?? []), ...leases])
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
  // W6-C: what the workers are editing, by project (W8-D), grown as this pass hands out slots
  const editing = editingByProject(s)
  const queues = s.runs.flatMap((run, order) => {
    if (!appDriven(s, run)) return []
    const job = jobOf(s, run)
    const key = job ? projectKeyOf(job) : undefined
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
        // W6-C: not while another worker edits the same files; W8-D: of any plan of this project
        !sameFilesAs(t, (key !== undefined && editing.get(key)) || [])
    )
    if (candidates.length === 0) return []
    const lastServed = Math.max(-Infinity, ...mine.map((d) => Date.parse(d.startedAt) || -Infinity))
    return [{ run, order, key, root: job?.cwd, priority: job?.priority ?? 0, room, openHere, lastServed, candidates }]
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
    // W8-D: for every plan of its project
    const key = best.key
    if (key !== undefined) {
      editing.set(key, [...(editing.get(key) ?? []), { ...t, root: best.root }])
      for (const q of queues) if (q.key === key) q.candidates = q.candidates.filter((c) => !sameFilesAs(c, [t]))
    }
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
