// T4 (account center redesign): whether an account has a 5-hour window to draw. Pure, so the meter, the account
// picker (accountSelectItems.ts) and Start's account list (pages/startLogic.ts) cannot disagree about it.
import type { AccountPlan, AccountUsage } from '../../../core/types'

/**
 * False when the account has no 5-hour window, so no "5h" track or figure is drawn for it:
 * - its plan says so (`AccountPlan.hasSessionWindow`, false for Ultra: core/accounts/plan.ts), or
 * - its usage reading has a weekly window and no session window. Only an ok answer ever becomes an
 *   `AccountUsage` (main's AccountUsageStore.remember keeps nothing else), so a reading here is a good one.
 *
 * True otherwise, including while neither is known: an unread plan and an absent reading say nothing, and the
 * two-track layout is the one most accounts have.
 */
export function hasSessionWindow(
  plan: Pick<AccountPlan, 'hasSessionWindow'> | null | undefined,
  usage: Pick<AccountUsage, 'session' | 'weekly'> | null | undefined
): boolean {
  if (plan?.hasSessionWindow === false) return false
  if (usage && usage.weekly && !usage.session) return false
  return true
}
