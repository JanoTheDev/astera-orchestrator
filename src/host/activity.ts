// W3-A: the Host's activity feed (core/orchestration/activity.ts). Its log is a second createHostEventLog
// (`<profile>/orch/activity.jsonl`), fed by the same commits as the public one (orch.ts recordEvents). Here: its two
// reads, answered beside `events-poll` (orch.ts), and the Host's Slack notices, which follow the log as it grows.
//
// Imports only core modules and this folder: this bundles into the Host.
import {
  ACTIVITY_KINDS,
  awaitsApproval,
  createActivityNotices,
  summarize,
  waitingActivity,
  type ActivityDraft,
  type ActivityEvent,
  type ActivityNotice
} from '../core/orchestration/activity'
import type { EventDraft } from '../core/orchestration/publicEvents'
import { jobNameOf } from '../core/orchestration/jobName'
import { validatePlan } from '../core/orchestration/planner'
import { autoApproveOf, awaitsGo } from '../core/orchestration/exec/plannerFeedback'
import type { ScheduleLimits } from '../core/orchestration/schedule'
import type { OrchState } from '../core/orchestration/state'
import type { HostEventLog } from './eventLog'
import { pollEvents } from './eventsPoll'

export const ACTIVITY_COMMANDS: ReadonlySet<string> = new Set(['activity-poll', 'activity-summary'])
/** "What finished in the last 15 minutes": the window `activity-summary` reads when it is given no `since`. */
export const ACTIVITY_SUMMARY_DEFAULT_MS = 15 * 60_000
/** How often the notices look at the digest's clock. */
export const ACTIVITY_TICK_MS = 60_000

type Reply = { status: number; body: unknown }
type ActivityLog = Pick<HostEventLog, 'read' | 'tail' | 'next'>

/**
 * #48: the plan whose planner `sessionId` just ended a turn, as a `plan.awaiting-approval` line, when it awaits approval
 * and holds together (`validatePlan`: Tasks present, each with a prompt and a criterion, no unknown or cyclic dep).
 * null otherwise, and null when `held` already has the line for this planner session: one line per plan, however many
 * turns its planner ends. A new planner (`jobs plan` again) is a new plan and gets its own line.
 */
export function planReadyActivity(s: OrchState, sessionId: string, held: () => readonly ActivityEvent[]): ActivityDraft | null {
  const j = s.jobs.find((x) => x.plannerSessionIds?.includes(sessionId))
  // T10: a plan planned together with the owner is not ready at a turn's end: it waits for their go (its planner's
  // `jobs-plan-ready`, or Start)
  if (!j || !awaitsApproval(j) || awaitsGo(s, j) || validatePlan(s, j.id).length > 0) return null
  // W7-A: each round of the owner's feedback makes the plan ready again, once, with what the planner changed for it
  const rounds = (j.feedback ?? []).filter((f) => f.phase === 'plan')
  const round = rounds.length
  if (held().some((e) => e.type === 'plan.awaiting-approval' && e.jobId === j.id && e.sessionId === sessionId && (e.payload.round ?? 0) === round)) return null
  const changes = rounds.at(-1)?.changes
  return {
    type: 'plan.awaiting-approval',
    ...(j.projectId !== undefined ? { projectId: j.projectId } : {}),
    jobId: j.id,
    sessionId,
    payload: { title: jobNameOf(j), plan: jobNameOf(j), ...(round > 0 ? { round, ...(changes ? { changes } : {}) } : {}) }
  }
}

/**
 * W8-F (#94): the planner's turn ended on a feedback round it reported done (`jobs-feedback-done`), and the plan still
 * does not hold: a `plan.incomplete` line with what is missing, once per round. `planReadyActivity` says nothing then.
 */
export function planIncompleteActivity(s: OrchState, sessionId: string, held: () => readonly ActivityEvent[]): ActivityDraft | null {
  const j = s.jobs.find((x) => x.plannerSessionIds?.includes(sessionId))
  if (!j || !awaitsApproval(j)) return null
  const rounds = (j.feedback ?? []).filter((f) => f.phase === 'plan')
  if (rounds.length === 0 || rounds.at(-1)!.changes === undefined) return null
  const problems = validatePlan(s, j.id)
  if (problems.length === 0) return null
  if (held().some((e) => e.type === 'plan.incomplete' && e.jobId === j.id && e.sessionId === sessionId && e.payload.round === rounds.length)) return null
  return {
    type: 'plan.incomplete',
    ...(j.projectId !== undefined ? { projectId: j.projectId } : {}),
    jobId: j.id,
    sessionId,
    payload: { title: jobNameOf(j), plan: jobNameOf(j), round: rounds.length, problems: problems.slice(0, 5) }
  }
}

/**
 * W5-D: the activity lines a session's hook events make, which no commit does. Fed every hook event of the profile
 * (the rolling's hook tap) and every session event the Host records (sessionEvents.ts); records into the activity log.
 * - #48: a planner's turn ending (`Stop`) on a plan that holds is the plan ready for approval (planReadyActivity).
 * - #42: a worker's turn into waiting at a permission prompt or a question (`session.input_needed`, whose attention
 *   rule already makes it once per wait) is `task.waiting` with that reason (waitingActivity). A turn that just ended
 *   (`prompt: null`) is no line: the worker's report or its Task's move says what happened.
 * Never throws: a failure is reported and the next event goes on.
 */
export function hostSessionActivity(a: {
  log: ActivityLog & Pick<HostEventLog, 'recorded'>
  state: () => OrchState
  report(message: string): void
  /** W7-A: starts a plan that holds with no approval step (`jobs-auto-start`); resolves whether it started. */
  autoStart?(jobId: string): Promise<boolean>
  /** #116: records on the Job that its plan waits on the owner (`jobs-plan-ready`, Job.planReadyAt). */
  markReady?(jobId: string): Promise<void>
}): { onHookEvent(sessionId: string, payload: unknown): void; onSessionEvents(drafts: readonly EventDraft[]): void } {
  const record = (draft: ActivityDraft | null): void => {
    if (draft) a.log.recorded([draft])
  }
  // #116: the plan waits on the owner, in the feed (the notice; recorded at once, so the next turn's end sees it held)
  // and on the Job (the app's Approve)
  const ready = (draft: ActivityDraft & { jobId: string }): void => {
    record(draft)
    void a.markReady?.(draft.jobId).catch((why: unknown) => a.report(`activity: plan ${draft.jobId} could not be marked ready: ${String(why)}`))
  }
  const guard = (fn: () => void): void => {
    try {
      fn()
    } catch (err) {
      a.report(`activity: a session's line could not be recorded: ${String(err)}`)
    }
  }
  return {
    onHookEvent: (sessionId, payload) =>
      guard(() => {
        if ((payload as { hook_event_name?: unknown } | null)?.hook_event_name !== 'Stop') return
        // `held` is read only for a planner's turn end, not every session's
        const line = planReadyActivity(a.state(), sessionId, () => activityOf(a.log))
        const job = line?.jobId === undefined ? undefined : a.state().jobs.find((j) => j.id === line.jobId)
        // W7-A: auto-approve replaces the approval step; a start that does not go through asks for approval after all
        // (#116: only then is the plan marked ready, so an auto-approve plan never shows Approve while it starts)
        if (line && job && a.autoStart && autoApproveOf(a.state(), job)) {
          const fallBack = (why?: unknown): void =>
            guard(() => {
              if (why !== undefined) a.report(`activity: plan ${job.id} could not start on its own: ${String(why)}`)
              ready({ ...line, jobId: job.id })
            })
          void a.autoStart(job.id).then((started) => (started ? undefined : fallBack()), fallBack)
        } else if (line && job) ready({ ...line, jobId: job.id })
        else record(planIncompleteActivity(a.state(), sessionId, () => activityOf(a.log)))
      }),
    onSessionEvents: (drafts) =>
      guard(() => {
        for (const d of drafts) {
          const prompt = (d.payload as { prompt?: unknown }).prompt
          if (d.type !== 'session.input_needed' || d.sessionId === undefined || (prompt !== 'permission' && prompt !== 'question')) continue
          record(waitingActivity(a.state(), d.sessionId, prompt))
        }
      })
  }
}

/** Every line the log holds, oldest first. */
export const activityOf = (log: ActivityLog): ActivityEvent[] => {
  const page = log.read({ limit: Number.MAX_SAFE_INTEGER })
  return 'error' in page ? [] : (page.events as unknown as ActivityEvent[])
}

/**
 * `activity-poll`: `events-poll`'s arguments and answer, over the activity log. `activity-summary`: `summarize` of the
 * lines since `since` (ISO; default the last 15 minutes), with what is blocked now and why.
 */
export async function activityReply(
  log: ActivityLog | null | undefined,
  cmd: string,
  args: Record<string, unknown>,
  state: () => OrchState,
  limits: () => Promise<ScheduleLimits>,
  nowMs: () => number = Date.now
): Promise<Reply> {
  if (!log) return { status: 501, body: { error: 'this Host keeps no activity feed; update the Astera app' } }
  if (cmd === 'activity-poll') return pollEvents(log, args, nowMs, ACTIVITY_KINDS)
  const since = args.since ?? new Date(nowMs() - ACTIVITY_SUMMARY_DEFAULT_MS).toISOString()
  if (typeof since !== 'string' || Number.isNaN(Date.parse(since))) return { status: 400, body: { error: 'since is an ISO time' } }
  return { status: 200, body: summarize(activityOf(log), new Date(since).toISOString(), state(), await limits()) }
}

/**
 * The Host's notices: every line from now on, through the throttle, to `send` (the Host's Slack, while it holds it),
 * and a digest every `digestMs()`. Returns the stop. Never throws: a failed send is the sink's to log.
 */
export function followActivity(a: {
  log: ActivityLog
  send(n: ActivityNotice): void
  state: () => OrchState
  limits: () => Promise<ScheduleLimits>
  digestMs: () => Promise<number>
  report(message: string): void
  nowMs?: () => number
  tickMs?: number
}): () => void {
  const nowMs = a.nowMs ?? Date.now
  const notices = createActivityNotices({
    send: a.send,
    summary: async (since) => summarize(activityOf(a.log), since, a.state(), await a.limits()),
    digestMs: a.digestMs,
    nowMs
  })
  let stopped = false
  let after = a.log.tail()
  void (async () => {
    while (!stopped) {
      try {
        const page = a.log.read({ after, limit: 500 })
        if ('error' in page) after = a.log.tail()
        else {
          after = page.cursor
          notices.onEvents(page.events as unknown as ActivityEvent[])
          if (page.events.length > 0) continue
        }
      } catch (err) {
        a.report(`activity: could not read the feed: ${String(err)}`)
      }
      await a.log.next(a.tickMs ?? ACTIVITY_TICK_MS)
    }
  })()
  const timer = setInterval(() => {
    notices.tick().catch((err) => a.report(`activity: the digest failed: ${String(err)}`))
  }, a.tickMs ?? ACTIVITY_TICK_MS)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
