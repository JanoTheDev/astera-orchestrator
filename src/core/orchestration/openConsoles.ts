// The consoles a plan has open, each with the reason it is kept (T13): no console stays open without one. A reason
// of `none` is a console nothing needs: the driving loop closes it (exec/coordinatorRotate.ts), and the plan view
// shows the count and the reasons (jobs-view). Pure and web-safe: the caller says which sessions are alive and what
// a person typed into.
import { lastAttemptByTask, supersededAttempt } from './finishedSessions'
import { outcomeOf, tasksOwnedBy } from './running'
import type { OrchState } from './state'
import { isPlaceholderSessionId, type Dispatch, type Job, type JobRun, type Task } from './types'

/** Person input keeps a finished session open only this long. */
export const PERSON_INPUT_KEEPS_MS = 10 * 60_000
/** A failed Task's console stays this long after its attempt ended, for the coordinator's retry (or a person's). */
export const AWAITING_RETRY_MS = 15 * 60_000

export type ConsoleRole = 'worker' | 'reviewer' | 'merge' | 'coordinator' | 'planner'
export type ConsoleReason =
  | 'working'
  | 'reviewing'
  | 'waiting-for-answer'
  | 'retained'
  | 'person-typed'
  | 'awaiting-retry'
  | 'closing'
  | 'none'

export interface OpenConsole {
  sessionId: string
  /** The Dispatch that owns the session (workers and reviewers): what `worker-release` closes it by. */
  dispatchId?: string
  taskId?: string
  role: ConsoleRole
  reason: ConsoleReason
}

export interface ConsoleFacts {
  /** When a person last typed into the session (ms), or null. Absent: nobody is known to have. */
  typedAt?(sessionId: string): number | null
  /** A release of the session is under way. */
  closing?(sessionId: string): boolean
  nowMs?: number
}

type ConsoleState = Pick<OrchState, 'runs' | 'jobs' | 'tasks' | 'dispatches' | 'gates'>

/** What one Run's consoles are read from. The Jobs view folds many Runs after every commit and hands in the lists it has
 *  already grouped (view.ts foldIndex), so this reads no whole-state list. */
export interface ConsoleInput {
  run: JobRun
  job: Job | undefined
  /** The Run's Tasks, and the Dispatches of those Tasks in the order they were opened. */
  tasks: readonly Task[]
  dispatches: readonly Dispatch[]
  hasOpenGate(taskId: string): boolean
  running: boolean
}

/** The live consoles of a Run, each with why it is kept. `live` says whether a session is alive. */
export function consolesIn(i: ConsoleInput, live: (sessionId: string) => boolean, facts: ConsoleFacts = {}): OpenConsole[] {
  const nowMs = facts.nowMs ?? Date.now()
  const tasks = new Map(i.tasks.map((t) => [t.id, t]))
  const latest = new Map<string, string>()
  for (const d of i.dispatches) latest.set(d.sessionId, d.id)
  const last = lastAttemptByTask(i.dispatches)
  const out: OpenConsole[] = []

  for (const d of i.dispatches) {
    const t = tasks.get(d.taskId)
    if (!t || latest.get(d.sessionId) !== d.id || isPlaceholderSessionId(d.sessionId) || !live(d.sessionId)) continue
    const open = !d.outcome && !d.endedAt
    const typed = facts.typedAt?.(d.sessionId) ?? null
    let reason: ConsoleReason = 'none'
    if (facts.closing?.(d.sessionId)) reason = 'closing'
    else if (d.retained) reason = 'retained'
    else if (typed !== null && nowMs - typed < PERSON_INPUT_KEEPS_MS) reason = 'person-typed'
    else if (i.hasOpenGate(t.id)) reason = 'waiting-for-answer'
    else if (open) reason = d.review ? 'reviewing' : 'working'
    else if (d.review || supersededAttempt(d, last)) reason = 'none'
    else if (t.status === 'dispatched') reason = 'working'
    else if (t.status === 'validating' || t.status === 'reviewing') reason = 'reviewing'
    else if (t.status === 'failed' && d.endedAt !== undefined && nowMs - Date.parse(d.endedAt) < AWAITING_RETRY_MS) reason = 'awaiting-retry'
    // shortcut: a Task with a parent is the app's merge Task (integrate.ts isIntegrationTask, not web-safe to import)
    const role: ConsoleRole = d.review ? 'reviewer' : t.parentId ? 'merge' : 'worker'
    out.push({ sessionId: d.sessionId, dispatchId: d.id, taskId: t.id, role, reason })
  }

  const coordinator = i.run.coordinatorSessionId
  if (coordinator !== undefined && live(coordinator)) out.push({ sessionId: coordinator, role: 'coordinator', reason: i.running ? 'working' : 'none' })
  const planner = i.job?.plannerSessionIds?.at(-1)
  if (i.job && planner !== undefined && live(planner))
    out.push({ sessionId: planner, role: 'planner', reason: i.job.pendingStart || i.job.replanning ? 'working' : 'none' })
  return out
}

/** `consolesIn` for a Run of a whole state (the driving loop, which asks about few Runs). */
export function openConsolesOf(s: ConsoleState, runId: string, live: (sessionId: string) => boolean, facts: ConsoleFacts = {}): OpenConsole[] {
  const run = s.runs.find((r) => r.id === runId)
  if (!run) return []
  const tasks = tasksOwnedBy(s as OrchState, runId)
  const ids = new Set(tasks.map((x) => x.id))
  const gated = new Set(s.gates.filter((g) => g.status === 'open').map((g) => g.taskId))
  return consolesIn(
    {
      run,
      job: s.jobs.find((j) => j.id === run.jobId),
      tasks,
      dispatches: s.dispatches.filter((d) => ids.has(d.taskId)),
      hasOpenGate: (id) => gated.has(id),
      running: outcomeOf(s as OrchState, runId) === 'running'
    },
    live,
    facts
  )
}
