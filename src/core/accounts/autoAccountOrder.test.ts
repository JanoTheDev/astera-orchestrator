import { describe, it, expect } from 'vitest'
import type { Account, Provider } from '../types'
import type { AccountReading } from '../orchestration/usageGuard'
import { autoAccountOrder, rankAccounts, withAutoOrder, READING_MAX_AGE_MS } from './autoAccountOrder'
import { rollChainFor } from './dispatchAccount'
import { GHOST_ID_PREFIX } from './ghostId'

const NOW = Date.parse('2026-10-18T12:00:00Z')
const LATER = '2026-10-18T14:00:00Z'
const PAST = '2026-10-18T11:00:00Z'
const acct = (id: string, provider: Provider = 'claude'): Account => ({ id, label: id, configDir: `/cfg/${id}`, color: '#fff', createdAt: '2026-01-01T00:00:00.000Z', provider })
const r = (session: number | null, weekly: number | null = null, resetsAt: string | null = LATER): AccountReading => ({
  session: session === null ? null : { usedPercent: session, resetsAt },
  weekly: weekly === null ? null : { usedPercent: weekly, resetsAt }
})
const order = (accounts: Account[], readings: Record<string, AccountReading>, loggedIn = accounts.map((a) => a.id), provider: Provider = 'claude') =>
  autoAccountOrder({ provider, accounts, loggedInIds: new Set(loggedIn), readings: new Map(Object.entries(readings)), pauseAt: 90, nowMs: NOW })

describe('rankAccounts', () => {
  const rank = (accounts: Account[], readings: Record<string, AccountReading>, extra: Partial<Parameters<typeof rankAccounts>[0]> = {}) =>
    rankAccounts({ accounts, readings: new Map(Object.entries(readings)), threshold: 90, nowMs: NOW, ...extra })
  const ids = (x: ReturnType<typeof rank>) => x.usable.map((a) => a.id)

  it('checks weekly first: 0% 5-hour but 100% weekly loses to 40%/40%', () => {
    const out = rank([acct('a'), acct('b')], { a: r(0, 100), b: r(40, 40) })
    expect(ids(out)).toEqual(['b'])
    expect(out.unusable).toEqual([{ account: acct('a'), reason: 'weekly-full' }])
  })

  it('a full weekly window with no reset time stays full', () => {
    expect(rank([acct('a')], { a: r(0, 100, null) }).unusable[0].reason).toBe('weekly-full')
  })

  it('a full 5-hour window is session-full', () => {
    expect(rank([acct('a')], { a: r(95, 10) }).unusable[0].reason).toBe('session-full')
  })

  it('sorts an unknown account after a known 30% one and flags it', () => {
    const out = rank([acct('a'), acct('b')], { b: r(30, 30) })
    expect(ids(out)).toEqual(['b'])
    expect(out.unusable).toEqual([{ account: acct('a'), reason: 'unknown' }])
    expect(rank([acct('a')], { a: r(10) }).unusable[0].reason).toBe('unknown') // weekly missing
  })

  it('ranks a weekly-only account (no 5-hour window) usable, by its weekly fill against two-window accounts', () => {
    const readings = { ultra: r(null, 40), full: r(70, 70), roomy: r(10, 10) }
    const out = rank([acct('full'), acct('ultra'), acct('roomy')], readings)
    expect(ids(out)).toEqual(['roomy', 'ultra', 'full'])
    expect(out.unusable).toEqual([])
    // 40% weekly beats a two-window account whose 5-hour value is the higher fill
    expect(ids(rank([acct('a'), acct('ultra')], { a: r(60, 20), ultra: r(null, 40) }))).toEqual(['ultra', 'a'])
  })

  it('judges a weekly-only account on the window it has: full weekly is weekly-full, a live session adds spread', () => {
    expect(rank([acct('ultra')], { ultra: r(null, 95) }).unusable[0].reason).toBe('weekly-full')
    const out = rank([acct('ultra'), acct('b')], { ultra: r(null, 20), b: r(25, 25) }, { liveSessions: new Map([['ultra', 1]]) })
    expect(ids(out)).toEqual(['b', 'ultra'])
  })

  it('a weekly-only account with an old reading is stale; with neither window it stays unknown', () => {
    const old = { ...r(null, 10), at: NOW - READING_MAX_AGE_MS - 1 }
    expect(rank([acct('a')], { a: old }).unusable[0].reason).toBe('stale')
    expect(rank([acct('a')], { a: r(null, null) }).unusable[0].reason).toBe('unknown')
    expect(rank([acct('a')], {}).unusable[0].reason).toBe('unknown')
  })

  it('flags a reading older than ten minutes as stale', () => {
    const old = { ...r(10, 10), at: NOW - READING_MAX_AGE_MS - 1 }
    expect(rank([acct('a')], { a: old }).unusable[0].reason).toBe('stale')
    expect(ids(rank([acct('a')], { a: { ...old, at: NOW - 60_000 } }))).toEqual(['a'])
  })

  it('counts a window whose reset has passed as empty', () => {
    expect(ids(rank([acct('a'), acct('b')], { a: r(99, 99, PAST), b: r(10, 10) }))).toEqual(['a', 'b'])
  })

  it('orders by usage plus 10 per live session, then weekly headroom, then list order', () => {
    expect(ids(rank([acct('a'), acct('b'), acct('c')], { a: r(60, 10), b: r(10, 30), c: r(20, 20) }))).toEqual(['c', 'b', 'a'])
    expect(ids(rank([acct('a'), acct('b')], { a: r(40, 10), b: r(10, 40) }))).toEqual(['a', 'b'])
    expect(ids(rank([acct('a'), acct('b')], { a: r(10, 10), b: r(40, 40) }, { liveSessions: new Map([['a', 5]]) }))).toEqual(['b', 'a'])
  })

  it('spreads 30 sequential starts over 4 equal accounts 7-8 each', () => {
    const accounts = ['a', 'b', 'c', 'd'].map((id) => acct(id))
    const readings = Object.fromEntries(accounts.map((a) => [a.id, r(20, 20)]))
    const live = new Map<string, number>()
    for (let k = 0; k < 30; k++) {
      const id = rank(accounts, readings, { liveSessions: live }).usable[0].id
      live.set(id, (live.get(id) ?? 0) + 1)
    }
    for (const a of accounts) expect([7, 8]).toContain(live.get(a.id))
  })

  it('respects maxSessions and leaves logged-out accounts out of the usable ones', () => {
    const out = rank([acct('a'), acct('b'), acct('c')], { a: r(1, 1), b: r(50, 50), c: r(1, 1) }, {
      liveSessions: new Map([['a', 2]]),
      maxSessions: new Map([['a', 2]]),
      loggedInIds: new Set(['a', 'b'])
    })
    expect(ids(out)).toEqual(['b'])
    expect(out.unusable.map((x) => [x.account.id, x.reason])).toEqual([['a', 'at-cap'], ['c', 'logged-out']])
  })
})

describe('autoAccountOrder', () => {
  it('usable first (least used), then unknown, then full ones least used first', () => {
    expect(order([acct('u'), acct('a'), acct('b'), acct('c'), acct('k')], { a: r(99, 10), b: r(50, 50), c: r(10, 95), k: r(5, 5) })).toEqual([
      'k',
      'b',
      'u',
      'c',
      'a'
    ])
  })

  it('leaves out other providers, logged-out accounts and ghosts', () => {
    const accounts = [acct('a'), acct('x', 'codex'), acct('out'), acct(`${GHOST_ID_PREFIX}/home/g`)]
    expect(order(accounts, {}, ['a', 'x', `${GHOST_ID_PREFIX}/home/g`])).toEqual(['a'])
    expect(order(accounts, {}, ['a', 'x'], 'codex')).toEqual(['x'])
  })
})

describe('withAutoOrder', () => {
  it("keeps the Task's accounts under the threshold first, and moves an over one to its place in the order", () => {
    const over = (id: string) => id === 'a'
    expect(withAutoOrder(['a', 'b'], ['c', 'b', 'a'], over)).toEqual(['b', 'c', 'a'])
    expect(withAutoOrder(['a'], ['a'], over)).toEqual(['a'])
  })
})

describe('rollChainFor with the automatic order', () => {
  const accounts = [acct('a'), acct('b'), acct('c')]
  const loggedInIds = new Set(['a', 'b', 'c'])
  it('keeps the requested account first and rolls on to the rest least used first', () => {
    const picked = rollChainFor({ requested: 'b', taskAccountIds: ['a'], provider: 'claude', accounts, loggedInIds, auto: { order: ['c', 'b', 'a'], over: (id) => id === 'a' } })
    expect(picked).toEqual({ chain: ['b', 'c', 'a'] })
  })
  it('moves an unusable requested account to its place in the order (decision 6)', () => {
    const auto = { order: ['c', 'b', 'a'], over: (id: string) => id === 'a', usable: (id: string) => id !== 'a' }
    expect(rollChainFor({ requested: 'a', taskAccountIds: ['b'], provider: 'claude', accounts, loggedInIds, auto })).toEqual({ chain: ['b', 'c', 'a'] })
  })
  it('without it, the chain is the Task\'s own', () => {
    expect(rollChainFor({ requested: 'a', taskAccountIds: ['a'], provider: 'claude', accounts, loggedInIds })).toEqual({ chain: ['a'] })
  })
})
