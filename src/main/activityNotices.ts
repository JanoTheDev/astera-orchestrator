// W3-A: the app's desktop notices from the activity feed (core/orchestration/activity.ts). The Host keeps the feed and
// posts its Slack notices itself (host/activity.ts); the desktop is this process's, so it follows the feed over the
// Host connection (`activity-poll`, long polled) from the moment the app starts, and asks `activity-summary` for each
// digest. Nothing from before the start is announced: the feed itself shows it.
//
// W5-D (#43): and the app's chat connections (Slack, Telegram, through their fan-out), while the app keeps them
// (connectionsOwnership.ts owner 'app'). Then the Host's connections hold nothing and post nothing (host/index.ts
// posts only while `connections.active()`), so each notice reaches each connection from one process. Both sinks
// share this one throttle and digest.
import { createActivityNotices, type ActivityEvent, type ActivityNotice, type ActivitySummary } from '../core/orchestration/activity'

type Call = (cmd: string, args: Record<string, unknown>, timeoutMs?: number) => Promise<{ status: number; body: unknown }>

/** How long one `activity-poll` waits on the Host for something new. */
export const ACTIVITY_WAIT_MS = 25_000
/** A failed read (no Host yet, a Host too old for the feed) is tried again this much later. */
export const ACTIVITY_RETRY_MS = 5_000
export const ACTIVITY_TICK_MS = 60_000

export function startActivityNotices(a: {
  call: Call
  /** The desktop; absent without one. */
  send?(n: ActivityNotice): void
  /** W5-D (#43): the app's chat connections (the field keeps Slack's name). `keeps()` is read per notice, so a hand-over between app and Host takes effect at once. */
  slack?: { keeps(): boolean; post(text: string): void }
  digestMinutes(): number
  log(m: string): void
  nowMs?: () => number
  sleep?: (ms: number) => Promise<void>
}): () => void {
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()))
  const notices = createActivityNotices({
    send: (n) => {
      a.send?.(n)
      if (a.slack?.keeps()) a.slack.post(`*${n.title}*\n${n.body}`)
    },
    summary: async (since) => {
      const r = await a.call('activity-summary', { since })
      return r.status === 200 ? (r.body as ActivitySummary) : null
    },
    digestMs: () => a.digestMinutes() * 60_000,
    nowMs: a.nowMs ?? Date.now
  })
  let stopped = false
  let failing = false
  void (async () => {
    let after: string | undefined
    while (!stopped) {
      try {
        const r = after === undefined ? await a.call('activity-poll', { tail: true }) : await a.call('activity-poll', { after, waitMs: ACTIVITY_WAIT_MS, limit: 500 }, ACTIVITY_WAIT_MS + 10_000)
        if (r.status !== 200) throw new Error(`activity-poll answered ${r.status}`)
        const page = r.body as { events: ActivityEvent[]; cursor: string; gap: boolean }
        // Past a gap the lines are old news (a Host that lost its log): read on without announcing them
        if (after !== undefined && !page.gap) notices.onEvents(page.events)
        after = page.cursor
        failing = false
      } catch (err) {
        if (!failing) a.log(`activity: could not follow the feed, trying again: ${String(err)}`)
        failing = true
        await sleep(ACTIVITY_RETRY_MS)
      }
    }
  })()
  const timer = setInterval(() => {
    notices.tick().catch((err) => a.log(`activity: the digest failed: ${String(err)}`))
  }, ACTIVITY_TICK_MS)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
