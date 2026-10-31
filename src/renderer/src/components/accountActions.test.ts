import { describe, it, expect } from 'vitest'
import { accountActions, accountStatus, planLabelOf, signInButtonOf } from './accountActions'

const ids = (f: Parameters<typeof accountActions>[0]): string[] => accountActions(f).map((a) => a.id)
const base = { loggedIn: true as boolean | undefined, switchBlock: undefined as string | null | undefined, mergeable: false }

describe('accountActions', () => {
  it('a logged-in account can sign in again and sign out, not sign in', () => {
    expect(ids(base)).toEqual(['signInAgain', 'rename', 'signOut', 'remove'])
  })

  it('a logged-out account can sign in, not sign out or sign in again', () => {
    expect(ids({ ...base, loggedIn: false })).toEqual(['signIn', 'rename', 'remove'])
  })

  it('offers no sign-in or sign-out before the login check has answered', () => {
    expect(ids({ ...base, loggedIn: undefined })).toEqual(['rename', 'remove'])
  })

  it('a paused account offers the same actions as an active one: there is no unpause', () => {
    expect(accountStatus(true, true)).toBe('paused')
    expect(ids(base)).not.toContain('unpause')
  })

  it('use for this tab: hidden, on, or off with its reason', () => {
    expect(ids(base)).not.toContain('switch')
    expect(accountActions({ ...base, switchBlock: null }).find((a) => a.id === 'switch')).toEqual({ id: 'switch' })
    expect(accountActions({ ...base, switchBlock: 'Open a tab' }).find((a) => a.id === 'switch')).toEqual({ id: 'switch', block: 'Open a tab' })
  })

  it('merge shows only for a duplicate login, and remove stays last', () => {
    const list = ids({ ...base, mergeable: true })
    expect(list).toContain('merge')
    expect(list.at(-1)).toBe('remove')
  })
})

describe('accountStatus', () => {
  it('signed out wins over paused', () => {
    expect(accountStatus(false, true)).toBe('signedOut')
    expect(accountStatus(false, false)).toBe('signedOut')
  })
  it('paused over signed in; signed in has its own chip; nothing before the check answers', () => {
    expect(accountStatus(true, true)).toBe('paused')
    expect(accountStatus(undefined, true)).toBe('paused')
    expect(accountStatus(true, false)).toBe('signedIn')
    expect(accountStatus(undefined, false)).toBeNull()
  })
})

// T3 (account center sync): the rows now read the window-wide store's full state.
describe('accountActions with the login store state (T3)', () => {
  const st = (loggedIn: Parameters<typeof accountActions>[0]['loggedIn']): string[] => ids({ ...base, loggedIn })

  it('signed in and signed out read like true and false', () => {
    expect(st('signedIn')).toEqual(ids({ ...base, loggedIn: true }))
    expect(st('signedOut')).toEqual(ids({ ...base, loggedIn: false }))
  })

  // Finding 9: a failed probe used to leave the state undefined, and both items vanished.
  it('a failed probe (unknown) keeps both sign-in and sign-out on offer', () => {
    expect(st('unknown')).toEqual(['signIn', 'rename', 'signOut', 'remove'])
  })

  it('an expired login offers sign-in, and sign-out to clear the refused credentials', () => {
    expect(st('expired')).toEqual(['signIn', 'rename', 'signOut', 'remove'])
  })

  // T4: each login state has its own chip; expired is no longer folded into signed out.
  it('the status chip: one per login state, expired its own and over paused, paused over unknown', () => {
    expect(accountStatus('signedIn', false)).toBe('signedIn')
    expect(accountStatus('signedOut', true)).toBe('signedOut')
    expect(accountStatus('expired', false)).toBe('expired')
    expect(accountStatus('expired', true)).toBe('expired')
    expect(accountStatus('unknown', false)).toBe('unknown')
    expect(accountStatus('unknown', true)).toBe('paused')
    expect(accountStatus('signedIn', true)).toBe('paused')
  })
})

describe('signInButtonOf (T4)', () => {
  it('sign in for a signed-out login, sign in again for an expired one', () => {
    expect(signInButtonOf(false)).toBe('signIn')
    expect(signInButtonOf('signedOut')).toBe('signIn')
    expect(signInButtonOf('expired')).toBe('signInAgain')
  })
  it('no button while signed in, unknown or not answered (the menu still offers sign-in for unknown)', () => {
    for (const f of [true, 'signedIn', 'unknown', undefined] as const) expect(signInButtonOf(f)).toBeNull()
  })
})

describe('planLabelOf (T4)', () => {
  const t = (key: string): string => `t:${key}`
  it('a known plan reads as its name, Ultra included', () => {
    expect(planLabelOf({ id: 'ultra', raw: 'default_claude_ultra', hasSessionWindow: false }, t)).toBe('t:account.plan.ultra')
    expect(planLabelOf({ id: 'max', raw: 'max', hasSessionWindow: true }, t)).toBe('t:account.plan.max')
  })
  it('an unknown plan shows its raw string as it was read', () => {
    expect(planLabelOf({ id: 'unknown', raw: ' claude_galaxy ', hasSessionWindow: true }, t)).toBe('claude_galaxy')
  })
  it('no chip when nothing was read', () => {
    expect(planLabelOf(undefined, t)).toBeNull()
    expect(planLabelOf({ id: 'unknown', raw: null, hasSessionWindow: true }, t)).toBeNull()
    expect(planLabelOf({ id: 'unknown', raw: '  ', hasSessionWindow: true }, t)).toBeNull()
  })
})
