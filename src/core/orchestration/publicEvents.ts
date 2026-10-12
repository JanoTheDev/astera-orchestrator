// The public events one commit makes (SDK spec §6, SDK 1d), derived from the state before it and the state after it.
// Pure: no clock, no files; the Host's event log (src/host/eventLog.ts) stamps, numbers and keeps them.
//
// **Only what changed is looked at.** The state is replaced on every commit and never mutated (stateMemo.ts), so an
// object that is the same object in both states did not change, and an array that is the same array holds no change.
// A commit that moves one Task costs a pass over the arrays that moved, and the completion state and Run outcome
// only of the Tasks and Runs it touched; never the O(Runs × Tasks) of asking every Run.
//
// **Payloads are the public DTOs** of the objects, built by the views the reads use (publicViews.ts,
// runCompletion.ts) and shaped by the package's own rules (shapeEvent), so an event says what a read of the same
// object would. A Task is the brief one and carries no check output: an event is a notification, and `get` reads
// the whole object.
import { JOB_FIELDS, shapeEvent, type EventType } from '../publicContract'
import { briefTask, jobView, latestRunOf, runView } from './publicViews'
import { taskCompletionOf, taskCompletionState, type CompletionState } from './runCompletion'
import type { OrchState } from './state'
import type { Job, JobRun, Task } from './types'
import { outcomeOf } from './view'

/** One event before the log gives it an id, a sequence and a time. */
export interface EventDraft {
  type: EventType
  projectId?: string
  jobId?: string
  runId?: string
  taskId?: string
  payload: unknown
}

const byId = <T extends { id: string }>(xs: readonly T[]): Map<string, T> => new Map(xs.map((x) => [x.id, x]))

/** A Job's public fields as one comparable string: `job.updated` is about these, never the derived ones. */
const publicKey = (job: Job): string => JSON.stringify(JOB_FIELDS.map((f) => job[f]))

/** A completion round under way: the checks or the review. */
const ROUND: ReadonlySet<CompletionState> = new Set(['checking', 'rechecking', 'reviewing'])

/** The completion events of one Task's move from `was` to `now`, in order. A round that fails and starts a repair
 *  gives `completion.failed` then `completion.repair_started`; one that runs out gives `completion.failed` then
 *  `completion.exhausted`. */
function completionTypes(was: CompletionState, now: CompletionState): EventType[] {
  const out: EventType[] = []
  if (ROUND.has(was) && !ROUND.has(now) && now !== 'converged') out.push('completion.failed')
  if (now === 'checking') out.push('completion.started')
  if (now === 'fixing' || now === 'fixing-review') out.push('completion.repair_started')
  if (now === 'converged') out.push('completion.converged')
  if (now === 'exhausted') out.push('completion.exhausted')
  return out
}

/** A Task as an event carries it: brief, and its checks without their output. */
const taskPayload = (t: Task): Record<string, unknown> => ({
  ...briefTask(t),
  ...(t.checks !== undefined ? { checks: t.checks.map(({ outputTail: _output, ...check }) => check) } : {})
})

/** The Task event of a status move, or null for a move that is none of the three. */
function taskType(now: Task['status']): EventType | null {
  if (now === 'dispatched') return 'task.started'
  if (now === 'completed') return 'task.completed'
  if (now === 'failed') return 'task.failed'
  return null
}

export function derivePublicEvents(prev: OrchState, next: OrchState): EventDraft[] {
  if (prev === next) return []
  const out: EventDraft[] = []
  /** The ids an event about this Run (and Task) names: its Job's, and that Job's project. */
  const idsOf = (runId: string, taskId?: string): Omit<EventDraft, 'type' | 'payload'> => {
    const jobId = next.runs.find((r) => r.id === runId)?.jobId
    const projectId = jobId === undefined ? undefined : next.jobs.find((j) => j.id === jobId)?.projectId
    return {
      ...(projectId !== undefined ? { projectId } : {}),
      ...(jobId !== undefined ? { jobId } : {}),
      runId,
      ...(taskId !== undefined ? { taskId } : {})
    }
  }
  const push = (type: EventType, ids: Omit<EventDraft, 'type' | 'payload'>, payload: unknown): void => {
    out.push({ type, ...ids, payload: (shapeEvent({ type, payload }) as { payload: unknown }).payload })
  }
  const jobEvent = (type: EventType, job: Job): void =>
    push(type, { ...(job.projectId !== undefined ? { projectId: job.projectId } : {}), jobId: job.id }, jobView(next, job, latestRunOf(next, job)))
  const runEvent = (type: EventType, run: JobRun): void => push(type, idsOf(run.id), runView(next, run))

  if (prev.jobs !== next.jobs) {
    const before = byId(prev.jobs)
    for (const job of next.jobs) {
      const was = before.get(job.id)
      if (was === job) continue
      if (was === undefined) jobEvent('job.created', job)
      else if (publicKey(was) !== publicKey(job)) jobEvent('job.updated', job)
    }
  }

  const runsBefore = prev.runs === next.runs ? null : new Set(prev.runs.map((r) => r.id))
  if (runsBefore !== null) for (const run of next.runs) if (!runsBefore.has(run.id)) runEvent('run.started', run)

  const tasksMoved = prev.tasks !== next.tasks
  const gatesMoved = prev.gates !== next.gates
  const dispatchesMoved = prev.dispatches !== next.dispatches
  /** The Runs whose Tasks this commit changed, added or removed: the only ones whose outcome can have moved. */
  const runsTouched = new Set<string>()
  if (tasksMoved || gatesMoved || dispatchesMoved) {
    const tasksBefore = byId(prev.tasks)
    const tasksNow = tasksMoved ? byId(next.tasks) : tasksBefore
    /** Tasks whose object changed or is new, in the order of the state. */
    const changed: Task[] = []
    if (tasksMoved) {
      for (const t of next.tasks) {
        const was = tasksBefore.get(t.id)
        if (was === t) continue
        changed.push(t)
        if (t.runId !== undefined) runsTouched.add(t.runId)
        if (was?.runId !== undefined) runsTouched.add(was.runId)
      }
      for (const t of prev.tasks) if (!tasksNow.has(t.id) && t.runId !== undefined) runsTouched.add(t.runId)
    }

    for (const t of changed) {
      if (t.runId === undefined) continue
      const type = taskType(t.status)
      if (type !== null && tasksBefore.get(t.id)?.status !== t.status) push(type, idsOf(t.runId, t.id), taskPayload(t))
    }

    // A Task's completion state reads its Gates and Dispatches too (taskCompletionState), so a Task named by a Gate
    // or Dispatch that changed is asked even when its own object did not change.
    const affected = new Set(changed.map((t) => t.id))
    const touchedBy = <T extends { id: string; taskId: string }>(before: readonly T[], now: readonly T[]): void => {
      const was = byId(before)
      for (const x of now) if (was.get(x.id) !== x) affected.add(x.taskId)
      const present = new Set(now.map((x) => x.id))
      for (const x of before) if (!present.has(x.id)) affected.add(x.taskId)
    }
    if (gatesMoved) touchedBy(prev.gates, next.gates)
    if (dispatchesMoved) touchedBy(prev.dispatches, next.dispatches)
    for (const id of affected) {
      const t = tasksNow.get(id)
      if (t === undefined || t.runId === undefined) continue
      const was = tasksBefore.get(id)
      const from = was === undefined ? 'not-started' : taskCompletionState(prev, was)
      const to = taskCompletionState(next, t)
      if (from === to) continue
      const types = completionTypes(from, to)
      if (types.length === 0) continue
      const payload = taskCompletionOf(next, t)
      for (const type of types) push(type, idsOf(t.runId, t.id), payload)
    }
  }

  if (gatesMoved) {
    const before = byId(prev.gates)
    for (const g of next.gates) {
      const was = before.get(g.id)
      if (was === g) continue
      if (was === undefined && g.status === 'open') push('question.created', idsOf(g.runId, g.taskId), g)
      if (g.status === 'resolved' && was?.status !== 'resolved') push('question.answered', idsOf(g.runId, g.taskId), g)
    }
  }

  // Last, so a Run's ending follows the Task events that ended it. Only a Run in both states: one new in this commit
  // has its run.started, and one removed by it has no ending to tell.
  if (runsTouched.size > 0) {
    const before = runsBefore ?? new Set(prev.runs.map((r) => r.id))
    const now = byId(next.runs)
    for (const runId of runsTouched) {
      const run = now.get(runId)
      if (run === undefined || !before.has(runId) || outcomeOf(prev, runId) !== 'running') continue
      const outcome = outcomeOf(next, runId)
      if (outcome === 'completed') runEvent('run.completed', run)
      else if (outcome === 'failed') runEvent('run.failed', run)
    }
  }
  return out
}
