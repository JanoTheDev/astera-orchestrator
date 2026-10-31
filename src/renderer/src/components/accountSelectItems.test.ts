import { describe, expect, it } from 'vitest'
import type { Account, AccountUsage } from '../../../core/types'
import { accountSelectItems } from './accountSelectItems'

const acc = (id: string): Account => ({ id, label: id, configDir: `/c/${id}`, color: '#fff', createdAt: '' })
const win = (usedPercent: number) => ({ usedPercent, resetsAt: null })
const t = ((key: string, p?: { session?: number; weekly: number }): string =>
  p ? (p.session === undefined ? `${key}:${p.weekly}` : `${key}:${p.session}/${p.weekly}`) : key) as never

describe('accountSelectItems', () => {
  const usage: Record<string, AccountUsage> = {
    '/c/a': { session: win(12), weekly: win(40), readAt: '', remembered: false },
    '/c/b': { session: win(99), weekly: win(99), readAt: '', remembered: false }
  }
  const items = accountSelectItems({
    accounts: [acc('a'), acc('b'), acc('c')],
    loginMap: { a: true, b: false },
    usage,
    t,
    allLabel: 'none',
    suffixOf: (a) => (a.id === 'c' ? ' (orig)' : null)
  })

  it('puts the all-item first with an empty value', () => {
    expect(items[0]).toEqual({ value: '', label: 'none' })
  })
  it('shows usage for a known account', () => {
    expect(items[1].meta).toBe('account.select.usage:12/40')
  })
  it('shows signed out over stale usage', () => {
    expect(items[2].meta).toBe('account.select.signedOut')
  })
  it('shows nothing while status and usage are unknown, and keeps the suffix', () => {
    expect(items[3]).toMatchObject({ label: 'c (orig)', meta: undefined })
  })
})

// T4: an account with no 5-hour window (an Ultra plan, or a reading with a weekly window only) shows the weekly figure
// alone, never a "5h 0%".
describe('accountSelectItems without a 5-hour window', () => {
  const meta = (u: AccountUsage, plans?: Parameters<typeof accountSelectItems>[0]['plans']): string | undefined =>
    accountSelectItems({ accounts: [acc('u')], loginMap: { u: true }, usage: { '/c/u': u }, t, plans })[0].meta

  it('an Ultra plan shows weekly only', () => {
    const u = { session: win(0), weekly: win(40), readAt: '', remembered: false }
    expect(meta(u, { u: { id: 'ultra', raw: 'ultra', hasSessionWindow: false } })).toBe('account.select.usageWeekly:40')
  })
  it('a reading with no session window shows weekly only, without a plan', () => {
    expect(meta({ session: null, weekly: win(40), readAt: '', remembered: false })).toBe('account.select.usageWeekly:40')
  })
  it('a plan with a session window and a full reading keeps both', () => {
    const u = { session: win(5), weekly: win(40), readAt: '', remembered: false }
    expect(meta(u, { u: { id: 'max', raw: 'max', hasSessionWindow: true } })).toBe('account.select.usage:5/40')
  })
})
