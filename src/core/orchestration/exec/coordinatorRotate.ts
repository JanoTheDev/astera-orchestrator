// Coordinator rotation and finished-tab release (the owner's decisions of 2026-10-18).
//
// - **A coordinator is replaced by a fresh session** (same account, same role model) at every wave boundary and when
//   its statusLine context reading passes the "Fresh coordinator at context (%)" setting. A long conversation forgets
//   the start of the plan; a fresh one briefed from the state does not. The new session is started and put in the
//   slot first, and only then is the old one ended (`refreshCoordinator`, the body of `run-coordinator-refresh`). The
//   brief is written from the state, never from the old conversation (`coordinatorHandoff`).
// - **A finished worker's session ends while the plan still runs**: a Task completed (merged or not: the worktree stays),
//   or a review whose verdict is recorded (`sessionsDoneWith`, finishedSessions.ts). The renderer closes the exited tab by the same rule
//   (lib/tabAutoClose.ts). A failed Task, a Task with an open Gate, and a session the owner typed into in the last 10 minutes keep theirs.
// - **A worker tab never reads "Coordinator ·"**: it carries its Task's ref first (`workerTabTitle`).
//
// The driving loop calls `createCoordinatorRotation` from its tidy-up pass (dispatchLoop.ts); everything goes through
// the command layer, like every other thing that loop does, and a failure is logged and never thrown (R14).
import { buildHandoverPrompt } from '../handover'
import { policyOf } from '../convergence'
import { runWaves, wavesDoneOf } from '../draftPr'
import { isIntegrationTask } from '../integrate'
import { sessionsDoneWith } from '../finishedSessions'
import { attachCoordinator, coordinatorStarting, jobOf, OWNER_ANSWER_SUBJECT, type OrchState } from '../state'
import { DEFAULT_CONCURRENCY, isPlaceholderSessionId, type JobRun } from '../types'
import { outcomeOf } from '../view'
import type { OrchServerDeps } from '../command'
import { handsOffOf } from './plannerFeedback'
import { projectOfJob } from '../projects'

/** How many refreshes a Run keeps on record (its feed lines and the retired tabs the renderer closes). */
export const COORDINATOR_REFRESHES_KEPT = 20
/** A refresh that was refused or failed is asked again no sooner than this. */
export const COORDINATOR_REFRESH_RETRY_MS = 60_000
/** A finished worker whose release did not take is asked again this much later, up to this many times. */
export const FINISHED_RELEASE_RETRY_MS = 60_000
export const FINISHED_RELEASE_TRIES = 6
/** Person input keeps a finished session open only this long. */
export const PERSON_INPUT_KEEPS_MS = 10 * 60_000

// ── Tab titles ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** A Task's short ref in its Run: `T<n>`, n its 1-based place among the Run's Tasks as they were made. */
export function taskRefOf(s: Pick<OrchState, 'tasks'>, taskId: string): string | undefined {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task?.runId) return undefined
  const i = s.tasks.filter((t) => t.runId === task.runId).findIndex((t) => t.id === taskId)
  return i < 0 ? undefined : `T${i + 1}`
}

/** A worker's or reviewer's tab title: the Task ref first, so the one real coordinator tab is the only one that starts
 *  with "Coordinator" (a Task titled "Coordinator push…" used to look like one). */
export function workerTabTitle(s: Pick<OrchState, 'tasks'>, taskId: string, title: string): string {
  return `${taskRefOf(s, taskId) ?? 'Task'} · ${title}`
}

// ── What a fresh coordinator is told ────────────────────────────────────────────────────────────────────────────────

/** command.ts's PENDING_START_WINDOW_MS, by value: command.ts imports this file. Past it a placeholder is a dead start. */
const START_WINDOW_MS = 2 * 60_000

/** A worker-start of this Run is under way: its Dispatch still holds the `pending:` placeholder, inside the window. */
export const workerStartInFlight = (s: OrchState, runId: string, nowMs: number): boolean => {
  const mine = new Set(s.tasks.filter((t) => t.runId === runId).map((t) => t.id))
  return s.dispatches.some(
    (d) => mine.has(d.taskId) && d.endedAt === undefined && isPlaceholderSessionId(d.sessionId) && nowMs - Date.parse(d.startedAt) < START_WINDOW_MS
  )
}

const oneLine = (x: string, max = 200): string => {
  const flat = x.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * The hand-off section of a fresh coordinator's brief, after `buildHandoverPrompt`'s: the plan and every Task's
 * status, the open Gates and the answered ones, the Dispatches in flight, the owner's messages so far (the last 20),
 * and the last wave's merge. All of it read from the state, so nothing the old conversation got wrong carries over.
 */
export function coordinatorHandoff(s: OrchState, runId: string, reason: string): string {
  const run = s.runs.find((r) => r.id === runId)
  const job = run && jobOf(s, run)
  const tasks = s.tasks.filter((t) => t.runId === runId)
  const ref = new Map(tasks.map((t, i) => [t.id, `T${i + 1}`]))
  const name = (taskId: string): string => `${ref.get(taskId) ?? '?'} ${taskId}`
  const waves = runWaves(s, runId)
  const waveOfTask = new Map(waves.flatMap((w) => w.tasks.map((t) => [t.id, w.wave] as const)))
  const gates = s.gates.filter((g) => g.runId === runId)
  const open = gates.filter((g) => g.status === 'open')
  const answered = gates.filter((g) => g.status === 'resolved').slice(-10)
  const mine = new Set(tasks.map((t) => t.id))
  const inFlight = s.dispatches.filter((d) => mine.has(d.taskId) && d.endedAt === undefined && d.outcome === undefined)
  const owner = [
    ...(job?.feedback ?? []).map((f) => ({ at: f.at, text: f.text })),
    ...s.messages.filter((m) => m.runId === runId && m.subject === OWNER_ANSWER_SUBJECT).map((m) => ({ at: m.createdAt, text: m.body }))
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-20)
  const done = wavesDoneOf(waves)
  const lastWave = done > 0 ? waves[done - 1] : undefined
  const merges = tasks.filter(isIntegrationTask)
  const none = (xs: readonly unknown[], line: string): string[] => (xs.length === 0 ? [`- ${line}`] : [])
  return [
    'YOU REPLACE A COORDINATOR',
    `The coordinator before you was ended (${reason}) and its conversation is gone: Astera starts a fresh coordinator`,
    'at every wave boundary and when one has used most of its context. What it knew is below, read from the state;',
    'trust it over anything you remember. Do not redo completed work. Then take stock as above and keep calling',
    '`astera check --wait --json`: mail it left unacknowledged comes to you.',
    '',
    'THE PLAN NOW',
    `- objective: ${oneLine(job?.objective ?? '', 400)}`,
    `- waves done: ${done} of ${waves.length}`,
    ...tasks.map((t) => `- ${name(t.id)} [${t.status}] wave ${waveOfTask.get(t.id) ?? '?'}: ${oneLine(t.title, 120)}${t.deps.length ? ` (after ${t.deps.map((d) => ref.get(d) ?? d).join(', ')})` : ''}`),
    ...none(tasks, 'no Task yet'),
    '',
    'OPEN GATES (a person answers these; do not start their Tasks)',
    ...open.map((g) => `- ${g.id} on ${name(g.taskId)}: ${oneLine(g.question)}`),
    ...none(open, 'none'),
    '',
    'ANSWERED GATES (latest 10)',
    ...answered.map((g) => `- ${g.id} on ${name(g.taskId)}: ${oneLine(g.question, 120)} -> ${oneLine(g.resolution ?? '(no answer text)', 160)}`),
    ...none(answered, 'none'),
    '',
    'DISPATCHES IN FLIGHT (leave them alone and wait for their reports)',
    ...inFlight.map((d) => `- ${d.id} for ${name(d.taskId)}${d.review ? ' (review)' : ''}: ${d.workerState}, since ${d.startedAt}`),
    ...none(inFlight, 'none'),
    '',
    "THE OWNER'S MESSAGES (last 20, oldest first)",
    ...owner.map((m) => `- ${m.at}: ${oneLine(m.text, 300)}`),
    ...none(owner, 'none'),
    '',
    "THE LAST WAVE'S MERGE",
    lastWave
      ? `- wave ${lastWave.wave} is done: ${lastWave.tasks.map((t) => ref.get(t.id) ?? t.id).join(', ')}`
      : '- no wave is done yet',
    ...merges.map((t) => `- merge ${name(t.id)} [${t.status}]${t.result ? `: ${oneLine(t.result)}` : ''}`),
    ...(job?.lastReplan?.runId === runId ? [`- replan before wave ${job.lastReplan.wave}: ${oneLine(job.lastReplan.summary)}${job.lastReplan.escalated ? ` (handed to the owner: ${oneLine(job.lastReplan.escalated)})` : ''}`] : []),
    ...(run?.pr?.url ? [`- pull request: ${run.pr.url}${run.pr.draft ? ' (draft)' : ''}`] : [])
  ].join('\n')
}

// ── The refresh itself (`run-coordinator-refresh`) ──────────────────────────────────────────────────────────────────

type Reply = { status: number; body: unknown }
const no = (status: number, error: string): Reply => ({ status, body: { error } })

/** Why a refresh is due, in the words the feed shows in its parentheses. */
export const refreshReason = (a: { wave?: number; contextPct?: number; reason?: string }): string =>
  a.wave !== undefined ? `wave ${a.wave}` : a.contextPct !== undefined ? `context ${Math.round(a.contextPct)}%` : (a.reason ?? 'on request')

/**
 * **Replaces a Run's coordinator with a fresh session** (the body of `run-coordinator-refresh`). The new session is
 * started on the Job's coordinator account (its model resolved as at any start: `resolveCoordinatorModel`) with the hand-over
 * brief and `coordinatorHandoff`, put in the slot, and only then is the old one asked to stop. Its exit release finds
 * no slot naming it, so nothing else moves. Refused (409) while a coordinator or worker start is under way, while a
 * stop is pending, and for a Run with no coordinator or not running. A slot that moved during the start keeps its
 * coordinator, and the session this call started is stopped.
 */
export async function refreshCoordinator(
  deps: OrchServerDeps,
  a: { runId: string; wave?: number; contextPct?: number; reason?: string; now: string }
): Promise<Reply> {
  const s = deps.getState()
  const run = s.runs.find((r) => r.id === a.runId)
  if (!run) return no(404, `unknown run: ${a.runId}`)
  const job = jobOf(s, run)
  const old = run.coordinatorSessionId
  if (old === undefined) return no(409, `run ${a.runId} has no coordinator to refresh`)
  if (!job?.coordinatorAccountId || !deps.startCoordinator) return no(409, `run ${a.runId}'s coordinator cannot be restarted here`)
  if (outcomeOf(s, run.id) !== 'running' || run.paused === true) return no(409, `run ${a.runId} is not running`)
  if (coordinatorStarting(run, Date.parse(a.now)) || run.coordinatorStopPending !== undefined)
    return no(409, `run ${a.runId}'s coordinator is starting or stopping`)
  if (workerStartInFlight(s, run.id, Date.parse(a.now))) return no(409, `run ${a.runId} has a worker-start in flight; refresh after it`)
  const reason = refreshReason(a)
  const tasks = s.tasks.filter((t) => t.runId === run.id)
  const brief = [
    buildHandoverPrompt({
      runId: run.id,
      objective: job.objective,
      concurrency: job.concurrency ?? DEFAULT_CONCURRENCY,
      taskCount: tasks.length,
      convergence: policyOf(s, { runId: run.id }) !== null,
      jobId: job.id,
      accountId: job.coordinatorAccountId,
      promptsMode: job.verbatim !== undefined,
      handsOff: handsOffOf(s, job),
      grants: projectOfJob(s, job)?.grants
    }),
    '',
    coordinatorHandoff(s, run.id, reason)
  ].join('\n')
  let fresh: string
  let model: string | undefined
  try {
    // T5: the start resolves the model from the plan (roleModels.ts `resolveCoordinatorModel`), as any start does
    const started = await deps.startCoordinator({ runId: run.id, cwd: job.cwd, accountId: job.coordinatorAccountId, brief })
    fresh = started.sessionId
    model = started.model
  } catch (e) {
    return no(500, `could not start a fresh coordinator: ${String(e)}`)
  }
  const current = deps.getState()
  const now = current.runs.find((r) => r.id === run.id)
  if (!now || now.coordinatorSessionId !== old) {
    deps.log?.(`run ${run.id}: its coordinator slot moved while a fresh one started; stopping ${fresh}`)
    await deps.stopCoordinator?.(fresh, 'its run got another coordinator meanwhile', 'replaced').catch(() => {})
    return no(409, `run ${run.id}'s coordinator changed while the fresh one started`)
  }
  const attached = attachCoordinator(current, { runId: run.id, sessionId: fresh, ...(model ? { model } : {}) })
  if (!attached.ok) return no(409, attached.error)
  const entry = {
    at: a.now,
    reason,
    from: old,
    to: fresh,
    ...(a.wave !== undefined ? { wave: a.wave } : {}),
    ...(a.contextPct !== undefined ? { contextPct: Math.round(a.contextPct) } : {})
  }
  await deps.setState({
    ...attached.state,
    runs: attached.state.runs.map((r) =>
      r.id === run.id ? { ...r, coordinatorRefreshes: [...(r.coordinatorRefreshes ?? []), entry].slice(-COORDINATOR_REFRESHES_KEPT) } : r
    )
  })
  // Only now: the Run is never without a coordinator in its slot.
  try {
    await deps.stopCoordinator?.(old, `replaced by a fresh coordinator (${reason})`, 'replaced')
  } catch (e) {
    deps.log?.(`run ${run.id}: the replaced coordinator ${old} could not be stopped: ${String(e)}`)
  }
  deps.log?.(`run ${run.id}: coordinator refreshed (${reason}): ${old} -> ${fresh}`)
  return { status: 200, body: { runId: run.id, from: old, to: fresh, reason } }
}

/** **The on-demand refresh** a watchdog (a stalled coordinator, say) calls: through the command layer, as the driving
 *  loop's own refreshes are. Never throws; the answer says what happened. */
export async function refreshRunCoordinator(
  c: { handle(cmd: string, args: Record<string, unknown>): Promise<Reply> },
  runId: string,
  reason: string
): Promise<Reply> {
  try {
    return await c.handle('run-coordinator-refresh', { run: runId, reason })
  } catch (e) {
    return no(500, String(e))
  }
}

/** The 1-based wave a Run's coordinator should be fresh for, or null: a wave is done, one remains, and no refresh was
 *  made for this wave yet. Waits for a replan at that boundary, so the fresh brief has the replanned plan. */
export function waveRefreshDue(s: OrchState, run: JobRun): number | null {
  const job = jobOf(s, run)
  if (!job || job.replanning) return null
  const waves = runWaves(s, run.id)
  const done = wavesDoneOf(waves)
  if (done < 1 || done >= waves.length) return null
  const next = waves[done].wave
  const last = (run.coordinatorRefreshes ?? []).reduce((m, x) => Math.max(m, x.wave ?? 0), 0)
  return last >= next ? null : next
}

// ── The loop's two passes ───────────────────────────────────────────────────────────────────────────────────────────

export interface RotationContext {
  handle(cmd: string, args: Record<string, unknown>): Promise<Reply>
  getState(): OrchState
  sessionAlive(sessionId: string): boolean
  lastPersonInputAt?(sessionId: string): number | null
  /** A feed line no commit makes (a release that gave up). Optional: without it a log line only. */
  activity?(runId: string, taskId: string, reason: string): void
  /** The session's statusLine context reading, 0-100, or null when it has none (a codex session). */
  sessionContextPct?(sessionId: string): number | null | Promise<number | null>
  /** The "Fresh coordinator at context (%)" setting; 0 turns the context refresh off. */
  freshCoordinatorPct?(): number | Promise<number>
  mayStart(): boolean
  log(m: string): void
  nowMs(): number
}

export function createCoordinatorRotation(c: RotationContext): { rotate(): Promise<void>; releaseFinished(): Promise<void> } {
  /** When each Run's refresh may be asked again, after one was refused or failed. In memory: a restart asks again. */
  const refreshAt = new Map<string, number>()
  /** Release tries of a finished session, by Dispatch id. */
  const released = new Map<string, { tries: number; nextAt: number }>()

  const rotate = async (): Promise<void> => {
    for (const run of c.getState().runs) {
      const s = c.getState()
      const sessionId = run.coordinatorSessionId
      const job = jobOf(s, run)
      if (sessionId === undefined || !job?.coordinatorAccountId || run.paused || run.coordinatorStopPending !== undefined) continue
      if (coordinatorStarting(run, c.nowMs()) || outcomeOf(s, run.id) !== 'running' || workerStartInFlight(s, run.id, c.nowMs())) continue
      if ((refreshAt.get(run.id) ?? 0) > c.nowMs()) continue
      const wave = waveRefreshDue(s, run)
      let args: Record<string, unknown> | null = wave !== null ? { run: run.id, wave } : null
      if (!args && c.sessionContextPct) {
        const threshold = (await c.freshCoordinatorPct?.()) ?? 0
        const pct = threshold > 0 ? await c.sessionContextPct(sessionId) : null
        if (pct !== null && pct >= threshold) args = { run: run.id, contextPct: pct }
      }
      if (!args) continue
      if (!c.mayStart()) return
      try {
        const r = await c.handle('run-coordinator-refresh', args)
        if (r.status >= 400) {
          refreshAt.set(run.id, c.nowMs() + COORDINATOR_REFRESH_RETRY_MS)
          c.log(`run=${run.id}: its coordinator was not refreshed: ${JSON.stringify(r.body)}`)
        } else refreshAt.delete(run.id)
      } catch (e) {
        refreshAt.set(run.id, c.nowMs() + COORDINATOR_REFRESH_RETRY_MS)
        c.log(`run=${run.id}: refreshing its coordinator failed: ${String(e)}`)
      }
    }
  }

  const releaseFinished = async (): Promise<void> => {
    const s = c.getState()
    for (const d of sessionsDoneWith(s)) {
      const runId = s.tasks.find((t) => t.id === d.taskId)?.runId
      // A finished Run's workers are releaseIdleWorkers', under the coordinator's grace
      if (runId === undefined || outcomeOf(s, runId) !== 'running') continue
      if (!c.sessionAlive(d.sessionId)) continue
      const typedAt = c.lastPersonInputAt?.(d.sessionId) ?? null
      if (typedAt !== null && c.nowMs() - typedAt < PERSON_INPUT_KEEPS_MS) continue
      const tried = released.get(d.id)
      if (tried && (tried.tries >= FINISHED_RELEASE_TRIES || tried.nextAt > c.nowMs())) continue
      if (!c.mayStart()) return
      const tries = (tried?.tries ?? 0) + 1
      released.set(d.id, { tries, nextAt: c.nowMs() + FINISHED_RELEASE_RETRY_MS })
      const what = `run=${runId}: the finished ${d.review ? 'reviewer' : 'worker'} ${d.sessionId} (dispatch ${d.id})`
      let failure: string | null = null
      try {
        const r = await c.handle('worker-release', { dispatch: d.id })
        if (r.status >= 400) failure = `was not released: ${JSON.stringify(r.body)}`
        else c.log(`${what} was released`)
      } catch (e) {
        failure = `could not be released: ${String(e)}`
      }
      if (failure === null) continue
      c.log(`${what} ${failure}`)
      if (tries >= FINISHED_RELEASE_TRIES) c.activity?.(runId, d.taskId, `Could not close console ${d.sessionId}`)
    }
  }

  return { rotate, releaseFinished }
}
