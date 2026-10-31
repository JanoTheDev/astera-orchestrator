// T2 (automatic accounts, settings/autoAccounts.ts): which account to start on and roll to, by usage.
// T5a (decision 6): one ranking rule for every start and roll, `rankAccounts`.
import type { Account, Provider } from '../types'
import { providerOf } from '../providers/meta'
import { isGhostAccountId } from './ghostId'
import type { AccountReading, UsageGuard } from '../orchestration/usageGuard'
import type { RateLimitWindow } from '../types'

/** Points one live Astera session adds to an account's score, so starts spread over the accounts with room (decision
 *  21: 30 CLIs over 4 accounts land 7-8 each). */
export const SPREAD_WEIGHT = 10

/** A reading older than this is stale: it is re-fetched before ranking (readingsFresh) and, if still old, ranks after
 *  every known-usable account. */
export const READING_MAX_AGE_MS = 10 * 60_000

export type UnusableReason = 'weekly-full' | 'session-full' | 'unknown' | 'stale' | 'logged-out' | 'at-cap'

/** The window's used share now: 0 once its reset has passed, null when there is no window. */
function usedNow(w: RateLimitWindow | null | undefined, nowMs: number): number | null {
  if (!w) return null
  const resets = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
  return Number.isFinite(resets) && resets <= nowMs ? 0 : w.usedPercent
}

/** A reading with a weekly window and no 5-hour one: an account whose plan has no 5-hour window (Ultra). It is judged
 *  on the window it has, and its waits are never called 5-hour waits. A reading with neither window is not this: it
 *  says nothing about the account. */
export function hasNoSessionWindow(r: AccountReading | null | undefined): boolean {
  return !!r && !r.session && !!r.weekly
}

/**
 * The one ranking rule (decision 6). Usable = logged in, under its `maxSessions` cap, and the weekly window known and
 * under `threshold`, as is the 5-hour window when the account has one (a window whose reset has passed counts as 0).
 * An account with a weekly window and no 5-hour window (hasNoSessionWindow) is usable on the weekly window alone; one
 * with no weekly window is unknown, and so is one with neither. Weekly is checked first: a full weekly window makes the
 * account unusable whatever its 5-hour value and whatever its reset (null included) says, until that reset passes.
 *
 * Usable accounts order by `max(weekly%, 5h%) + SPREAD_WEIGHT * liveSessions` (a missing 5-hour window counts as 0, so
 * such an account is ordered by its weekly fill), then weekly headroom, then the list's own (registry) order. Unusable ones come after, in the order they may still be tried: unknown/stale first (flagged,
 * tried last), then full ones least used first, then at-cap and logged-out.
 */
export function rankAccounts<A extends Pick<Account, 'id'>>(a: {
  accounts: readonly A[]
  readings: ReadonlyMap<string, AccountReading>
  threshold: number
  nowMs: number
  /** Absent: every account counts as logged in. */
  loggedInIds?: ReadonlySet<string>
  /** Astera-started sessions running now per account, all roles. */
  liveSessions?: ReadonlyMap<string, number>
  /** Per-account cap on live sessions; absent = no cap. */
  maxSessions?: ReadonlyMap<string, number>
}): { usable: A[]; unusable: { account: A; reason: UnusableReason }[] } {
  const rows = a.accounts.map((account, i) => {
    const r = a.readings.get(account.id)
    const live = a.liveSessions?.get(account.id) ?? 0
    const cap = a.maxSessions?.get(account.id)
    const weekly = usedNow(r?.weekly, a.nowMs)
    const session = usedNow(r?.session, a.nowMs)
    const used = Math.max(weekly ?? 0, session ?? 0)
    const reason: UnusableReason | null =
      a.loggedInIds && !a.loggedInIds.has(account.id)
        ? 'logged-out'
        : cap !== undefined && live >= cap
          ? 'at-cap'
          : weekly !== null && weekly >= a.threshold
            ? 'weekly-full'
            : session !== null && session >= a.threshold
              ? 'session-full'
              : weekly === null
                ? 'unknown'
                : r?.at !== undefined && a.nowMs - r.at > READING_MAX_AGE_MS
                  ? 'stale'
                  : null
    return { account, i, reason, score: used + SPREAD_WEIGHT * live, weekly: weekly ?? 0, used }
  })
  const group = (reason: UnusableReason | null): number =>
    reason === null ? 0 : reason === 'unknown' || reason === 'stale' ? 1 : reason === 'weekly-full' || reason === 'session-full' ? 2 : 3
  rows.sort(
    (x, y) =>
      group(x.reason) - group(y.reason) ||
      (x.reason === null ? x.score - y.score || x.weekly - y.weekly : group(x.reason) === 2 ? x.used - y.used : 0) ||
      x.i - y.i
  )
  return {
    usable: rows.filter((x) => x.reason === null).map((x) => x.account),
    unusable: rows.flatMap((x) => (x.reason === null ? [] : [{ account: x.account, reason: x.reason }]))
  }
}

/** `rankAccounts` as one id list: usable first, then the unusable in the order they may still be tried. */
export function rankedIds(ranked: { usable: readonly { id: string }[]; unusable: readonly { account: { id: string } }[] }): string[] {
  return [...ranked.usable.map((x) => x.id), ...ranked.unusable.map((x) => x.account.id)]
}

/**
 * Every logged-in, registered account of `provider`, in `rankAccounts` order: usable ones best first, then unknown or
 * stale ones, then full ones. Logged-out accounts and ghosts are left out.
 */
export function autoAccountOrder(a: {
  provider: Provider
  accounts: readonly Account[]
  loggedInIds: ReadonlySet<string>
  readings: ReadonlyMap<string, AccountReading>
  pauseAt: number
  nowMs: number
  liveSessions?: ReadonlyMap<string, number>
  maxSessions?: ReadonlyMap<string, number>
}): string[] {
  return rankedIds(autoRanking(a))
}

function autoRanking(a: Parameters<typeof autoAccountOrder>[0]): ReturnType<typeof rankAccounts<Account>> {
  return rankAccounts({
    accounts: a.accounts.filter((x) => providerOf(x) === a.provider && a.loggedInIds.has(x.id) && !isGhostAccountId(x.id)),
    readings: a.readings,
    threshold: a.pauseAt,
    nowMs: a.nowMs,
    liveSessions: a.liveSessions,
    maxSessions: a.maxSessions
  })
}

/** A chain with the automatic order behind it: `own` (the Task's chain, in its order) first, but only the accounts that
 *  are not `over`, then the rest of `order`. Over-threshold accounts of `own` keep their place in `order` (last). */
export function withAutoOrder(own: readonly string[], order: readonly string[], over: (id: string) => boolean): string[] {
  return [...new Set([...own.filter((id) => !over(id)), ...order])]
}

/** What a start path needs of the usage guard for the automatic order. */
export type AutoAccountsGuard = Pick<UsageGuard, 'pauseOf' | 'view' | 'pauseAt' | 'autoAccounts' | 'liveSessions' | 'maxSessions'>

/** The automatic order over the guard's last `refresh` (its readings, threshold and pauses), or null when the setting
 *  is off: the caller then keeps today's chain. `usable` is `rankAccounts`' verdict (known, fresh, under the
 *  threshold and the cap). */
export function autoOrderOf(
  guard: AutoAccountsGuard,
  a: {
    provider: Provider
    accounts: readonly Account[]
    loggedInIds: ReadonlySet<string>
    nowMs: number
    liveSessions?: ReadonlyMap<string, number>
    maxSessions?: ReadonlyMap<string, number>
  }
): { order: string[]; over: (id: string) => boolean; usable: (id: string) => boolean } | null {
  if (!guard.autoAccounts()) return null
  const readings = new Map(guard.view().map((v) => [v.accountId, { session: v.session, weekly: v.weekly, ...(v.at === undefined ? {} : { at: v.at }) }]))
  // T5b: the guard's live counts and caps unless the caller brings its own, so every start spreads (decision 21)
  const ranked = autoRanking({
    ...a,
    readings,
    pauseAt: guard.pauseAt(),
    liveSessions: a.liveSessions ?? guard.liveSessions?.(),
    maxSessions: a.maxSessions ?? guard.maxSessions?.()
  })
  const usable = new Set(ranked.usable.map((x) => x.id))
  return {
    order: rankedIds(ranked),
    over: (id) => guard.pauseOf(id) !== null,
    usable: (id) => usable.has(id)
  }
}
