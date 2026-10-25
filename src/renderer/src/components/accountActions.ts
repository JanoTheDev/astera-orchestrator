// Account row actions: which items an account's menu offers for its state. Pure, so the rules are tested without the row.
// The same list feeds the "⋯" menu, the right-click menu, in the side-bar panel and in Settings › Accounts.

export type AccountActionId = 'signIn' | 'signInAgain' | 'signOut' | 'rename' | 'switch' | 'merge' | 'remove'

export interface AccountAction {
  id: AccountActionId
  /** Why a shown item is off (its label hint); absent: it works. */
  block?: string
}

export interface AccountActionFacts {
  /** undefined: the login check has not answered yet, so no sign-in or sign-out is offered. */
  loggedIn: boolean | undefined
  /** "Use for this tab": undefined hides it (the account the tab already runs on), null offers it, a string is the reason it is off. */
  switchBlock: string | null | undefined
  /** This account is the same login as another, so the two can be merged. */
  mergeable: boolean
}

export function accountActions(f: AccountActionFacts): AccountAction[] {
  const out: AccountAction[] = []
  if (f.loggedIn === false) out.push({ id: 'signIn' })
  if (f.loggedIn === true) out.push({ id: 'signInAgain' })
  out.push({ id: 'rename' })
  if (f.switchBlock !== undefined) out.push(f.switchBlock === null ? { id: 'switch' } : { id: 'switch', block: f.switchBlock })
  if (f.mergeable) out.push({ id: 'merge' })
  if (f.loggedIn === true) out.push({ id: 'signOut' })
  out.push({ id: 'remove' })
  return out
}

/** The status chip a row draws besides the default badge: signed out wins over paused (a signed-out account takes no
 *  worker either way). null: nothing to say. The usage guard has no unpause, so a paused row only says so. */
export function accountStatus(loggedIn: boolean | undefined, paused: boolean): 'signedOut' | 'paused' | null {
  if (loggedIn === false) return 'signedOut'
  return paused ? 'paused' : null
}
