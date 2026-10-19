import { describe, it, expect } from 'vitest'
import { clampPercent, meterTone } from './logic'

describe('meterTone', () => {
  it('under 75 accent, 75–89 warn, 90+ danger', () => {
    const cases: Array<[number, string]> = [
      [0, 'accent'], [74, 'accent'], [74.9, 'accent'], [75, 'warn'], [89, 'warn'], [89.9, 'warn'], [90, 'danger'], [100, 'danger']
    ]
    for (const [v, tone] of cases) expect(meterTone(v), String(v)).toBe(tone)
  })

  it('clamps out-of-range values and reads NaN as 0', () => {
    expect([-5, 140, NaN, Infinity, -Infinity].map(clampPercent)).toEqual([0, 100, 0, 100, 0])
    expect(meterTone(-5)).toBe('accent')
    expect(meterTone(140)).toBe('danger')
    expect(meterTone(NaN)).toBe('accent')
  })
})
