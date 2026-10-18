import { describe, expect, it } from 'vitest'
import { startAtLoginOf } from './startAtLogin'

describe('start at login setting', () => {
  it('on unless an explicit false', () => {
    expect(startAtLoginOf(false)).toBe(false)
    for (const v of [undefined, true, 0, 'false', null]) expect(startAtLoginOf(v)).toBe(true)
  })
})
