// W6-D wave replanning (orchestrator SPEC §2, §3): a fresh planner looks at what really happened and fixes the rest of
// the plan; after the last Task it checks the result against the objective once more.
//
// The gate is per Task (`waveOpen`, asked by `slotsToFill`, `worker-start` and the coordinator's inbox): a Task starts
// once every Task it waits on (its deps, transitively) has completed. Unrelated Tasks of a lower wave never hold it, and
// a failure holds back only what depends on it. With replanning on, a completed Task that did not go as planned
// (`deviatingTasks`) holds the not-started Tasks it can affect (`affectedLeft`: downstream of it, or sharing paths with
// it) until a replan has looked at it. The driving loop starts that replan (`replansDue`, exec/dispatchLoop.ts) through
// `jobs-replan` (exec/replanStart.ts); such a replan is *scoped*: it holds only those Tasks, the rest of the plan goes
// on. The final check, owner feedback and a person's own replan are not scoped: they hold the whole Job
// (`dispatchHold`). The planner may change only what has not started: `replanRefusal` is asked before
// `plannerRefusal`, and the edits check it again.
//
// Two fields beyond types.ts are kept on the Job's replan records (`ReplanRecord`, `ReplanEnded`); a file written before
// them reads as an unscoped replan and as one that covered what completed before it ended.
//
// Pure: no clock, no files, and renderer-safe (tsconfig.web.json lists it): what needs the planner's rules
// (`replanRefusal`, `replanProblems`, `replanSummary`) is in exec/replanStart.ts.
import { reviewRoundIn } from './convergence'
import { layersOf } from './graph'
import { jobActive, pathsOverlap } from './schedule'
import { jobOf, type OrchState, type PlanFields, type Res } from './state'
import type { Job, ReplanMark, Task } from './types'

/** The replan under way, with `scoped`: started for deviations, so it holds only the Tasks they can affect (no
 *  `dispatchHold`). Absent (also in an older file): it holds the whole Job. */
export type ReplanRecord = NonNullable<Job['replanning']> & { scoped?: true }
/** The last replan that ended, with `startedAt`: a deviation that completed after it began was not in its brief, so it
 *  still waits for the next one. Absent (an older file, a skipped or failed start): `at` stands in. */
export type ReplanEnded = NonNullable<Job['lastReplan']> & { startedAt?: string }

/** Follow-up waves the completion pass may add to one Job before it must hand the Job to the person. */
export const REPLAN_FOLLOW_UPS_MAX = 3

/** The account a Job's replans run on: its coordinator's, else the one its planner ran on (W7-E: a plan the Host
 *  places with no coordinator still gets its replans and its final check). */
export const replanAccountOf = (job: Job): string | undefined => job.coordinatorAccountId ?? job.plannerAccountId

/** Whether a Job replans between its waves: not turned off, planned by a planner (an unplanned Job has no plan to
 *  fix and keeps its old scheduling), not a schedule (its Runs repeat one plan), and with an account to plan on. */
export const replanOn = (job: Job): boolean =>
  job.replan !== 'off' && job.plannerSessionIds !== undefined && job.schedule === undefined && replanAccountOf(job) !== undefined

type Node = Pick<Task, 'id' | 'deps'>
const waveMemo = new WeakMap<readonly Node[], { byId: Map<string, Node>; depth: Map<string, number> }>()

/** A Task's wave: 0 with no deps, else 1 + the highest wave of its deps. Deps outside `tasks` are not counted, and a
 *  cycle (which `validatePlan` refuses) counts as 0 where it closes instead of looping. Memoised per `tasks` array. */
export function waveOf(task: Node, tasks: readonly Node[]): number {
  let memo = waveMemo.get(tasks)
  if (!memo) {
    memo = { byId: new Map(tasks.map((t) => [t.id, t])), depth: new Map() }
    waveMemo.set(tasks, memo)
  }
  const { byId, depth } = memo
  const seen = new Set<string>()
  const of = (t: Node): number => {
    const known = depth.get(t.id)
    if (known !== undefined) return known
    if (seen.has(t.id)) return 0
    seen.add(t.id)
    const ds = t.deps.map((d) => byId.get(d)).filter((d): d is Node => d !== undefined)
    const w = ds.length === 0 ? 0 : 1 + Math.max(...ds.map(of))
    seen.delete(t.id)
    depth.set(t.id, w)
    return w
  }
  return of(task)
}

export const runTasks = (s: OrchState, runId: string): Task[] => s.tasks.filter((t) => t.runId === runId)

/** The Tasks `task` waits on, directly or through others, within `tasks`. */
function upstreamOf(task: Node, tasks: readonly Node[]): Set<string> {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const out = new Set<string>()
  const stack = [...task.deps]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (out.has(id)) continue
    out.add(id)
    stack.push(...(byId.get(id)?.deps ?? []))
  }
  return out
}

/** Whether a Task may start as far as the plan goes: always with replanning off. Otherwise once every Task it waits on
 *  (deps, transitively, in its Run) has completed, so a failure holds back only what depends on it; never while an
 *  unscoped replan holds its Job; and, not started yet, not while a deviation it can affect waits for its replan
 *  (`heldForReplan`). Unrelated Tasks of a lower wave, and a scoped replan elsewhere in the plan, do not hold it. */
export function waveOpen(task: Task, s: OrchState): boolean {
  const run = task.runId === undefined ? undefined : s.runs.find((r) => r.id === task.runId)
  const job = run && jobOf(s, run)
  if (!job || !replanOn(job)) return true
  if (job.replanning && !(job.replanning as ReplanRecord).scoped) return false
  const own = runTasks(s, run.id)
  const up = upstreamOf(task, own)
  if (own.some((t) => up.has(t.id) && t.status !== 'completed')) return false
  return !notStarted(s, task) || !heldForReplan(s, job, run.id).has(task.id)
}

/** Not started: waiting, ready, or blocked by a Gate before it ever ran (W8-E, #95: the coordinator's question about
 *  it is no start), and never given a worker. Only these may a replan change. */
export const notStarted = (s: OrchState, t: Task): boolean =>
  (t.status === 'pending' || t.status === 'ready' || t.status === 'blocked') && !s.dispatches.some((d) => d.taskId === t.id)

const completedIn = (ts: readonly Task[]): number => ts.filter((t) => t.status === 'completed').length

/** Whether a completed Task went as planned, from Host state only: no attempt of it failed (a retry resets its failure
 *  count, so the Dispatches say), it needed one review round at most,
 *  was not let through by a person, and touched files only inside its affected paths (no paths: nothing to leave). */
const wentAsPlanned = (s: OrchState, t: Task): boolean =>
  !s.dispatches.some((d) => d.taskId === t.id && !d.review && d.outcome === 'failed') &&
  t.completionOverride === undefined &&
  reviewRoundIn(s.dispatches.filter((d) => d.taskId === t.id)) <= 1 &&
  (t.filesModified ?? []).every((f) => !t.affectedPaths?.length || t.affectedPaths.some((p) => pathsOverlap(f, p)))

/** When this Run's deviations were last looked at: the start of its last replan that ended. '' for none. */
function coveredSince(job: Job, runId: string): string {
  const last = job.lastReplan as ReplanEnded | undefined
  return last?.runId === runId ? (last.startedAt ?? last.at) : ''
}

/** The completed Tasks of a Run that did not go as planned and that no replan has looked at yet. */
function unplanned(s: OrchState, job: Job, runId: string): Task[] {
  const since = coveredSince(job, runId)
  return runTasks(s, runId).filter((t) => t.status === 'completed' && t.updatedAt > since && !wentAsPlanned(s, t))
}

/** The Tasks a wave replan has to look at: those completed since this Run's last replan began that did not go as
 *  planned. Owner feedback not yet answered by a replan counts as a deviation of the whole plan (all done Tasks). */
export function deviatingTasks(s: OrchState, job: Job, runId: string): Task[] {
  if ((job.feedback ?? []).some((f) => f.phase === 'run' && f.changes === undefined))
    return runTasks(s, runId).filter((t) => t.status === 'completed')
  return unplanned(s, job, runId)
}

/** The not-started Tasks of a Run that wait for a replan: those the unplanned deviations can affect. A scoped replan
 *  under way holds them too: its deviations count until it ends (`coveredSince`), with any that completed meanwhile. */
function heldForReplan(s: OrchState, job: Job, runId: string): Set<string> {
  const deviating = unplanned(s, job, runId)
  if (deviating.length === 0) return new Set()
  return new Set(affectedLeft(deviating, runTasks(s, runId).filter((t) => notStarted(s, t))).map((t) => t.id))
}

/** The not-started Tasks `deviating` can affect: waiting on one of them (or on a Task so affected), or sharing paths
 *  with what one planned or changed. */
export function affectedLeft(deviating: readonly Task[], left: readonly Task[]): Task[] {
  const paths = deviating.flatMap((t) => [...(t.affectedPaths ?? []), ...(t.filesModified ?? [])])
  const hit = new Set<string>(deviating.map((t) => t.id))
  const out = new Set<string>()
  for (let grew = true; grew; ) {
    grew = false
    for (const t of left) {
      if (out.has(t.id)) continue
      if (t.deps.some((d) => hit.has(d)) || (t.affectedPaths ?? []).some((p) => paths.some((q) => pathsOverlap(p, q)))) {
        out.add(t.id)
        hit.add(t.id)
        grew = true
      }
    }
  }
  return left.filter((t) => out.has(t.id))
}

/**
 * The replans the driving loop should start now, one per Run at most:
 * - `wave`: a completed Task did not go as planned, no replan has looked at it, and a not-started Task it can affect is
 *   left (`heldForReplan`). Its `wave` is the lowest wave of those Tasks. A plan that goes as planned never replans
 *   before the end, and a failed Task is no deviation: what waits on it simply does not start.
 * - `completion`: every Task is completed and the last replan was not a completion pass over this many done Tasks.
 *   Only for a Run `seenRunning` says this process watched run, so a Run that ended before (or before this existed)
 *   is not reopened.
 */
export function replansDue(s: OrchState, seenRunning: (runId: string) => boolean): ReplanMark[] {
  const out: ReplanMark[] = []
  for (const run of s.runs) {
    const job = jobOf(s, run)
    if (!job || !replanOn(job) || !jobActive(job) || job.replanning || run.paused) continue
    const ts = runTasks(s, run.id)
    if (ts.length === 0) continue
    const done = completedIn(ts)
    const last = job.lastReplan?.runId === run.id ? job.lastReplan : undefined
    if (ts.every((t) => t.status === 'completed')) {
      if (!seenRunning(run.id) || (last?.mode === 'completion' && last.done === done)) continue
      out.push({ runId: run.id, mode: 'completion', wave: 1 + Math.max(...ts.map((t) => waveOf(t, s.tasks))), done })
      continue
    }
    const held = heldForReplan(s, job, run.id)
    if (held.size === 0) continue
    out.push({ runId: run.id, mode: 'wave', wave: Math.min(...ts.filter((t) => held.has(t.id)).map((t) => waveOf(t, s.tasks))), done })
  }
  return out
}

/** Whether a Run that has completed is really done: replanning is off, or its completion pass ran over exactly these
 *  completed Tasks and was not handed to a person who still holds the Job. Until then its PR, its "plan done" and its
 *  coordinator's stop wait. */
export function completionSettled(s: OrchState, job: Job, runId: string): boolean {
  if (!replanOn(job)) return true
  if (job.replanning) return false
  const last = job.lastReplan
  return (
    last?.runId === runId &&
    last.mode === 'completion' &&
    last.done === completedIn(runTasks(s, runId)) &&
    !(last.escalated !== undefined && job.dispatchHold)
  )
}

/** The Job whose replan session `sessionId` is, if it is one. */
export function replanJobOf(s: OrchState, sessionId: string): Job | undefined {
  if (sessionId === '') return undefined
  return s.jobs.find((j) => j.replanning?.sessionId === sessionId)
}

/** Edits a not-started Task of a Run (`task-update` from a replan session): its title, spec, deps and plan fields. Deps
 *  stay inside the Run and may not close a cycle; a Task whose deps are not all completed waits (pending). */
export function editRemainingTask(
  s: OrchState,
  taskId: string,
  patch: PlanFields & { title?: string; spec?: string; deps?: string[] },
  now: string
): Res<Task> {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `unknown task: ${taskId}`, missing: true }
  if (task.runId === undefined || !notStarted(s, task))
    return { ok: false, error: `${taskId} has started or finished: a replan changes only Tasks that have not started` }
  const own = runTasks(s, task.runId)
  if (patch.deps) {
    const ids = new Set(own.map((t) => t.id))
    const outside = patch.deps.filter((d) => !ids.has(d) || d === taskId)
    if (outside.length) return { ok: false, error: `deps must be other Tasks of the same run: ${outside.join(', ')}` }
  }
  const merged: Task = { ...task, ...patch, updatedAt: now }
  const doneIds = new Set(own.filter((t) => t.status === 'completed').map((t) => t.id))
  // A Task under an open Gate stays blocked: the Gate's answer unblocks it (resolveGate), and the deps then decide
  const next: Task = { ...merged, status: task.status === 'blocked' ? 'blocked' : merged.deps.every((d) => doneIds.has(d)) ? 'ready' : 'pending' }
  const tasks = s.tasks.map((t) => (t.id === taskId ? next : t))
  if (layersOf({ ...s, tasks }, task.runId).cyclic.length) return { ok: false, error: `those deps would make ${taskId} wait on itself` }
  return { ok: true, state: { ...s, tasks }, value: next }
}

/** Cancels a not-started Task of a Run (`task-cancel`): it leaves the Run. Refused while an unfinished Task still
 *  depends on it: the replan changes that Task's deps first, so nothing is left waiting on a Task that is gone. */
export function cancelRemainingTask(s: OrchState, taskId: string): Res<Task> {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `unknown task: ${taskId}`, missing: true }
  if (task.runId === undefined || !notStarted(s, task))
    return { ok: false, error: `${taskId} has started or finished: only a Task that has not started is cancelled` }
  const waiting = runTasks(s, task.runId).filter((t) => t.status !== 'completed' && t.deps.includes(taskId))
  if (waiting.length) return { ok: false, error: `${waiting.map((t) => t.id).join(', ')} depend on ${taskId}: change their --deps first` }
  // A blocked Task's open Gate goes with it (W8-E): nobody is left to answer it for
  return { ok: true, state: { ...s, tasks: s.tasks.filter((t) => t.id !== taskId), gates: s.gates.filter((g) => g.taskId !== taskId) }, value: task }
}
