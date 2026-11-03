// Hands-off means hands off (owner, 2026-11-03: "when I say hands off I mean hands off — why do I have a 'needs
// approval' when I told you to watch it for me"; "Failed 4 times in a row · nothing restarts it on its own, tf is this").
//
// Two things a hands-off plan used to hand to its owner, decided here instead, each bounded:
//
// - **A worker that could not be started** (the Host jammed or restarting, its pty supervisor not answering the spawn,
//   the worktree root unreachable for a moment). The machine failed, not the work: no Gate, and no failure toward the
//   circuit breaker. The start is tried again after a growing wait (`START_RETRY_BACKOFF_MS`), `START_RETRY_LIMIT` times
//   for such a transient cause and `START_RETRY_LIMIT_OTHER` for any other; then the Task is held (blocked, no Gate)
//   and the rest of the plan goes on without it.
// - **A Task whose circuit breaker tripped** (`FAILURE_LIMIT` failures in a row, or its lost worker out of retries). It
//   gets `FRESH_ATTEMPTS` fresh attempts: its failure count back at 0, its model one rung stronger (roleModels.ts
//   nextRung), and a summary of what failed put in its next worker's spec. Once those fail too, Astera gives up on it:
//   failed, what waits on it cancelled, so the plan reaches its end and delivers what it has.
//
// Pure, no clock: the dispatch loop, the stall watchdog and command.ts carry the steps out.
import { latestImplDispatch } from '../convergence'
import { handsOffOf } from '../delivery'
import { resolveFailedWait, isFailedWait } from '../replan'
import { nextRung } from '../roleModels'
import { jobOf, type OrchState, type Res } from '../state'
import { FAILURE_LIMIT, type Task } from '../types'

/** The waits before each new start after a failed one (the last repeats). */
export const START_RETRY_BACKOFF_MS: readonly number[] = [30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000]
/** Failed starts in a row, for a transient cause, before the Task is held: about half an hour of tries in all. */
export const START_RETRY_LIMIT = 6
/** ... and for any other cause (a refusal that will likely repeat): the old "asked and answered twice". */
export const START_RETRY_LIMIT_OTHER = 2
/** Fresh attempts a hands-off Task gets once its circuit breaker tripped, before Astera gives up on it. */
export const FRESH_ATTEMPTS = 1

/** A start that failed because the machine did not answer, not because the Task cannot run: the Host or its pty
 *  supervisor busy or restarting, a folder or network drive that did not answer in time, a lock held a moment. */
const TRANSIENT_START = [
  /WORKTREE_ROOT_UNREACHABLE/,
  /did not answer/i,
  /\bnot answer(?:ing|ed)?\b/i,
  /\btimed? ?out\b|ETIMEDOUT/i,
  /\b(EBUSY|EAGAIN|ECONNRESET|ECONNREFUSED|EPIPE|EMFILE|ENFILE)\b/,
  /socket hang up/i,
  /\bunreachable\b|could not be reached|cannot be reached/i,
  /pty supervisor/i,
  /connection to the Host|no connection to the Host|the Host is (?:busy|restarting|leaving)/i,
  /memory pressure|out of memory/i,
  /network drive/i
]
export const isTransientStartFailure = (reason: string): boolean => TRANSIENT_START.some((re) => re.test(reason))

/** Whether the Task's plan runs hands-off. */
export function handsOffTask(s: OrchState, t: Pick<Task, 'runId'>): boolean {
  const run = t.runId === undefined ? undefined : s.runs.find((r) => r.id === t.runId)
  const job = run && jobOf(s, run)
  return job !== undefined && handsOffOf(s, job)
}

export type StartRetryStep =
  | { kind: 'retry'; retry: NonNullable<Task['startRetry']>; waitMs: number; limit: number }
  | { kind: 'give-up'; tries: number; limit: number }

/** What a hands-off Task's failed start leads to: another start after its backoff, or, its tries spent, a hold. */
export function startRetryStep(t: Pick<Task, 'startRetry'>, reason: string, nowMs: number): StartRetryStep {
  const tries = (t.startRetry?.tries ?? 0) + 1
  const limit = isTransientStartFailure(reason) ? START_RETRY_LIMIT : START_RETRY_LIMIT_OTHER
  if (tries > limit) return { kind: 'give-up', tries: tries - 1, limit }
  const waitMs = START_RETRY_BACKOFF_MS[Math.min(tries, START_RETRY_BACKOFF_MS.length) - 1]
  return { kind: 'retry', retry: { tries, at: new Date(nowMs + waitMs).toISOString(), reason: reason.slice(0, 500) }, waitMs, limit }
}

/** Whether a Task waits out its start backoff now: the loop does not place it before `startRetry.at`. */
export const startRetryWaiting = (t: Pick<Task, 'startRetry'>, nowMs: number): boolean =>
  t.startRetry !== undefined && Date.parse(t.startRetry.at) > nowMs

/** The Task with its start backoff cleared (a start that succeeded); the same object when it had none. */
export const withoutStartRetry = (t: Task): Task => {
  if (t.startRetry === undefined) return t
  const { startRetry: _gone, ...rest } = t
  return rest
}

/** A failed start of a hands-off Task, recorded: its backoff set, or, its tries spent, held (blocked with `reason` as
 *  its result and no Gate, running.ts heldForOwner) so the rest of the plan goes on. The Task as it was otherwise. */
export function recordStartFailure(s: OrchState, taskId: string, reason: string, nowMs: number, now: string): { state: OrchState; step: StartRetryStep } | null {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return null
  const step = startRetryStep(task, reason, nowMs)
  const next: Task =
    step.kind === 'retry'
      ? { ...task, startRetry: step.retry }
      : {
          ...withoutStartRetry(task),
          status: 'blocked',
          result: `Astera could not start its worker ${step.tries} times in a row (the plan runs hands-off, so it was not asked): ${reason.slice(0, 500)}`,
          updatedAt: now
        }
  return { state: { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? next : t)) }, step }
}

const oneLine = (text: string | undefined, max: number): string => (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** What failed, for the next worker's spec: its last result or failure, its blocking review issues, its failed checks. */
export function failureSummaryOf(t: Task): string {
  const issues = (t.reviewIssues ?? []).filter((i) => i.blocking).map((i) => `- ${i.severity.toUpperCase()} ${i.title}`)
  const checks = (t.checks ?? []).filter((c) => c.status === 'failed' || c.status === 'timed-out').map((c) => `- check ${c.name} ${c.status}`)
  const last = oneLine(t.result, 1200) || oneLine(t.lastFailure, 1200)
  return [
    `It failed ${t.consecutiveFailures} times in a row before this fresh attempt.`,
    ...(last ? ['', `Last result: ${last}`] : []),
    ...(issues.length ? ['', 'Blocking review issues:', ...issues] : []),
    ...(checks.length ? ['', 'Failed checks:', ...checks] : [])
  ].join('\n')
}

export type RecoverStep = { kind: 'fresh'; model?: string; effort?: string; why: string } | { kind: 'give-up'; why: string }

/** What a hands-off Task whose circuit breaker tripped gets now: a fresh attempt while it has one left, else given up. */
export function recoverStepOf(t: Task): RecoverStep {
  const used = t.freshAttempt?.n ?? 0
  if (used < FRESH_ATTEMPTS) return { kind: 'fresh', why: `fresh attempt ${used + 1} of ${FRESH_ATTEMPTS} after ${t.consecutiveFailures} failures in a row` }
  return { kind: 'give-up', why: `it failed again after ${used} fresh attempt(s): marked failed, what waits on it cancelled, so the plan finishes` }
}

/** Whether a hands-off Task may be recovered now: tripped (or its lost worker out of retries), nothing on it, not given up. */
function recoverable(s: OrchState, t: Task): string | null {
  if (!handsOffTask(s, t)) return `${t.id} is not in a hands-off plan`
  if (t.handsOffGaveUpAt !== undefined) return `${t.id} was given up on already`
  if (t.status !== 'failed' && t.status !== 'dispatched') return `${t.id} is ${t.status}, not failed or lost`
  if (s.dispatches.some((d) => d.taskId === t.id && !d.outcome && !d.endedAt)) return `${t.id} has a worker on it`
  if (s.gates.some((g) => g.taskId === t.id && g.status === 'open')) return `${t.id} has an open question`
  return null
}

/**
 * Carries out `recoverStepOf` on hands-off Task `taskId`:
 * - `fresh`: back to `ready`, its failure count at 0, its model one rung up from its last attempt's, `freshAttempt`
 *   recorded (worker-start puts its summary in the spec), any start backoff cleared, and the failed-Task question over
 *   it (replan.ts failedWaitQuestion) answered, so nobody waits on it.
 * - `give-up`: `failed` with its count at the limit, `handsOffGaveUpAt` set, and what waits on it cancelled
 *   (resolveFailedWait `cancel`), so the plan reaches its end.
 */
export function recoverHandsOffTask(s: OrchState, taskId: string, now: string): Res<{ task: Task; step: RecoverStep }> {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `unknown task: ${taskId}`, missing: true }
  const no = recoverable(s, task)
  if (no) return { ok: false, error: no }
  const step = recoverStepOf(task)
  const answered = (st: OrchState): OrchState => ({
    ...st,
    messages: st.messages.map((m) => (isFailedWait(m) && m.taskId === taskId && !m.answered ? { ...m, answered: true, answerBody: 'Retry' } : m))
  })
  if (step.kind === 'fresh') {
    const last = latestImplDispatch(s, taskId)
    const rung = last && (last.model || last.effort) ? nextRung({ model: last.model, effort: last.effort }, last.provider) : undefined
    const fresh: Task = {
      ...withoutStartRetry(task),
      status: 'ready',
      consecutiveFailures: 0,
      ...(rung?.model ? { model: rung.model } : {}),
      ...(rung?.effort ? { effort: rung.effort } : {}),
      ...(rung ? { modelReason: `hands-off fresh attempt after ${task.consecutiveFailures} failures: ${rung.reason}` } : {}),
      freshAttempt: { n: (task.freshAttempt?.n ?? 0) + 1, at: now, summary: failureSummaryOf(task) },
      updatedAt: now
    }
    const next = answered({ ...s, tasks: s.tasks.map((t) => (t.id === taskId ? fresh : t)) })
    return { ok: true, state: next, value: { task: fresh, step: { ...step, ...(rung?.model ? { model: rung.model } : {}), ...(rung?.effort ? { effort: rung.effort } : {}) } } }
  }
  const failed: Task = {
    ...withoutStartRetry(task),
    status: 'failed',
    consecutiveFailures: Math.max(task.consecutiveFailures, FAILURE_LIMIT),
    handsOffGaveUpAt: now,
    updatedAt: now
  }
  const marked: OrchState = { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? failed : t)) }
  const cancelled = resolveFailedWait(marked, taskId, 'cancel', now)
  // Nothing could be cancelled (a dependent is under way): the Task is failed and given up all the same
  const next = cancelled.ok ? { ...cancelled.state, tasks: cancelled.state.tasks.map((t) => (t.id === taskId ? { ...t, handsOffGaveUpAt: now } : t)) } : marked
  const value = next.tasks.find((t) => t.id === taskId)!
  return { ok: true, state: next, value: { task: value, step } }
}

/** The spec section a fresh attempt's first worker reads (worker-start `withPreviousAttempt`): undefined once an
 *  implementation attempt started after the fresh attempt was given, or when there was none. */
export function freshAttemptNote(s: OrchState, t: Task): { subject: string; body: string } | undefined {
  const f = t.freshAttempt
  if (!f) return undefined
  const started = s.dispatches.some((d) => d.taskId === t.id && !d.review && d.startedAt > f.at)
  if (started) return undefined
  return { subject: `it failed ${FAILURE_LIMIT}+ times in a row, so this is a fresh attempt (${f.n} of ${FRESH_ATTEMPTS}). Read what failed and do not repeat it`, body: f.summary }
}
