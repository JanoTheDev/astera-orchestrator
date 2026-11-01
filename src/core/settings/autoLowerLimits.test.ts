import { describe, expect, it } from 'vitest'
import { autoLowerLimitsOf, clampLowering, lowerPolicyOf } from './autoLowerLimits'

describe('autoLowerLimitsOf', () => {
  it('keeps the three modes and reads anything else as floor', () => {
    expect(['on', 'floor', 'off'].map(autoLowerLimitsOf)).toEqual(['on', 'floor', 'off'])
    for (const v of [undefined, null, 'ON', 1, true, {}]) expect(autoLowerLimitsOf(v)).toBe('floor')
  })
})

describe('clampLowering', () => {
  it('on: the proposed cap', () => expect(clampLowering('on', 18, 6, 25)).toBe(6))
  it('floor: the proposed cap, held at the floor', () => {
    expect(clampLowering('floor', 18, 6, 25)).toBe(18)
    expect(clampLowering('floor', 18, 20, 25)).toBe(20)
  })
  it('floor: a cap already below the floor is not raised', () => expect(clampLowering('floor', 18, 6, 10)).toBe(10))
  it('floor: heavy slots stop at 1', () => expect(clampLowering('floor', 1, 0, 3)).toBe(1))
  it('off: no change', () => expect(clampLowering('off', 18, 6, 25)).toBe(25))
})

describe('lowerPolicyOf', () => {
  it('defaults to floor with half the owner limit', () => expect(lowerPolicyOf(null, 25)).toEqual({ mode: 'floor', floor: 13 }))
  it('reads the mode and the owner minimum', () =>
    expect(lowerPolicyOf({ autoLowerLimits: 'off', minWorkersUnderPressure: 18 }, 25)).toEqual({ mode: 'off', floor: 18 }))
})
