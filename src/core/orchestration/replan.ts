// W6-D wave replanning (orchestrator SPEC §2, §3): between waves, a fresh planner looks at what really happened and
// fixes the rest of the plan; after the last wave it checks the result against the objective once more.
//
// A wave is a Task's dependency depth (`waveOf`). With replanning on, a Task of wave n+1 starts only once every Task of
// a lower wave is completed, the boundary has been replanned and no replan runs (`waveOpen`, asked by `slotsToFill` and
// `worker-start`). The driving loop starts a replan at each boundary (`replansDue`, exec/dispatchLoop.ts), through
// `jobs-replan` (exec/replanStart.ts), which holds the Job (`dispatchHold`) while the planner works. The planner may
// change only what has not started: `replanRefusal` is asked before `plannerRefusal`, and the edits check it again.
//
// Pure: no clock, no files, and renderer-safe (tsconfig.web.json lists it): what needs the planner's rules
// (`replanRefusal`, `replanProblems`, `replanSummary`) is in exec/replanStart.ts.
import { reviewRoundIn } from './convergence'
import { layersOf } from './graph'
import { jobActive, pathsOverlap } from './schedule'
import { jobOf, type OrchState, type PlanFields, type Res } from './state'
import type { Job, ReplanMark, Task } from './types'

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

/** Whether a Task may start as far as waves go: always with replanning off; otherwise only while no replan runs for its
 *  Job, and for wave n > 0 once every Task of a lower wave in its Run is completed and the boundary before n has been
 *  replanned (its `lastReplan`). */
export function waveOpen(task: Task, s: OrchState): boolean {
  const run = task.runId === undefined ? undefined : s.runs.find((r) => r.id === task.runId)
  const job = run && jobOf(s, run)
  if (!job || !replanOn(job)) return true
  if (job.replanning) return false
  const w = waveOf(task, s.tasks)
  if (w === 0) return true
  // The boundary must have been replanned too, so no placer (the loop, a coordinator) slips in before the replan starts
  const last = job.lastReplan
  if (last?.runId !== run.id || last.mode !== 'wave' || last.wave !== w) return false
  return runTasks(s, run.id).every((t) => t.status === 'completed' || waveOf(t, s.tasks) >= w)
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

/** The Tasks a wave replan has to look at: those of a lower wave, finished since this Run's last replan, that did not go
 *  as planned. Owner feedback not yet answered by a replan counts as a deviation of the whole plan (all done Tasks). */
export function deviatingTasks(s: OrchState, job: Job, mark: ReplanMark): Task[] {
  const since = job.lastReplan?.runId === mark.runId ? job.lastReplan.at : ''
  const done = runTasks(s, mark.runId).filter((t) => t.status === 'completed' && waveOf(t, s.tasks) < mark.wave)
  if ((job.feedback ?? []).some((f) => f.phase === 'run' && f.changes === undefined)) return done
  return done.filter((t) => t.updatedAt > since && !wentAsPlanned(s, t))
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
 * - `wave`: the lowest wave with an unfinished Task is n > 0 (every lower Task is completed), something there has not
 *   started, and this Run's last replan was not for that wave already.
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
    const open = ts.filter((t) => t.status !== 'completed')
    if (open.length === 0) {
      if (!seenRunning(run.id) || (last?.mode === 'completion' && last.done === done)) continue
      out.push({ runId: run.id, mode: 'completion', wave: 1 + Math.max(...ts.map((t) => waveOf(t, s.tasks))), done })
      continue
    }
    const wave = Math.min(...open.map((t) => waveOf(t, s.tasks)))
    if (wave === 0 || (last?.mode === 'wave' && last.wave === wave)) continue
    if (!open.some((t) => notStarted(s, t))) continue
    out.push({ runId: run.id, mode: 'wave', wave, done })
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
