import { describe, expect, it } from 'vitest'
import type { AccountPlan, AccountUsage } from '../../../core/types'
import { hasSessionWindow } from './sessionWindow'

const plan = (id: AccountPlan['id']): AccountPlan => ({ id, raw: id, hasSessionWindow: id !== 'ultra' })
const win = (usedPercent: number) => ({ usedPercent, resetsAt: null })
const reading = (session: number | null, weekly: number | null): AccountUsage => ({
  session: session === null ? null : win(session),
  weekly: weekly === null ? null : win(weekly),
  readAt: '2026-10-31T12:00:00.000Z',
  remembered: false
})

describe('hasSessionWindow', () => {
  it('an Ultra plan has none, whatever the reading says', () => {
    expect(hasSessionWindow(plan('ultra'), undefined)).toBe(false)
    expect(hasSessionWindow(plan('ultra'), reading(12, 40))).toBe(false)
  })

  it('a reading with a weekly window and no session window has none, on any plan', () => {
    expect(hasSessionWindow(undefined, reading(null, 40))).toBe(false)
    expect(hasSessionWindow(plan('max'), reading(null, 40))).toBe(false)
    expect(hasSessionWindow(plan('unknown'), reading(null, 0))).toBe(false)
  })

  it('a plan with a session window and a two-window reading keeps it', () => {
    expect(hasSessionWindow(plan('max'), reading(12, 40))).toBe(true)
    expect(hasSessionWindow(plan('pro'), reading(0, 0))).toBe(true)
  })

  it('nothing known keeps it: no plan read yet, no reading', () => {
    expect(hasSessionWindow(undefined, undefined)).toBe(true)
    expect(hasSessionWindow(null, null)).toBe(true)
    expect(hasSessionWindow(plan('unknown'), undefined)).toBe(true)
  })

  it('a session window alone, or neither window, keeps it', () => {
    expect(hasSessionWindow(plan('pro'), reading(30, null))).toBe(true)
    expect(hasSessionWindow(undefined, reading(null, null))).toBe(true)
  })
})
