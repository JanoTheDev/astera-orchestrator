// W6-G: no new worker starts on an account that is nearly spent (orchestrator PLAN.md, Wave 6, "Usage pause").
//
// The rule: a Dispatch does not start on an account whose latest statusLine reading has its 5-hour or 7-day
// `used_percentage` at or over `usagePauseAt` (app setting, default 90), until that window's `resets_at` passes or a
// fresh reading is under the threshold. A window at or over it with no readable `resets_at` blocks too: it counts as
// full until a fresh reading says otherwise (T5a — an unknown reset is not room). When the Task's account chain (the
// one rolling moves along, Task.accountIds in order, accountToDispatchOn) has another account under the threshold, it
// starts on that one instead. No reading yet means no block here; the ranking (accounts/autoAccountOrder.ts) is what
// sorts an unknown account after the known-usable ones. Running workers are never stopped: this is asked before a start, nothing else.
//
// Pure, apart from `createUsageGuard`, which only remembers the last answer per account so a pause and its end can
// each be told once (`usage.paused` / `usage.resumed`).
import type { Provider, RateLimitWindow, UsagePause } from '../types'
import { providerOf } from '../providers/meta'
import { isGhostAccountId } from '../accounts/ghostId'

export const USAGE_PAUSE_AT_DEFAULT = 90

/** The app setting `usagePauseAt` as every reader narrows it: a whole percent from 1 to 100, else 90. */
export function usagePauseAtOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100 ? value : USAGE_PAUSE_AT_DEFAULT
}

/** An account's latest statusLine windows (SessionUsage's `session` is the 5-hour one, `weekly` the 7-day one). */
export interface AccountReading {
  session: RateLimitWindow | null
  weekly: RateLimitWindow | null
  /** When the windows were read (ms since epoch): the statusLine file's mtime, or the fetch time. Absent: unknown age,
   *  which the ranking takes as fresh. */
  at?: number
}

/** Why no new worker may start on this account now, or null when one may. A window whose reset has passed no longer
 *  counts, whatever it read. A full window with no readable reset time blocks: it is full until a fresh reading
 *  (readingsFresh, usage/accountReadings.ts) says otherwise. With both windows over, the 7-day one is told: it is the
 *  one that resets last. */
export function usagePauseOf(accountId: string, reading: AccountReading | null | undefined, pauseAt: number, nowMs: number): UsagePause | null {
  if (!reading) return null
  const windows: Array<[UsagePause['window'], RateLimitWindow | null]> = [
    ['seven_day', reading.weekly],
    ['five_hour', reading.session]
  ]
  for (const [window, w] of windows) {
    if (!w || w.usedPercent < pauseAt) continue
    const resets = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
    if (Number.isFinite(resets) && resets <= nowMs) continue
    return { accountId, window, percent: w.usedPercent, resetsAt: Number.isFinite(resets) ? w.resetsAt : null }
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

/** T1: whether a start on this account would be held. With "Pick accounts automatically" on, a start rolls to the
 *  provider's account with room (chooseStartAccount, exec/workerStart.ts), so an account is no hold while any logged-in
 *  account of its provider is unpaused; only when all are does its own pause count. Off: `pauseOf` as it is. The answer
 *  carries `auto` so a reader knows an empty chain is "auto", not "no account". Synchronous: the caller brings the
 *  account list and logins it already holds. */
export function startPauseOf<P>(
  pauseOf: (accountId: string) => P | null,
  a: { auto: boolean; accounts: ReadonlyArray<{ id: string; provider?: Provider }>; loggedInIds: ReadonlySet<string> }
): ((accountId: string) => P | null) & { auto?: true } {
  if (!a.auto) return (id) => pauseOf(id)
  const room = (id: string): boolean => {
    const named = a.accounts.find((x) => x.id === id)
    return (
      named !== undefined &&
      a.accounts.some((x) => providerOf(x) === providerOf(named) && !isGhostAccountId(x.id) && a.loggedInIds.has(x.id) && pauseOf(x.id) === null)
    )
  }
  return Object.assign((id: string) => (room(id) ? null : pauseOf(id)), { auto: true as const })
}

/** A pause in one English line, for logs and command answers ("account a is at 93% of its 5-hour limit, …"). */
export function usagePauseWhy(p: UsagePause): string {
  const window = p.window === 'five_hour' ? '5-hour' : '7-day'
  const until = p.resetsAt === null ? 'until a fresh reading is under the threshold' : `until ${p.resetsAt}`
  return `account ${p.accountId} is at ${p.percent}% of its ${window} limit: no new worker starts on it ${until}`
}

export type UsageChange =
  | { type: 'usage.paused' | 'usage.resumed'; pause: UsagePause }
  /** T5b: a start went to another account than the one it named (chooseStartAccount, exec/workerStart.ts). */
  | { type: 'account.switched'; from: string; to: string; reason: string }

/** T5b: how long a start counts on its account before its session shows in the live list: past this, a start that never
 *  released (a spawn that hung) stops counting. */
export const START_RESERVATION_MS = 2 * 60_000

export interface UsageGuard {
  /** Reads every account again, and tells each pause that began or ended since the last read. */
  refresh(): Promise<void>
  /** The account's pause as of the last `refresh`, or null. */
  pauseOf(accountId: string): UsagePause | null
  /** Every account read at the last `refresh`, with its windows and pause. */
  view(): Array<{ accountId: string } & AccountReading & { paused: UsagePause | null }>
  pauseAt(): number
  /** T2: "Pick accounts automatically" (settings/autoAccounts.ts) as of the last `refresh`. Without the setting's
   *  read wired, false: the guard then behaves exactly as before. */
  autoAccounts(): boolean
  /** T5b (decision 21): Astera sessions live on each account now, plus the starts chosen but not yet running
   *  (`reserve`), so a burst of starts sees each other. Absent: no counts (the ranking does not spread). */
  liveSessions?(): Map<string, number>
  /** T5b: the per-account cap (Settings › Accounts, `accountMaxSessions`) as of the last `refresh`. */
  maxSessions?(): Map<string, number>
  /** T5b: counts a start on `accountId` from the moment it is chosen; the returned function ends that (call it once
   *  the session runs, or the start failed). */
  reserve?(accountId: string): () => void
  /** T5b: tells a start that went to another account than it named (`account.switched`, a feed line in the Host). */
  switched?(e: { from: string; to: string; reason: string }): void
}

/**
 * The per-process guard: one per Host and one per app, each over its own sessions' statusLine readings. `refresh`
 * runs before a start and on a timer (so a pause also ends on its own, `resets_at` passing with nothing else
 * happening); calls that overlap share one read.
 */
export function createUsageGuard(d: {
  /** T2: `autoAccounts` says the setting is on, so the readings may include idle accounts' fetched usage. */
  readings(o: { autoAccounts: boolean }): Promise<Map<string, AccountReading>>
  pauseAt(): Promise<number>
  /** T2: the "Pick accounts automatically" setting. Absent: off. */
  autoAccounts?(): Promise<boolean>
  nowMs(): number
  onChange?(e: UsageChange): void
  /** T5b: the sessions running now, each with its account (the Host's registry, the app's session list). */
  sessions?(): ReadonlyArray<{ accountId: string | null | undefined }>
  /** T5b: `accountMaxSessions` (settings/accountMaxSessions.ts). Absent: no cap. */
  maxSessions?(): Promise<Record<string, number>>
}): UsageGuard {
  let readings = new Map<string, AccountReading>()
  let caps = new Map<string, number>()
  const reservations = new Map<number, { accountId: string; at: number }>()
  let nextReservation = 0
  let paused = new Map<string, UsagePause>()
  let threshold = USAGE_PAUSE_AT_DEFAULT
  // T5b: the setting is on unless it says otherwise (settings/autoAccounts.ts), so a start before the first read ranks
  // instead of falling back to the named account; with no setting wired, off
  let auto = d.autoAccounts !== undefined
  let inFlight: Promise<void> | null = null
  const read = async (): Promise<void> => {
    const autoNow = (await d.autoAccounts?.()) ?? false
    const [next, at, capsNow] = await Promise.all([
      d.readings({ autoAccounts: autoNow }),
      d.pauseAt(),
      d.maxSessions?.().catch(() => ({})) ?? {}
    ])
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
    auto = autoNow
    caps = new Map(Object.entries(capsNow))
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
    pauseAt: () => threshold,
    autoAccounts: () => auto,
    liveSessions: () => {
      const out = new Map<string, number>()
      const add = (id: string): void => void out.set(id, (out.get(id) ?? 0) + 1)
      for (const x of d.sessions?.() ?? []) if (x.accountId) add(x.accountId)
      const now = d.nowMs()
      for (const [key, r] of reservations)
        if (now - r.at > START_RESERVATION_MS) reservations.delete(key)
        else add(r.accountId)
      return out
    },
    maxSessions: () => new Map(caps),
    reserve: (accountId) => {
      const key = nextReservation++
      reservations.set(key, { accountId, at: d.nowMs() })
      return () => void reservations.delete(key)
    },
    switched: (e) => d.onChange?.({ type: 'account.switched', ...e })
  }
}
