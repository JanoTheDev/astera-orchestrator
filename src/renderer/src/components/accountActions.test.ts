import { describe, it, expect } from 'vitest'
import { accountActions, accountStatus } from './accountActions'

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
  it('paused, or nothing to say (also before the check answers)', () => {
    expect(accountStatus(true, true)).toBe('paused')
    expect(accountStatus(undefined, true)).toBe('paused')
    expect(accountStatus(true, false)).toBeNull()
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

  it('the status chip: expired reads as signed out, unknown says nothing beyond paused', () => {
    expect(accountStatus('expired', false)).toBe('signedOut')
    expect(accountStatus('signedOut', true)).toBe('signedOut')
    expect(accountStatus('unknown', true)).toBe('paused')
    expect(accountStatus('signedIn', false)).toBeNull()
  })
})
