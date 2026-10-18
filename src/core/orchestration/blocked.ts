// Why a Task is not running (orchestrator SPEC §9 "blocked or waiting tasks, each with a reason", W2-C).
//
// **Read off the state, never stored, and never a second copy of a rule.** Each reason asks the helper that already
// owns it: `jobActive` / `isJobActive` (a plan paused, not started, archived), `placedByApp` (who drives the Run),
// `slotsToFill` and `workersAgainstCap` (the plan's own and the app-wide caps, `Job.priority`), FAILURE_LIMIT (the
// circuit breaker). If one of those rules changes, the reason changes with it.
import type { TaskBlockedReason, TaskBoard, TaskCategory } from '../types'
import { DEFAULT_CONCURRENCY, FAILURE_LIMIT, type Dispatch, type Gate, type Task } from './types'
import { placedByApp, type OrchState } from './state'
import { isJobActive } from './lifecycle'
import { jobActive, slotsToFill, workersAgainstCap, type ScheduleLimits } from './schedule'

const isOpen = (d: Dispatch): boolean => !d.outcome && !d.endedAt

/** The bucket a Task counts in. `dispatched` with no open Dispatch is `cancelled` only when a person closed it
 *  (`worker-stop`, `worker-abandon`, `runs stop`): one closed by a schedule's pause, or lost with the app, is waiting
 *  to go again (recovery, `runs resume`), so it is queued. */
function categoryOf(task: Task, open: Dispatch | undefined, latest: Dispatch | undefined): TaskCategory {
  switch (task.status) {
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'reviewing':
      return 'awaiting-review'
    case 'validating':
      return 'running'
    case 'dispatched':
      if (open) return 'running'
      return latest?.closedBy === 'stop' || latest?.closedBy === 'abandon' ? 'cancelled' : 'queued'
    default:
      return 'queued'
  }
}

/** Every Task's board entry, by Task id. It runs in the snapshot fold after every commit, so it reads each list a fixed
 *  number of times (view.ts, performance audit M1): `slotsToFill` and `workersAgainstCap` run at most once, and only
 *  when a ready Task the app places needs their answer.
 *  shortcut: those two scan per Run; if a state with many ready app-placed Tasks makes the fold slow, index them. */
export function taskBoardsOf(s: OrchState, limits: ScheduleLimits = {}): Map<string, TaskBoard> {
  const cap = limits.maxConcurrentWorkers ?? null
  const push = <T>(m: Map<string, T[]>, k: string, v: T): void => {
    const list = m.get(k)
    if (list) list.push(v)
    else m.set(k, [v])
  }
  const byTask = new Map<string, Dispatch[]>()
  for (const d of s.dispatches) push(byTask, d.taskId, d)
  const gates = new Map<string, Gate[]>()
  for (const g of s.gates) if (g.status === 'open') push(gates, g.taskId, g)
  const taskById = new Map(s.tasks.map((t) => [t.id, t]))
  const runById = new Map(s.runs.map((r) => [r.id, r]))
  const jobById = new Map(s.jobs.map((j) => [j.id, j]))
  let placement: { count: number; slotted: Set<string>; byRun: Map<string, number>; used: number } | undefined
  const placed = (): NonNullable<typeof placement> => {
    if (placement) return placement
    const slots = slotsToFill(s, limits)
    const byRun = new Map<string, number>()
    for (const x of slots) byRun.set(x.runId, (byRun.get(x.runId) ?? 0) + 1)
    const used = cap === null ? 0 : workersAgainstCap(s)
    placement = { count: slots.length, slotted: new Set(slots.map((x) => x.taskId)), byRun, used }
    return placement
  }
  const openByRun = new Map<string, number>()
  for (const d of s.dispatches)
    if (isOpen(d)) {
      const runId = taskById.get(d.taskId)?.runId
      if (runId !== undefined) openByRun.set(runId, (openByRun.get(runId) ?? 0) + 1)
    }

  const reasonOf = (task: Task, open: Dispatch | undefined): TaskBlockedReason | undefined => {
    if (task.status === 'completed') return undefined
    if (open) {
      // A rolled Dispatch stays open while it waits (Dispatch.stopSnapshot): its last history entry not yet resumed
      const entry = open.resumes?.at(-1)
      if (entry && entry.resumedAt === undefined)
        return {
          kind: 'rate-limited',
          accountId: entry.fromAccountId,
          switching: entry.reason === 'switching',
          ...(entry.resetsAt !== undefined ? { resetsAt: entry.resetsAt } : {})
        }
      return undefined
    }
    // The app runs the checks itself, with no session (running.ts runningCount)
    if (task.status === 'validating') return undefined
    const run = task.runId === undefined ? undefined : runById.get(task.runId)
    const job = run ? jobById.get(run.jobId) : task.jobId === undefined ? undefined : jobById.get(task.jobId)
    if (!job) return undefined
    if (!jobActive(job)) {
      if (!isJobActive(job)) return { kind: 'archived' }
      if (job.pendingStart) return { kind: 'pending-start' }
      return { kind: 'paused' }
    }
    if (!run) return { kind: 'definition' }
    if (run.paused) return { kind: 'paused' }
    // W5-C: held from launching (Job.dispatchHold): nothing new is placed, so the board says paused, not "next"
    if (job.dispatchHold) return { kind: 'paused' }
    const gate = [...(gates.get(task.id) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (gate)
      return { kind: 'gate', gateId: gate.id, question: gate.question, ...(gate.kind ? { gateKind: gate.kind } : {}) }
    if (task.consecutiveFailures >= FAILURE_LIMIT)
      return { kind: 'failure-limit', failures: task.consecutiveFailures, limit: FAILURE_LIMIT }
    if (task.status === 'failed')
      return {
        kind: 'failed-retry',
        failures: task.consecutiveFailures,
        limit: FAILURE_LIMIT,
        ...(run.coordinatorSessionId === undefined ? { noCoordinator: true as const } : {})
      }
    if (task.status === 'reviewing') return { kind: 'awaiting-review' }
    if (task.status === 'dispatched') return { kind: 'stopped' }
    if (task.status === 'pending') {
      const waitingOn = task.deps
        .map((id) => taskById.get(id))
        .filter((d): d is Task => d !== undefined && d.status !== 'completed')
        .map((d) => ({ id: d.id, title: d.title, status: d.status }))
      // Every dep done and not yet promoted: the next write's recomputeReady makes it ready
      return waitingOn.length > 0 ? { kind: 'deps', waitingOn } : { kind: 'next' }
    }
    if (task.status !== 'ready') return undefined
    if ((task.accountIds?.length ?? 0) === 0) return { kind: 'no-account' }
    if (!placedByApp(job, run)) return { kind: 'coordinator' }
    const p = placed()
    if (p.slotted.has(task.id)) return { kind: 'next' }
    const openHere = openByRun.get(run.id) ?? 0
    const limit = job.concurrency ?? DEFAULT_CONCURRENCY
    if (openHere + (p.byRun.get(run.id) ?? 0) >= limit) return { kind: 'plan-cap', used: openHere, limit }
    if (cap !== null && p.used + p.count >= cap)
      return { kind: 'global-cap', used: p.used, limit: cap, priority: job.priority ?? 0 }
    return { kind: 'next' }
  }

  const out = new Map<string, TaskBoard>()
  for (const task of s.tasks) {
    const mine = byTask.get(task.id) ?? []
    const open = mine.find(isOpen)
    const latest = [...mine].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)
    const reason = reasonOf(task, open)
    out.set(task.id, { category: categoryOf(task, open, latest), ...(reason ? { reason } : {}) })
  }
  return out
}
