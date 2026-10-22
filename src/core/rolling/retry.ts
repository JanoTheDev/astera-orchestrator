// Block records and retry planning for rolling accounts. A pure decision layer shared by the claude
// and codex coordinators — where RollCycle decides "what to do next", this decides "which account is
// usable right now". Timers and state publishing stay owned by each coordinator.
//
// There is deliberately no coordinator base class (it was estimated and then closed). Both
// coordinators now carry the stateSeq generation guard in pushState — codex gained one the moment its
// in-place resume gave it a deferred publish of its own — but the timer sets in disposeChain still
// differ (5 for claude / 3 for codex), and lifting timer lifetimes up into a common parent is the axis
// of this app that has produced the most bugs.

import { usagePauseOf, type AccountReading } from '../orchestration/usageGuard'
import { rankAccounts } from '../accounts/autoAccountOrder'

/** Record of one account being blocked. at=reset time; if unknown (null), treat it as blocked until since+RETRY_FALLBACK_MS. */
export interface BlockRecord {
  at: number | null
  weekly: boolean
  since: number // when it was recorded — the expiry basis when reset is unknown
}

// Retry schedule: targeted retry based on the reset time. The fallback interval when reset is unknown
// (the phrase alone was accepted), the floor (anti-hammering), and the margin just after reset.
export const RETRY_FALLBACK_MS = 15 * 60_000
export const RETRY_MIN_FLOOR_MS = 60_000
export const RETRY_MARGIN_MS = 60_000

/** Only the part of a chain that retry decisions need — the coordinator's Chain also carries timers, so we do not take it as-is. */
export interface RetryState {
  accountIds: string[]
  currentIndex: number
  recovery: (BlockRecord | null)[]
  /** T5a: the accounts in rankAccounts order (accounts/autoAccountOrder.ts). When present, pickAvailable takes the
   *  first usable one in this order instead of walking the round robin; ids it does not list come after, round robin. */
  order?: readonly string[]
}

/** T5a: the accounts' latest usage as a roll judges it (the usage guard's last refresh, kept fresh by readingsFresh). */
export interface AccountUsage {
  readings: ReadonlyMap<string, AccountReading>
  pauseAt: number
  /** Astera-started sessions running now per account, so a roll spreads the load too. */
  liveSessions?: ReadonlyMap<string, number>
}

/** T5a: what the accounts' usage readings add to a chain's retry state — a block per full account (usageBlockOf) and
 *  the chain's usable ids in rankAccounts order, live sessions spreading the load. */
export function usageRetryOf(
  accountIds: readonly string[],
  usage: AccountUsage,
  now: number
): { blocks: (BlockRecord | null)[]; order: string[] } {
  const ranked = rankAccounts({
    accounts: accountIds.map((id) => ({ id })),
    readings: usage.readings,
    threshold: usage.pauseAt,
    nowMs: now,
    liveSessions: usage.liveSessions
  })
  return {
    blocks: accountIds.map((id) => usageBlockOf(usage.readings.get(id), usage.pauseAt, now)),
    // Only the usable ones are ranked: the rest (unknown, stale) keep the round robin behind them, so a chain with no
    // readings at all (codex) rolls exactly as before.
    order: ranked.usable.map((x) => x.id)
  }
}

/** T5a: an account the usage reading says is full, as a block record — so pickAvailable skips it and planRetry waits
 *  for its reset, with no new concept here. A full window with no readable reset is `at: null` (re-checked after
 *  RETRY_FALLBACK_MS, like an unparsed limit phrase). */
export function usageBlockOf(reading: AccountReading | null | undefined, pauseAt: number, now: number): BlockRecord | null {
  const p = usagePauseOf('', reading, pauseAt, now)
  if (!p) return null
  const at = p.resetsAt === null ? NaN : Date.parse(p.resetsAt)
  return { at: Number.isFinite(at) ? at : null, weekly: p.window === 'seven_day', since: now }
}

/** Up to this time we consider that account unusable */
export function blockedUntil(rec: BlockRecord): number {
  return rec.at ?? rec.since + RETRY_FALLBACK_MS
}

/** The one that keeps the account unusable for longer. Used both when two chains record a block on
 *  the same account and when a chain's own record is merged with what another chain found.
 *
 *  Why "longer" and not "newer": a record whose reset time is unknown (at === null) expires after
 *  RETRY_FALLBACK_MS, so a newer but blind record would shorten a block another chain has real
 *  evidence for. The account is unusable until the latest time anyone can justify. */
export function laterBlock(a: BlockRecord | null, b: BlockRecord | null): BlockRecord | null {
  if (!a) return b
  if (!b) return a
  return blockedUntil(b) > blockedUntil(a) ? b : a
}

/** Walks once around from fromIndex for an account usable right now. Skips the current account. null if there is none. */
export function pickAvailable(state: RetryState, fromIndex: number, now: number): number | null {
  const n = state.accountIds.length
  const walk = Array.from({ length: n }, (_, k) => (fromIndex + k) % n)
  if (state.order) {
    const rank = (idx: number): number => {
      const at = state.order!.indexOf(state.accountIds[idx])
      return at < 0 ? state.order!.length : at
    }
    walk.sort((x, y) => rank(x) - rank(y)) // stable: unlisted ids keep the round robin
  }
  for (const idx of walk) {
    if (idx === state.currentIndex) continue
    const rec = state.recovery[idx]
    if (!rec || blockedUntil(rec) <= now) return idx
  }
  return null
}

/** Retry plan when every account is blocked — target the account with the earliest effective recovery
 *  time. No record is treated as now+fallback so it gets rechecked soon. retryAt is clamped to the
 *  floor (MIN_FLOOR), and a real reset gets the margin (MARGIN) added. */
export function planRetry(
  state: RetryState,
  now: number
): { target: number; retryAt: number; weekly: boolean } {
  let best = { target: 0, at: Infinity, hasReset: false, weekly: false }
  for (let i = 0; i < state.accountIds.length; i++) {
    const rec = state.recovery[i]
    const at = rec ? blockedUntil(rec) : now + RETRY_FALLBACK_MS
    if (at < best.at) best = { target: i, at, hasReset: !!rec?.at, weekly: rec ? rec.weekly : false }
  }
  const base = best.hasReset ? best.at + RETRY_MARGIN_MS : best.at
  return { target: best.target, retryAt: Math.max(base, now + RETRY_MIN_FLOOR_MS), weekly: best.weekly }
}
