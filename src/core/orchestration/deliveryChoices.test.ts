import { describe, it, expect } from 'vitest'
import { deliveryChoicesOf, effectiveDelivery, remoteHostOf } from './deliveryChoices'

const base = { isGitRepo: true, remoteUrl: null, ghSignedIn: false, branch: 'main' }
const offered = (c: ReturnType<typeof deliveryChoicesOf>): string[] => c.filter((x) => x.available).map((x) => x.mode)

describe('deliveryChoicesOf', () => {
  it('no remote: merge and review only, push and pull request off with their reasons', () => {
    const c = deliveryChoicesOf(base)
    expect(c.map((x) => x.mode)).toEqual(['merge', 'push', 'pr', 'manual'])
    expect(offered(c)).toEqual(['merge', 'manual'])
    expect(c.find((x) => x.mode === 'push')?.reason).toBe('noRemote')
    expect(c.find((x) => x.mode === 'pr')?.reason).toBe('notGitHub')
  })

  it('a remote that is not GitHub: push is offered (on that host), a pull request is not', () => {
    const c = deliveryChoicesOf({ ...base, remoteUrl: 'git@gitlab.com:me/app.git', ghSignedIn: true })
    expect(offered(c)).toEqual(['merge', 'push', 'manual'])
    expect(c.find((x) => x.mode === 'push')).toMatchObject({ available: true, host: 'gitlab.com', github: false })
    expect(c.find((x) => x.mode === 'pr')?.reason).toBe('notGitHub')
  })

  it('a GitHub remote without gh signed in: push, but no pull request', () => {
    const c = deliveryChoicesOf({ ...base, remoteUrl: 'https://github.com/me/app.git' })
    expect(offered(c)).toEqual(['merge', 'push', 'manual'])
    expect(c.find((x) => x.mode === 'push')).toMatchObject({ github: true })
    expect(c.find((x) => x.mode === 'pr')?.reason).toBe('ghSignedOut')
  })

  it('a GitHub remote with gh signed in: everything', () => {
    const c = deliveryChoicesOf({ ...base, remoteUrl: 'git@github.com:me/app.git', ghSignedIn: true })
    expect(offered(c)).toEqual(['merge', 'push', 'pr', 'manual'])
    expect(c.every((x) => x.reason === undefined)).toBe(true)
  })

  it('not a git repository: only review, and every other choice says the folder is not a git repository', () => {
    const c = deliveryChoicesOf({ ...base, isGitRepo: false, branch: null })
    expect(offered(c)).toEqual(['manual'])
    expect(c.filter((x) => !x.available).map((x) => x.reason)).toEqual(['notGit', 'notGit', 'notGit'])
  })
})

describe('remoteHostOf', () => {
  it('reads the host of https, ssh and scp-like URLs; a path has none', () => {
    expect(remoteHostOf('https://github.com/me/app.git')).toBe('github.com')
    expect(remoteHostOf('ssh://git@GitHub.com:22/me/app')).toBe('github.com')
    expect(remoteHostOf('git@gitlab.example.org:me/app.git')).toBe('gitlab.example.org')
    expect(remoteHostOf('/srv/git/app.git')).toBeNull()
  })
})

describe('effectiveDelivery', () => {
  const none = deliveryChoicesOf(base)
  const all = deliveryChoicesOf({ ...base, remoteUrl: 'https://github.com/me/app', ghSignedIn: true })

  it('keeps a saved choice that works', () => {
    expect(effectiveDelivery('pr', all)).toEqual({ mode: 'pr' })
    expect(effectiveDelivery('manual', none)).toEqual({ mode: 'manual' })
  })

  it('a saved choice that does not work falls back to merge, and says why', () => {
    expect(effectiveDelivery('pr', none)).toEqual({ mode: 'merge', reason: 'notGitHub' })
    expect(effectiveDelivery('push', none)).toEqual({ mode: 'merge', reason: 'noRemote' })
  })

  it('falls back to review when nothing can be merged', () => {
    expect(effectiveDelivery('pr', deliveryChoicesOf({ ...base, isGitRepo: false }))).toEqual({ mode: 'manual', reason: 'notGit' })
  })
})
