// W3-A: the Host's activity feed (core/orchestration/activity.ts). Its log is a second createHostEventLog
// (`<profile>/orch/activity.jsonl`), fed by the same commits as the public one (orch.ts recordEvents). Here: its two
// reads, answered beside `events-poll` (orch.ts), and the Host's Slack notices, which follow the log as it grows.
//
// Imports only core modules and this folder: this bundles into the Host.
import { ACTIVITY_KINDS, createActivityNotices, summarize, type ActivityEvent, type ActivityNotice } from '../core/orchestration/activity'
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
