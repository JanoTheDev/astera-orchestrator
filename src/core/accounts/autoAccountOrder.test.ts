import { describe, it, expect } from 'vitest'
import type { Account, Provider } from '../types'
import type { AccountReading } from '../orchestration/usageGuard'
import { autoAccountOrder, withAutoOrder } from './autoAccountOrder'
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

describe('autoAccountOrder', () => {
  it('orders least used first by the higher of the two windows', () => {
    expect(order([acct('a'), acct('b'), acct('c')], { a: r(60), b: r(10, 30), c: r(20) })).toEqual(['c', 'b', 'a'])
  })

  it('puts accounts at or over the threshold last, least used of them first', () => {
    expect(order([acct('a'), acct('b'), acct('c')], { a: r(99), b: r(50), c: r(90) })).toEqual(['b', 'c', 'a'])
  })

  it('counts an unknown reading as 0, after a known 0, and keeps list order otherwise', () => {
    expect(order([acct('u1'), acct('k0'), acct('k5'), acct('u2')], { k0: r(0), k5: r(5) })).toEqual(['k0', 'u1', 'u2', 'k5'])
  })

  it('ignores a window whose reset has passed', () => {
    expect(order([acct('a'), acct('b')], { a: r(99, null, PAST), b: r(10) })).toEqual(['a', 'b'])
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
  it('without it, the chain is the Task\'s own', () => {
    expect(rollChainFor({ requested: 'a', taskAccountIds: ['a'], provider: 'claude', accounts, loggedInIds })).toEqual({ chain: ['a'] })
  })
})
