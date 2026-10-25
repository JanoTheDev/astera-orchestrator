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
