// T2 (automatic accounts, settings/autoAccounts.ts): which account to start on and roll to, by usage.
import type { Account, Provider } from '../types'
import { providerOf } from '../providers/meta'
import { isGhostAccountId } from './ghostId'
import { usagePauseOf, type AccountReading, type UsageGuard } from '../orchestration/usageGuard'

/** The highest used share of the reading's windows that still count (no reset, or a reset still ahead), or null. */
function usedOf(r: AccountReading | undefined, nowMs: number): number | null {
  let used: number | null = null
  for (const w of [r?.session, r?.weekly]) {
    if (!w) continue
    const resets = w.resetsAt === null ? NaN : Date.parse(w.resetsAt)
    if (w.resetsAt !== null && Number.isFinite(resets) && resets <= nowMs) continue
    used = Math.max(used ?? 0, w.usedPercent)
  }
  return used
}

/**
 * Every logged-in, registered account of `provider`, least used first.
 *
 * The rule: accounts the usage guard would pause (usagePauseOf at `pauseAt`) go last. The rest sort by their highest
 * window share, an unknown reading counting as 0; at an equal share a known reading comes before an unknown one (a
 * known 0 is room for sure, an unknown 0 is a guess); after that, the list's own order (registration order).
 */
export function autoAccountOrder(a: {
  provider: Provider
  accounts: readonly Account[]
  loggedInIds: ReadonlySet<string>
  readings: ReadonlyMap<string, AccountReading>
  pauseAt: number
  nowMs: number
}): string[] {
  return a.accounts
    .filter((x) => providerOf(x) === a.provider && a.loggedInIds.has(x.id) && !isGhostAccountId(x.id))
    .map((x, i) => {
      const r = a.readings.get(x.id)
      const used = usedOf(r, a.nowMs)
      return { id: x.id, i, over: usagePauseOf(x.id, r, a.pauseAt, a.nowMs) !== null, used: used ?? 0, known: used !== null }
    })
    .sort((x, y) => Number(x.over) - Number(y.over) || x.used - y.used || Number(y.known) - Number(x.known) || x.i - y.i)
    .map((x) => x.id)
}

/** A chain with the automatic order behind it: `own` (the Task's chain, in its order) first, but only the accounts that
 *  are not `over`, then the rest of `order`. Over-threshold accounts of `own` keep their place in `order` (last). */
export function withAutoOrder(own: readonly string[], order: readonly string[], over: (id: string) => boolean): string[] {
  return [...new Set([...own.filter((id) => !over(id)), ...order])]
}

/** What a start path needs of the usage guard for the automatic order. */
export type AutoAccountsGuard = Pick<UsageGuard, 'pauseOf' | 'view' | 'pauseAt' | 'autoAccounts'>

/** The automatic order over the guard's last `refresh` (its readings, threshold and pauses), or null when the setting
 *  is off: the caller then keeps today's chain. */
export function autoOrderOf(
  guard: AutoAccountsGuard,
  a: { provider: Provider; accounts: readonly Account[]; loggedInIds: ReadonlySet<string>; nowMs: number }
): { order: string[]; over: (id: string) => boolean } | null {
  if (!guard.autoAccounts()) return null
  const readings = new Map(guard.view().map((v) => [v.accountId, { session: v.session, weekly: v.weekly }]))
  return {
    order: autoAccountOrder({ ...a, readings, pauseAt: guard.pauseAt() }),
    over: (id) => guard.pauseOf(id) !== null
  }
}
