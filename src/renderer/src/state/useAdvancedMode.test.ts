import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADVANCED_MODE_KEY, getAdvancedMode, resetAdvancedMode, setAdvancedMode } from './useAdvancedMode'

const mem = (): Storage => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as Storage
}

describe('useAdvancedMode store', () => {
  let storage: Storage
  beforeEach(() => {
    storage = mem()
    vi.stubGlobal('localStorage', storage)
    resetAdvancedMode()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetAdvancedMode()
  })

  it('is off by default', () => {
    expect(getAdvancedMode()).toBe(false)
  })
  it('persists the switch and reads it back after a reload', () => {
    setAdvancedMode(true)
    expect(storage.getItem(ADVANCED_MODE_KEY)).toBe('1')
    resetAdvancedMode()
    expect(getAdvancedMode()).toBe(true)
    setAdvancedMode(false)
    resetAdvancedMode()
    expect(getAdvancedMode()).toBe(false)
  })
  it('still works without storage', () => {
    vi.stubGlobal('localStorage', undefined)
    resetAdvancedMode()
    setAdvancedMode(true)
    expect(getAdvancedMode()).toBe(true)
  })
})
