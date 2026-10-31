// Account row actions: which items an account's menu offers for its state. Pure, so the rules are tested without the row.
// The same list feeds the "⋯" menu, the right-click menu, in the side-bar panel and in Settings › Accounts.
import type { AccountPlan, AccountPlanId } from '../../../core/types'
import type { AccountLoginState } from '../hooks/useAccountStatus'

export type AccountActionId = 'signIn' | 'signInAgain' | 'signOut' | 'rename' | 'switch' | 'merge' | 'remove'

export interface AccountAction {
  id: AccountActionId
  /** Why a shown item is off (its label hint); absent: it works. */
  block?: string
}

/** A row's login as either reader holds it: the boolean of `loginMap`, or the full state of `loginStates`
 *  (hooks/useAccountStatus.ts). undefined: the login check has not answered yet. */
export type AccountLoginFact = boolean | AccountLoginState | undefined

export interface AccountActionFacts {
  /** undefined: the login check has not answered yet, so no sign-in or sign-out is offered. T3: `unknown` (the
   *  check failed with nothing known before) and `expired` (refused credentials on disk) offer both. */
  loggedIn: AccountLoginFact
  /** "Use for this tab": undefined hides it (the account the tab already runs on), null offers it, a string is the reason it is off. */
  switchBlock: string | null | undefined
  /** This account is the same login as another, so the two can be merged. */
  mergeable: boolean
}

const signedIn = (f: AccountLoginFact): boolean => f === true || f === 'signedIn'
const signedOut = (f: AccountLoginFact): boolean => f === false || f === 'signedOut'
/** T3: we cannot say it is either (a failed probe), or the credentials are there but refused. */
const either = (f: AccountLoginFact): boolean => f === 'unknown' || f === 'expired'

export function accountActions(f: AccountActionFacts): AccountAction[] {
  const out: AccountAction[] = []
  if (signedOut(f.loggedIn) || either(f.loggedIn)) out.push({ id: 'signIn' })
  if (signedIn(f.loggedIn)) out.push({ id: 'signInAgain' })
  out.push({ id: 'rename' })
  if (f.switchBlock !== undefined) out.push(f.switchBlock === null ? { id: 'switch' } : { id: 'switch', block: f.switchBlock })
  if (f.mergeable) out.push({ id: 'merge' })
  if (signedIn(f.loggedIn) || either(f.loggedIn)) out.push({ id: 'signOut' })
  out.push({ id: 'remove' })
  return out
}

/** The one state chip a row draws (T4): the login state, each with its own word and icon (AccountRow STATUS_VIEW), or
 *  `paused` when the usage guard has paused the account (it has no unpause, so the row only says so). A signed-out or
 *  expired login wins over paused (a signed-out account takes no worker either way); paused wins over unknown, since
 *  the pause is a known fact and a failed probe is not. null: the login check has not answered and nothing is paused,
 *  so nothing is drawn. An expired login is its own chip: credentials are on disk but were refused, so the row asks
 *  for a sign-in again (see useAccountStatus for when main reports it). */
export type AccountStatus = 'signedIn' | 'signedOut' | 'expired' | 'unknown' | 'paused'

export function accountStatus(loggedIn: AccountLoginFact, paused: boolean): AccountStatus | null {
  if (signedOut(loggedIn)) return 'signedOut'
  if (loggedIn === 'expired') return 'expired'
  if (paused) return 'paused'
  if (loggedIn === 'unknown') return 'unknown'
  return signedIn(loggedIn) ? 'signedIn' : null
}

/** The row's inline sign-in button: `signIn` for a signed-out account, `signInAgain` for an expired one, null otherwise
 *  (signed in, unknown or not answered yet; the row's menu still offers what accountActions gives it). */
export function signInButtonOf(loggedIn: AccountLoginFact): 'signIn' | 'signInAgain' | null {
  if (signedOut(loggedIn)) return 'signIn'
  return loggedIn === 'expired' ? 'signInAgain' : null
}

type PlanKey = `account.plan.${Exclude<AccountPlanId, 'unknown'>}`

/** The plan chip's text (T4): the plan's name; the raw string of a plan not recognised; null (no chip) when nothing
 *  was read: no answer yet, or an unknown plan with no string (a codex folder, a folder with no plan field). */
export function planLabelOf(plan: AccountPlan | undefined, t: (key: PlanKey) => string): string | null {
  if (!plan) return null
  if (plan.id !== 'unknown') return t(`account.plan.${plan.id}`)
  const raw = plan.raw?.trim()
  return raw ? raw : null
}
