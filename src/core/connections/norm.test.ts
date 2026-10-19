import { describe, it, expect } from 'vitest'
import { norm } from './norm'

describe('norm', () => {
  it('trims a string and turns blank or non-string values into null', () => {
    expect(norm('  abc ')).toBe('abc')
    expect(norm('')).toBeNull()
    expect(norm('   ')).toBeNull()
    expect(norm(undefined)).toBeNull()
    expect(norm(42)).toBeNull()
  })
})
