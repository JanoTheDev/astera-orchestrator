import { describe, expect, it } from 'vitest'
import type { Account, AccountUsage } from '../../../core/types'
import { accountSelectItems } from './accountSelectItems'

const acc = (id: string): Account => ({ id, label: id, configDir: `/c/${id}`, color: '#fff', createdAt: '' })
const win = (usedPercent: number) => ({ usedPercent, resetsAt: null })
const t = (key: string, p?: { session: number; weekly: number }): string =>
  p ? `${key}:${p.session}/${p.weekly}` : key

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
