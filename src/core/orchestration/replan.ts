// W6-D wave replanning (orchestrator SPEC §2, §3): a fresh planner looks at what really happened and fixes the rest of
// the plan; after the last Task it checks the result against the objective once more.
//
// The gate is per Task (`waveOpen`, asked by `slotsToFill`, `worker-start` and the coordinator's inbox): a Task starts
// once every Task it waits on (its deps, transitively) has completed. Unrelated Tasks of a lower wave never hold it, and
// a failure holds back only what depends on it. With replanning on, a completed Task that did not go as planned
// (`deviatingTasks`) holds the not-started Tasks it can affect (`affectedLeft`: downstream of it, or sharing paths with
// it) until a replan has looked at it. T36: so does a failed Task nothing else retries (no coordinator, or its tries used
// up) while not-started Tasks wait on it (`failedBlocks`): the replan may retry it, accept it as done, or rewire what
// waits. A Run whose only way on is through a failed Task is stalled (`stallOf`): the driving loop then asks the owner
// once (`failedWaitQuestion`) and carries out the answer (`resolveFailedWait`). The driving loop starts that replan (`replansDue`, exec/dispatchLoop.ts) through
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
import { crossPlanDepRefusal, externalDepsOf, waitsOnItself } from './mainPlan'
import { jobActive, pathsOverlap } from './schedule'
import { doneStatusOf, jobOf, projectWithWorkspace, type OrchState, type PlanFields, type Res } from './state'
import { jobNameOf } from './jobName'
import { FAILURE_LIMIT, newId, recomputeReady, type Dispatch, type Job, type JobRun, type Message, type ReplanMark, type Task } from './types'

/** The replan under way, with `scoped`: started for deviations, so it holds only the Tasks they can affect (no
 *  `dispatchHold`). Absent (also in an older file): it holds the whole Job. */
export type ReplanRecord = NonNullable<Job['replanning']> & { scoped?: true }
/** The last replan that ended, with `startedAt`: a deviation that completed after it began was not in its brief, so it
 *  still waits for the next one. Absent (an older file, a skipped or failed start): `at` stands in. */
export type ReplanEnded = NonNullable<Job['lastReplan']> & { startedAt?: string }

/** Follow-up waves the completion pass may add to one Job before it must hand the Job to the person. */
export const REPLAN_FOLLOW_UPS_MAX = 3

/** The account a Job's replans run on: its coordinator's, else the one its planner ran on (W7-E: a plan the Host
 *  places with no coordinator still gets its replans and its final check). T5b: the account the owner named first, a
 *  preference only: the start takes the account with room (chooseStartAccount), never a full one. */
export const replanAccountOf = (job: Job): string | undefined => job.preferredAccountId ?? job.coordinatorAccountId ?? job.plannerAccountId

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
 *  was not let through by a person, reported no gaps, and touched files only inside its affected paths (no paths: nothing to leave).
 *  T12: what this machine could not run (`notProvable`) is no deviation in a hands-off plan, which accepts it with a
 *  recorded decision; elsewhere it counts like gaps. */
const wentAsPlanned = (s: OrchState, t: Task): boolean =>
  !s.dispatches.some((d) => d.taskId === t.id && !d.review && d.outcome === 'failed') &&
  t.completionOverride === undefined &&
  !t.gaps &&
  (!t.notProvable || handsOffTask(s, t)) &&
  reviewRoundIn(s.dispatches.filter((d) => d.taskId === t.id)) <= 1 &&
  (t.filesModified ?? []).every((f) => !t.affectedPaths?.length || t.affectedPaths.some((p) => pathsOverlap(f, p)))

/** T12: whether the Task's plan runs hands-off: delivery.ts `handsOffOf`, read through the plan's own project here
 *  because this file stays renderer-safe (projects.ts reaches node:path). */
function handsOffTask(s: OrchState, t: Task): boolean {
  const run = s.runs.find((r) => r.id === t.runId)
  const job = run && jobOf(s, run)
  if (!job) return false
  return job.handsOff ?? (job.projectId !== undefined ? projectWithWorkspace(s, job.projectId)?.handsOff : undefined) ?? false
}

/** When this Run's deviations were last looked at: the start of its last replan that ended. '' for none. */
function coveredSince(job: Job, runId: string): string {
  const last = job.lastReplan as ReplanEnded | undefined
  return last?.runId === runId ? (last.startedAt ?? last.at) : ''
}

/** The Tasks of a Run that did not go as planned and that no replan has looked at yet: completed ones that went
 *  another way, and (T36) failed ones holding back not-started Tasks that nothing else retries: the Run has no
 *  coordinator, or the Task's tries are used up. */
function unplanned(s: OrchState, job: Job, runId: string): Task[] {
  const since = coveredSince(job, runId)
  const run = s.runs.find((r) => r.id === runId)
  const coordinator = run?.coordinatorSessionId !== undefined || run?.externalCoordinatorSessionId !== undefined
  const failed = new Set(
    failedBlocks(s, runId)
      .filter((b) => !coordinator || b.task.consecutiveFailures >= FAILURE_LIMIT)
      .map((b) => b.task.id)
  )
  return runTasks(s, runId).filter((t) => t.updatedAt > since && (t.status === 'completed' ? !wentAsPlanned(s, t) : failed.has(t.id)))
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

/** T36: a failed Task with no worker on it, and the not-started Tasks that wait on it, directly or through others. */
export interface FailedBlock {
  task: Task
  waiting: Task[]
}

/** The failed Tasks of a Run that hold back not-started Tasks, each with what waits on it. */
export function failedBlocks(s: OrchState, runId: string): FailedBlock[] {
  const own = runTasks(s, runId)
  const working = new Set(s.dispatches.filter((d) => !d.outcome && !d.endedAt).map((d) => d.taskId))
  const left = own.filter((t) => notStarted(s, t))
  return own
    .filter((t) => t.status === 'failed' && !working.has(t.id))
    .map((task) => ({ task, waiting: downstreamIn(task.id, left) }))
    .filter((b) => b.waiting.length > 0)
}

/** The Tasks of `left` that wait on `id`, directly or through others of `left`. */
function downstreamIn(id: string, left: readonly Task[]): Task[] {
  const hit = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const t of left)
      if (!hit.has(t.id) && t.deps.some((d) => hit.has(d))) {
        hit.add(t.id)
        grew = true
      }
  }
  return left.filter((t) => t.id !== id && hit.has(t.id))
}

/** T36: why a Run cannot move, and the failed Tasks it waits on. */
export interface RunStall {
  reason: string
  blocks: FailedBlock[]
}

/**
 * T36: whether Run `run` is stalled, the one place that says so (the driving loop, `runs doctor` and the plan views read
 * it). Stalled: its plan is active, not paused, not held by a person, not replanning; no coordinator, worker or reviewer
 * works on it; no open Gate, no unanswered worker question and no escalation waiting for a choice (the question this
 * raises, `isFailedWait`, does not count: it is how the stall is resolved); and every unfinished Task is a failed one
 * (whatever its tries left: no coordinator retries it) or one that waits on a failed one. A Run with nothing waiting on
 * its failures has ended, not stalled.
 */
export function stallOf(s: OrchState, run: JobRun): RunStall | undefined {
  const job = jobOf(s, run)
  if (!job || !jobActive(job) || job.dispatchHold || job.replanning || run.paused) return undefined
  if (run.coordinatorSessionId !== undefined || run.externalCoordinatorSessionId !== undefined) return undefined
  const own = runTasks(s, run.id)
  const ids = new Set(own.map((t) => t.id))
  if (s.dispatches.some((d) => ids.has(d.taskId) && !d.outcome && !d.endedAt)) return undefined
  if (s.gates.some((g) => g.runId === run.id && g.status === 'open')) return undefined
  const asked = (m: Message): boolean =>
    m.runId === run.id && !m.answered && (m.type === 'question' || (m.type === 'escalation' && (m.options?.length ?? 0) > 0 && !isFailedWait(m)))
  if (s.messages.some(asked)) return undefined
  const blocks = failedBlocks(s, run.id)
  if (blocks.length === 0) return undefined
  const stuck = new Set(blocks.flatMap((b) => [b.task.id, ...b.waiting.map((t) => t.id)]))
  // No coordinator here (returned above), so no path retries a failed Task whatever its tries left (running.ts `stuckOf`)
  if (!own.every((t) => t.status === 'completed' || t.status === 'failed' || stuck.has(t.id)))
    return undefined
  const first = blocks[0]
  const more = blocks.length > 1 ? ` and ${blocks.length - 1} other failed Task(s)` : ''
  return { reason: `waiting on ${first.task.id} (${first.task.title}) (failed): ${first.waiting.length} Task(s) wait on it${more}`, blocks }
}

/** T36: the answers of the owner question over a failed Task that holds back the rest of its plan. */
export const FAILED_WAIT_OPTIONS = ['Retry', 'Accept as done', 'Cancel what waits on it'] as const
export type FailedWaitAction = 'retry' | 'accept' | 'cancel'

/** T10: how long after its Nth failure (index N-1) a hands-off plan with no coordinator retries a failed Task itself
 *  (exec/failedRetry.ts): 1 minute after the 1st, 5 after the 2nd. Here, renderer-safe, for the board's "retrying in". */
export const FAILED_RETRY_BACKOFF_MS: readonly number[] = [60_000, 5 * 60_000]

/** T10: when such a failed Task with tries left is retried: its failure time (`updatedAt`) plus its backoff. Undefined
 *  once its tries are used up. */
export function failedRetryAt(t: Pick<Task, 'consecutiveFailures' | 'updatedAt'>): string | undefined {
  if (t.consecutiveFailures >= FAILURE_LIMIT) return undefined
  const wait = FAILED_RETRY_BACKOFF_MS[Math.min(Math.max(t.consecutiveFailures, 1), FAILED_RETRY_BACKOFF_MS.length) - 1]
  const at = Date.parse(t.updatedAt)
  return Number.isNaN(at) ? t.updatedAt : new Date(at + wait).toISOString()
}
const FAILED_WAIT_ACTIONS: readonly FailedWaitAction[] = ['retry', 'accept', 'cancel']

/** The owner question `failedWaitQuestion` raised: told apart by its answers. */
export const isFailedWait = (m: Pick<Message, 'type' | 'options'>): boolean =>
  m.type === 'escalation' && m.options?.length === FAILED_WAIT_OPTIONS.length && FAILED_WAIT_OPTIONS.every((o, i) => m.options![i] === o)

/** The questions raised over `task` since it last failed. */
const failedWaitsOf = (s: OrchState, task: Task): Message[] =>
  s.messages.filter((m) => isFailedWait(m) && m.taskId === task.id && m.createdAt >= task.updatedAt)

/** Whether the owner was asked about this failure of `task` already: one question per failure. */
export const failedWaitAsked = (s: OrchState, task: Task): boolean => failedWaitsOf(s, task).length > 0

const oneLine = (text: string | undefined, max: number): string => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || '(no report)'

/** The owner question over a failed Task that holds back `block.waiting`: an escalation in its Run, with the three
 *  answers. "<plan>: N Tasks wait on failed <Task>: <its result>". */
export function failedWaitQuestion(s: OrchState, block: FailedBlock, now: string): Message {
  const run = s.runs.find((r) => r.id === block.task.runId)
  const job = run && jobOf(s, run)
  const plan = job ? jobNameOf(job) : (block.task.runId ?? '')
  const n = block.waiting.length
  return {
    id: newId('msg'),
    runId: block.task.runId ?? '',
    type: 'escalation',
    taskId: block.task.id,
    subject: `${plan}: ${n} Task${n === 1 ? '' : 's'} wait on failed ${block.task.title}: ${oneLine(block.task.result, 300)}`.slice(0, 500),
    body:
      `${block.task.title} (${block.task.id}) failed, and nothing else can move the plan: ` +
      `${block.waiting.map((t) => t.title).join(', ')} wait on it.\n\n` +
      `${FAILED_WAIT_OPTIONS[0]}: run it again. ${FAILED_WAIT_OPTIONS[1]}: take what it did as done, with its gaps, so what ` +
      `waits on it starts. ${FAILED_WAIT_OPTIONS[2]}: drop the Tasks that wait on it; the rest of the plan ends.`,
    options: [...FAILED_WAIT_OPTIONS],
    answered: false,
    createdAt: now
  }
}

/** The owner's answer to the question over this failure of `task`, while the Task is still failed: the newest
 *  answered one. A hands-off answer reads "<choice>. Why: <reason>", so the choice is the part before it. */
export function failedWaitChoice(s: OrchState, task: Task): FailedWaitAction | undefined {
  if (task.status !== 'failed') return undefined
  const m = failedWaitsOf(s, task).filter((x) => x.answered && x.answerBody !== undefined).at(-1)
  const said = m?.answerBody?.split(/\.\s*why:/i)[0].trim().toLowerCase()
  if (said === undefined) return undefined
  const i = FAILED_WAIT_OPTIONS.findIndex((o) => o.toLowerCase() === said)
  return i >= 0 ? FAILED_WAIT_ACTIONS[i] : FAILED_WAIT_ACTIONS.find((a) => a === said)
}

/**
 * T36: carries out a choice over a failed Task (the owner's answer, the plan views' buttons, or a replan):
 * - `retry`: it is ready again with its tries reset, with `patch` (a replan's changed spec) applied; T10: with
 *   `keepFailures` (Astera's own retry in a hands-off plan with no coordinator) it keeps its failure count, so its tries
 *   run out instead of repeating forever;
 * - `accept`: it counts as done with its gaps (`completionOverride` with `reason`), so what waits on it starts;
 * - `cancel`: the not-started Tasks that wait on it leave the Run, and it stays failed with its tries used up, so the
 *   Run ends.
 * Its open questions are marked answered with the choice.
 */
export function resolveFailedWait(
  s: OrchState,
  taskId: string,
  action: FailedWaitAction,
  now: string,
  opts: { reason?: string; patch?: PlanFields & { title?: string; spec?: string }; keepFailures?: boolean } = {}
): Res<Task> {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `unknown task: ${taskId}`, missing: true }
  if (task.status !== 'failed') return { ok: false, error: `${taskId} is ${task.status}, not failed` }
  if (s.dispatches.some((d) => d.taskId === taskId && !d.outcome && !d.endedAt)) return { ok: false, error: `${taskId} has a worker on it` }
  let next: OrchState = s
  if (action === 'cancel') {
    let rest = task.runId === undefined ? [] : (failedBlocks(s, task.runId).find((b) => b.task.id === taskId)?.waiting ?? [])
    // Leaves first: a Task is cancelled once nothing unfinished waits on it (cancelRemainingTask)
    while (rest.length > 0) {
      const before = rest.length
      for (const t of [...rest]) {
        const r = cancelRemainingTask(next, t.id)
        if (!r.ok) continue
        next = r.state
        rest = rest.filter((x) => x.id !== t.id)
      }
      if (rest.length === before) return { ok: false, error: `${rest.map((t) => t.id).join(', ')} could not be cancelled` }
    }
    const done = { ...task, consecutiveFailures: Math.max(task.consecutiveFailures, FAILURE_LIMIT), updatedAt: now }
    next = { ...next, tasks: next.tasks.map((t) => (t.id === taskId ? done : t)) }
  } else if (action === 'retry') {
    const done: Task = { ...task, ...opts.patch, status: 'ready', consecutiveFailures: opts.keepFailures ? task.consecutiveFailures : 0, updatedAt: now }
    next = { ...next, tasks: next.tasks.map((t) => (t.id === taskId ? done : t)) }
  } else {
    const done: Task = {
      ...task,
      status: doneStatusOf(s, task),
      consecutiveFailures: 0,
      completionOverride: { reason: opts.reason?.trim() || 'accepted as done with its gaps', at: now },
      updatedAt: now
    }
    next = { ...next, tasks: recomputeReady(next.tasks.map((t) => (t.id === taskId ? done : t))) }
  }
  const label = FAILED_WAIT_OPTIONS[FAILED_WAIT_ACTIONS.indexOf(action)]
  next = { ...next, messages: next.messages.map((m) => (isFailedWait(m) && m.taskId === taskId && !m.answered ? { ...m, answered: true, answerBody: label } : m)) }
  return { ok: true, state: next, value: next.tasks.find((t) => t.id === taskId)! }
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
 *   before the end. T36: a failed Task that holds back not-started Tasks and that nothing else retries counts too
 *   (`unplanned`): the replan looks at it once; still failed after that, the Run stalls and the owner is asked.
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

/** T1: why `task` may not take `deps`, or undefined: each one a Task of `own` (its plan or Run), or of another active or
 *  queued plan of the project (mainPlan.ts `crossPlanDepRefusal`), and none that would make it wait on itself across plans. */
export function depsRefusal(s: OrchState, task: Task, deps: string[], own: ReadonlySet<string>): string | undefined {
  if (deps.includes(task.id)) return `${task.id} cannot wait on itself`
  const planId = task.jobId ?? s.runs.find((r) => r.id === task.runId)?.jobId
  for (const d of deps) {
    if (own.has(d)) continue
    const dep = s.tasks.find((t) => t.id === d)
    if (!dep) return `unknown dep ${d}: deps must be Tasks of this plan or of another active plan of this project`
    const refused = crossPlanDepRefusal(s, planId, dep)
    if (refused !== undefined) return refused
    if (dep.jobId === planId || s.runs.some((r) => r.id === dep.runId && r.jobId === planId))
      return `${d} is a Task of another Run of this plan: deps must be Tasks of the same run`
  }
  const tasks = s.tasks.map((t) => (t.id === task.id ? { ...t, deps } : t))
  if (waitsOnItself(tasks, task.id)) return `those deps would make ${task.id} wait on itself`
  return undefined
}

/** Edits a not-started Task of a Run (`task-update` from a replan session): its title, spec, deps and plan fields. A dep is
 *  a Task of the Run or, as `task-create` allows, of another plan of the project (planner.ts `depsRefusal`); deps may not
 *  close a cycle. A Task waits (pending) until its own deps are completed and the other plans' are completed and delivered. */
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
    const refused = depsRefusal(s, task, patch.deps, new Set(own.filter((t) => t.id !== taskId).map((t) => t.id)))
    if (refused !== undefined) return { ok: false, error: refused }
  }
  const merged: Task = { ...task, ...patch, updatedAt: now }
  const doneIds = new Set(own.filter((t) => t.status === 'completed').map((t) => t.id))
  // A Task under an open Gate stays blocked: the Gate's answer unblocks it (resolveGate), and the deps then decide
  const other = externalDepsOf(s, merged)
  const met = merged.deps.every((d) => doneIds.has(d) || other.find((x) => x.id === d)?.satisfied === true)
  const next: Task = { ...merged, status: task.status === 'blocked' ? 'blocked' : met ? 'ready' : 'pending' }
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

/** T5: the owner's `task-cancel`: any Task of a Run that has not completed, started or not, leaves the Run. Its open
 *  Dispatches are closed (kept as history; the caller releases their sessions after the commit), its Gates are dropped, its
 *  open questions settled, and the Run's feed says who cancelled it and why. `merging` and `completed` Tasks are refused
 *  (their work is landing or landed), and so is a Task an unfinished Task still depends on, as for a replan. */
export function cancelTaskByOwner(s: OrchState, taskId: string, reason: string, now: string): Res<{ task: Task; closed: Dispatch[] }> {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `unknown task: ${taskId}`, missing: true }
  if (task.runId === undefined) return { ok: false, error: `${taskId} is not a Task of a Run` }
  if (task.status === 'completed' || task.status === 'merging')
    return { ok: false, error: `${taskId} is ${task.status}: its work is ${task.status === 'merging' ? 'landing' : 'done'}, so it is not cancelled` }
  const waiting = runTasks(s, task.runId).filter((t) => t.status !== 'completed' && t.deps.includes(taskId))
  if (waiting.length) return { ok: false, error: `${waiting.map((t) => t.id).join(', ')} depend on ${taskId}: change their --deps first` }
  const closed = s.dispatches.filter((d) => d.taskId === taskId && !d.outcome && !d.endedAt)
  const closing = new Set(closed.map((d) => d.id))
  const state: OrchState = {
    ...s,
    tasks: s.tasks.filter((t) => t.id !== taskId),
    gates: s.gates.filter((g) => g.taskId !== taskId),
    // closedBy 'stop': a person ended it, so no Gate asks about a lost attempt (state.ts lostAttemptOf)
    dispatches: s.dispatches.map((d) => (closing.has(d.id) ? { ...d, workerState: 'stopped' as const, endedAt: now, closedBy: 'stop' as const } : d)),
    // Nobody is left to answer: settled with an empty answer, never deleted (state.ts settlePendingQuestions)
    messages: [
      ...s.messages.map((m) => (m.type === 'question' && !m.answered && (m.taskId === taskId || (m.dispatchId !== undefined && closing.has(m.dispatchId))) ? { ...m, answered: true, answerBody: '' } : m)),
      {
        id: newId('msg'),
        runId: task.runId,
        type: 'status',
        taskId,
        subject: `${task.title} cancelled by the owner: ${reason.replace(/\s+/g, ' ').trim()}`.slice(0, 300),
        body: `The owner cancelled ${taskId} (${task.title}); it has left the Run.`,
        answered: false,
        createdAt: now
      }
    ]
  }
  return { ok: true, state, value: { task, closed } }
}
