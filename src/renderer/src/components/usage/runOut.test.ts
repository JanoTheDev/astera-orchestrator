import { describe, it, expect } from 'vitest'
import type { RateLimitWindow } from '../../../../core/types'
import { poolRunOutOf, runOutOf, SESSION_WINDOW_MS as W } from './runOut'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const H = 3_600_000
/** A window `ageMs` into its span, with `used` percent burned. */
const win = (used: number, ageMs: number): RateLimitWindow => ({
  usedPercent: used,
  resetsAt: new Date(NOW - ageMs + W).toISOString()
})

describe('runOutOf', () => {
  it('60% one hour in runs out in 40 minutes', () => {
    const r = runOutOf(win(60, H), W, NOW)
    expect(r?.ratePerHour).toBeCloseTo(60)
    expect(r?.runsOutAt).toBe(NOW + 40 * 60_000)
  })
  it('half used 2.5h in runs out exactly at the reset, which counts as lasting', () => {
    expect(runOutOf(win(50, 2.5 * H), W, NOW)).toMatchObject({
      runsOutAt: null
    })
  })
  it('10% at 4h lasts until the reset', () => {
    expect(runOutOf(win(10, 4 * H), W, NOW)).toMatchObject({ runsOutAt: null })
  })
  it('no estimate under 3% used', () => {
    expect(runOutOf(win(2, 2 * H), W, NOW)).toBeNull()
  })
  it('no estimate under 10 minutes in', () => {
    expect(runOutOf(win(40, 5 * 60_000), W, NOW)).toBeNull()
  })
  it('no estimate without a usable reset time', () => {
    expect(runOutOf({ usedPercent: 60, resetsAt: null }, W, NOW)).toBeNull()
    expect(runOutOf({ usedPercent: 60, resetsAt: 'soon' }, W, NOW)).toBeNull()
  })
  it('no estimate when the window is already past its span', () => {
    expect(runOutOf({ usedPercent: 60, resetsAt: new Date(NOW - H).toISOString() }, W, NOW)).toBeNull()
  })
  it('at or over 100% runs out now', () => {
    expect(runOutOf(win(100, H), W, NOW)?.runsOutAt).toBe(NOW)
  })
})

describe('poolRunOutOf', () => {
  it('sums remaining and rates of two accounts', () => {
    // 60% at 1h (60/h) + 20% at 1h (20/h): remaining 40+80=120 at 80/h = 1.5h
    const r = poolRunOutOf([win(60, H), win(20, H)], W, NOW)
    expect(r?.ratePerHour).toBeCloseTo(80)
    expect(r?.runsOutAt).toBe(NOW + 1.5 * H)
  })
  it('an account without an estimate still counts its remaining', () => {
    // 60/h on 40 left, plus 98 left from a 2% account: 138/60h = 2.3h, inside the 4h left
    const r = poolRunOutOf([win(60, H), win(2, H)], W, NOW)
    expect(r?.runsOutAt).toBeCloseTo(NOW + (138 / 60) * H, 0)
  })
  it('lasts when the pool outlives the latest reset', () => {
    expect(poolRunOutOf([win(10, 4 * H), win(5, 4 * H)], W, NOW)).toMatchObject({ runsOutAt: null })
  })
  it('null when no window has an estimate', () => {
    expect(poolRunOutOf([win(1, H), { usedPercent: 50, resetsAt: null }], W, NOW)).toBeNull()
  })
})
