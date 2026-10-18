// W6-G: no new worker starts on an account that is nearly spent (orchestrator PLAN.md, Wave 6, "Usage pause").
//
// The rule: a Dispatch does not start on an account whose latest statusLine reading has its 5-hour or 7-day
// `used_percentage` at or over `usagePauseAt` (app setting, default 90), until that window's `resets_at` passes or a
// fresh reading is under the threshold. When the Task's account chain (the one rolling moves along, Task.accountIds
// in order, accountToDispatchOn) has another account under the threshold, it starts on that one instead. No reading
// yet means no block. Running workers are never stopped: this is asked before a start, nothing else.
//
// Pure, apart from `createUsageGuard`, which only remembers the last answer per account so a pause and its end can
// each be told once (`usage.paused` / `usage.resumed`).
import type { RateLimitWindow, UsagePause } from '../types'

export const USAGE_PAUSE_AT_DEFAULT = 90

/** The app setting `usagePauseAt` as every reader narrows it: a whole percent from 1 to 100, else 90. */
export function usagePauseAtOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100 ? value : USAGE_PAUSE_AT_DEFAULT
}

/** An account's latest statusLine windows (SessionUsage's `session` is the 5-hour one, `weekly` the 7-day one). */
export interface AccountReading {
  session: RateLimitWindow | null
  weekly: RateLimitWindow | null
}

/** Why no new worker may start on this account now, or null when one may. A window whose reset has passed no longer
 *  counts, whatever it read. A window with no readable reset time does not block either: an idle account sends no
 *  fresh reading, so such a pause could never end (unknown usage does not block). With both windows over, the 7-day
 *  one is told: it is the one that resets last. */
export function usagePauseOf(accountId: string, reading: AccountReading | null | undefined, pauseAt: number, nowMs: number): UsagePause | null {
  if (!reading) return null
  const windows: Array<[UsagePause['window'], RateLimitWindow | null]> = [
    ['seven_day', reading.weekly],
    ['five_hour', reading.session]
  ]
  for (const [window, w] of windows) {
    if (!w || w.usedPercent < pauseAt) continue
    const resets = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
    if (!(resets > nowMs)) continue
    return { accountId, window, percent: w.usedPercent, resetsAt: w.resetsAt }
  }
  return null
}

/** The account to start on: the chain's first, else the first after it that is not paused (rolling's order). When
 *  every one is paused, the first one's pause, which is what the person reads. An empty chain is no block. */
export function usageChoice(
  chain: readonly string[],
  pauseOf: (accountId: string) => UsagePause | null
): { ok: true; accountId: string | undefined } | { ok: false; pause: UsagePause } {
  let first: UsagePause | null = null
  for (const id of chain) {
    const p = pauseOf(id)
    if (p === null) return { ok: true, accountId: id }
    first ??= p
  }
  return first === null ? { ok: true, accountId: undefined } : { ok: false, pause: first }
}

/** A pause in one English line, for logs and command answers ("account a is at 93% of its 5-hour limit, …"). */
export function usagePauseWhy(p: UsagePause): string {
  const window = p.window === 'five_hour' ? '5-hour' : '7-day'
  const until = p.resetsAt === null ? 'until a fresh reading is under the threshold' : `until ${p.resetsAt}`
  return `account ${p.accountId} is at ${p.percent}% of its ${window} limit: no new worker starts on it ${until}`
}

export type UsageChange = { type: 'usage.paused' | 'usage.resumed'; pause: UsagePause }

export interface UsageGuard {
  /** Reads every account again, and tells each pause that began or ended since the last read. */
  refresh(): Promise<void>
  /** The account's pause as of the last `refresh`, or null. */
  pauseOf(accountId: string): UsagePause | null
  /** Every account read at the last `refresh`, with its windows and pause. */
  view(): Array<{ accountId: string } & AccountReading & { paused: UsagePause | null }>
  pauseAt(): number
}

/**
 * The per-process guard: one per Host and one per app, each over its own sessions' statusLine readings. `refresh`
 * runs before a start and on a timer (so a pause also ends on its own, `resets_at` passing with nothing else
 * happening); calls that overlap share one read.
 */
export function createUsageGuard(d: {
  readings(): Promise<Map<string, AccountReading>>
  pauseAt(): Promise<number>
  nowMs(): number
  onChange?(e: UsageChange): void
}): UsageGuard {
  let readings = new Map<string, AccountReading>()
  let paused = new Map<string, UsagePause>()
  let threshold = USAGE_PAUSE_AT_DEFAULT
  let inFlight: Promise<void> | null = null
  const read = async (): Promise<void> => {
    const [next, at] = await Promise.all([d.readings(), d.pauseAt()])
    const now = d.nowMs()
    const nextPaused = new Map<string, UsagePause>()
    for (const [id, r] of next) {
      const p = usagePauseOf(id, r, at, now)
      if (p) nextPaused.set(id, p)
    }
    for (const [id, p] of nextPaused) if (!paused.has(id)) d.onChange?.({ type: 'usage.paused', pause: p })
    for (const [id, p] of paused) if (!nextPaused.has(id)) d.onChange?.({ type: 'usage.resumed', pause: p })
    readings = next
    paused = nextPaused
    threshold = at
  }
  return {
    refresh() {
      inFlight ??= read().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    pauseOf: (id) => paused.get(id) ?? null,
    view: () => [...readings].map(([accountId, r]) => ({ accountId, ...r, paused: paused.get(accountId) ?? null })),
    pauseAt: () => threshold
  }
}
