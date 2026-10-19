import { describe, it, expect } from 'vitest'
import { nextFocusIndex, readSectionOpen, sectionStorageKey, writeSectionOpen } from './logic'

describe('nextFocusIndex', () => {
  it('moves with the arrows of its orientation and wraps', () => {
    expect(nextFocusIndex(0, 3, 'ArrowRight')).toBe(1)
    expect(nextFocusIndex(2, 3, 'ArrowRight')).toBe(0)
    expect(nextFocusIndex(0, 3, 'ArrowLeft')).toBe(2)
    expect(nextFocusIndex(1, 3, 'ArrowDown', 'vertical')).toBe(2)
    expect(nextFocusIndex(0, 3, 'ArrowUp', 'vertical')).toBe(2)
  })

  it('Home and End jump to the ends', () => {
    expect(nextFocusIndex(1, 4, 'Home')).toBe(0)
    expect(nextFocusIndex(1, 4, 'End')).toBe(3)
  })

  it('from no focus, next is the first and previous the last', () => {
    expect(nextFocusIndex(-1, 3, 'ArrowRight')).toBe(0)
    expect(nextFocusIndex(-1, 3, 'ArrowLeft')).toBe(2)
  })

  it('ignores the other axis, other keys and empty lists', () => {
    expect(nextFocusIndex(0, 3, 'ArrowDown')).toBeNull()
    expect(nextFocusIndex(0, 3, 'ArrowRight', 'vertical')).toBeNull()
    expect(nextFocusIndex(0, 3, 'Enter')).toBeNull()
    expect(nextFocusIndex(-1, 0, 'ArrowRight')).toBeNull()
  })
})

describe('section storage', () => {
  it('keys by id and round-trips', () => {
    const m = new Map<string, string>()
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    expect(sectionStorageKey('plans')).toBe('cm.section.plans')
    expect(readSectionOpen(s, 'plans', true)).toBe(true)
    writeSectionOpen(s, 'plans', false)
    expect(m.get('cm.section.plans')).toBe('0')
    expect(readSectionOpen(s, 'plans', true)).toBe(false)
  })

  it('falls back when storage is missing or throws', () => {
    const boom = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(readSectionOpen(boom, 'x', false)).toBe(false)
    expect(readSectionOpen(undefined, 'x', true)).toBe(true)
    expect(() => writeSectionOpen(boom, 'x', true)).not.toThrow()
  })
})
