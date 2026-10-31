// Account row actions: which items an account's menu offers for its state. Pure, so the rules are tested without the row.
// The same list feeds the "⋯" menu, the right-click menu, in the side-bar panel and in Settings › Accounts.
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

/** The status chip a row draws besides the default badge: signed out wins over paused (a signed-out account takes no
 *  worker either way). null: nothing to say. The usage guard has no unpause, so a paused row only says so. An expired
 *  login reads as signed out: the row asks for a sign-in either way. */
export function accountStatus(loggedIn: AccountLoginFact, paused: boolean): 'signedOut' | 'paused' | null {
  if (signedOut(loggedIn) || loggedIn === 'expired') return 'signedOut'
  return paused ? 'paused' : null
}
