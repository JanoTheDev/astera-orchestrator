// `events-poll` (SDK 1d): one read of the Host's public event log, waiting up to `waitMs` for something new. What
// @astera-app/client's events.list (no wait) and events.subscribe (a window at a time) send. Answered by the Host
// beside `jobs-view` (orch.ts), not by the command layer: it is not a CLI command.
//
// Arguments: `after` (an event id, or a cursor an earlier answer gave; absent: from the oldest event held), `types`
// (a comma list of event types; absent: all), `limit` (1 to 500, 100), `waitMs` (0 to 60000, 0), `tail` (true:
// answer at once with a cursor for what comes next). The answer: `{ events, cursor, gap }`.
//
// **Woken by the log, not by polling it**: the wait is the ring's own, settled by the next append. Events a `types`
// filter skips move the cursor and the wait goes on, so a narrow filter on a busy Host neither answers empty early
// nor reads the skipped events again.
import { EVENT_TYPES } from '../core/publicContract'
import { FOLLOW_WINDOW_MAX_MS } from '../core/orchestration/command'
import type { HostEventLog } from './eventLog'

export const EVENTS_PAGE_DEFAULT = 100
export const EVENTS_PAGE_MAX = 500

type Reply = { status: number; body: unknown }
const bad = (error: string): Reply => ({ status: 400, body: { error } })
const wholeIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** `known`: the log's types, EVENT_TYPES for the public log (W3-A's `activity-poll` passes ACTIVITY_KINDS). */
export async function pollEvents(
  log: Pick<HostEventLog, 'read' | 'tail' | 'next'> | null | undefined,
  args: Record<string, unknown>,
  nowMs: () => number = Date.now,
  known: readonly string[] = EVENT_TYPES
): Promise<Reply> {
  if (!log) return { status: 501, body: { error: 'this Host keeps no public event log; update the Astera app' } }
  if (args.tail === true) return { status: 200, body: { events: [], cursor: log.tail(), gap: false } }
  if (args.after !== undefined && (typeof args.after !== 'string' || args.after === '')) return bad('after is an event id')
  let types: Set<string> | undefined
  if (args.types !== undefined) {
    if (typeof args.types !== 'string' || args.types === '') return bad(`types is a comma list of event types: ${known.join(', ')}`)
    types = new Set(args.types.split(','))
    const unknown = [...types].filter((t) => !known.includes(t))
    if (unknown.length > 0) return bad(`unknown event type: ${unknown.join(', ')} (one of ${known.join(', ')})`)
  }
  if (args.limit !== undefined && !wholeIn(args.limit, 1, EVENTS_PAGE_MAX)) return bad(`limit must be an integer from 1 to ${EVENTS_PAGE_MAX}`)
  if (args.waitMs !== undefined && !wholeIn(args.waitMs, 0, FOLLOW_WINDOW_MAX_MS)) return bad(`waitMs must be an integer from 0 to ${FOLLOW_WINDOW_MAX_MS}`)
  const limit = (args.limit as number | undefined) ?? EVENTS_PAGE_DEFAULT
  const deadline = nowMs() + ((args.waitMs as number | undefined) ?? 0)
  let after = args.after as string | undefined
  for (;;) {
    const page = log.read({ after, types, limit })
    if ('error' in page) return bad(page.error)
    const left = deadline - nowMs()
    if (page.events.length > 0 || page.gap || left <= 0) return { status: 200, body: page }
    after = page.cursor
    await log.next(left)
  }
}
