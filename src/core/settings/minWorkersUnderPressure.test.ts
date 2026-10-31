import { describe, expect, it } from 'vitest'
import { MAX_CONCURRENT_WORKERS } from '../orchestration/types'
import { minWorkersFloor, minWorkersUnderPressureOf } from './minWorkersUnderPressure'

describe('minWorkersUnderPressureOf', () => {
  it('reads a whole number >= 1 and caps it at MAX_CONCURRENT_WORKERS', () => {
    expect(minWorkersUnderPressureOf(1)).toBe(1)
    expect(minWorkersUnderPressureOf(13)).toBe(13)
    expect(minWorkersUnderPressureOf(MAX_CONCURRENT_WORKERS + 50)).toBe(MAX_CONCURRENT_WORKERS)
  })

  it('reads anything else as not set', () => {
    for (const v of [undefined, null, 0, -3, 2.5, NaN, Infinity, '4', true, {}, []]) expect(minWorkersUnderPressureOf(v)).toBeNull()
  })
})

describe('minWorkersFloor', () => {
  it("is half the person's limit, rounded up, when not set", () => {
    expect(minWorkersFloor(25, null)).toBe(13)
    expect(minWorkersFloor(8, null)).toBe(4)
    expect(minWorkersFloor(1, null)).toBe(1)
  })

  it("takes the setting, never above the person's limit", () => {
    expect(minWorkersFloor(25, 4)).toBe(4)
    expect(minWorkersFloor(25, 40)).toBe(25)
    expect(minWorkersFloor(6, 6)).toBe(6)
  })

  it('is never below 1', () => {
    expect(minWorkersFloor(0, null)).toBe(1)
    expect(minWorkersFloor(0, 3)).toBe(1)
  })
})
