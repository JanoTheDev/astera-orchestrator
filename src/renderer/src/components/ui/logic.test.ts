import { describe, it, expect } from 'vitest'
import {
  contextMenuPoint, isTypeaheadKey, listboxKeyAction, menuKeyAction, moveIndex, nextFocusIndex, readSectionOpen, sectionStorageKey,
  TYPEAHEAD_PAUSE_MS, typeaheadBuffer, typeaheadIndex, writeSectionOpen
} from './logic'

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

describe('moveIndex', () => {
  const none = [false, false, false, false]
  it('steps and wraps over enabled rows, Home/End jump', () => {
    expect(moveIndex(0, none, 'next')).toBe(1)
    expect(moveIndex(3, none, 'next')).toBe(0)
    expect(moveIndex(0, none, 'prev')).toBe(3)
    expect(moveIndex(2, none, 'first')).toBe(0)
    expect(moveIndex(0, none, 'last')).toBe(3)
  })

  it('skips disabled rows, also for Home/End', () => {
    const dis = [true, false, true, false]
    expect(moveIndex(1, dis, 'next')).toBe(3)
    expect(moveIndex(3, dis, 'next')).toBe(1)
    expect(moveIndex(1, dis, 'prev')).toBe(3)
    expect(moveIndex(3, dis, 'first')).toBe(1)
    expect(moveIndex(1, [false, true, true], 'last')).toBe(0)
  })

  it('from nowhere: next is the first enabled, prev the last; none enabled is -1', () => {
    expect(moveIndex(-1, [true, false, false], 'next')).toBe(1)
    expect(moveIndex(-1, [false, false, true], 'prev')).toBe(1)
    expect(moveIndex(0, [true, true], 'next')).toBe(-1)
    expect(moveIndex(0, [], 'first')).toBe(-1)
  })
})

describe('typeahead', () => {
  const labels = ['Apple', 'Banana', 'blueberry', 'Cherry', 'Avocado']
  const none = labels.map(() => false)

  it('a single key cycles through the rows starting with it, after the current one', () => {
    expect(typeaheadIndex(labels, none, 'b', 0)).toBe(1)
    expect(typeaheadIndex(labels, none, 'b', 1)).toBe(2)
    expect(typeaheadIndex(labels, none, 'b', 2)).toBe(1)
    expect(typeaheadIndex(labels, none, 'a', 0)).toBe(4)
  })

  it('a longer query stays on the current row while it still matches, case-insensitively', () => {
    expect(typeaheadIndex(labels, none, 'BL', 2)).toBe(2)
    expect(typeaheadIndex(labels, none, 'ch', 0)).toBe(3)
  })

  it('a run of one repeated letter cycles like a single key', () => {
    expect(typeaheadIndex(labels, none, 'bb', 1)).toBe(2)
  })

  it('skips disabled rows; no match is -1', () => {
    expect(typeaheadIndex(labels, [false, true, false, false, false], 'b', 0)).toBe(2)
    expect(typeaheadIndex(labels, none, 'z', 0)).toBe(-1)
    expect(typeaheadIndex(labels, none, '', 0)).toBe(-1)
  })

  it('the buffer grows within the pause and restarts after it', () => {
    expect(typeaheadBuffer('', 0, 'b', 1000)).toBe('b')
    expect(typeaheadBuffer('b', 1000, 'l', 1200)).toBe('bl')
    expect(typeaheadBuffer('bl', 1200, 'c', 1200 + TYPEAHEAD_PAUSE_MS + 1)).toBe('c')
  })

  it('only printable keys without Ctrl/Alt/Meta type ahead', () => {
    expect(isTypeaheadKey({ key: 'a', ctrlKey: false, altKey: false, metaKey: false })).toBe(true)
    expect(isTypeaheadKey({ key: 'a', ctrlKey: true, altKey: false, metaKey: false })).toBe(false)
    expect(isTypeaheadKey({ key: 'ArrowDown', ctrlKey: false, altKey: false, metaKey: false })).toBe(false)
    expect(isTypeaheadKey({ key: ' ', ctrlKey: false, altKey: false, metaKey: false })).toBe(false)
  })
})

describe('listboxKeyAction', () => {
  it('closed: Enter, Space and the arrows open; other keys are not ours', () => {
    for (const k of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) expect(listboxKeyAction(k, false)).toBe('open')
    expect(listboxKeyAction('Escape', false)).toBeNull()
    expect(listboxKeyAction('Home', false)).toBeNull()
  })

  it('open: arrows and Home/End move, Enter/Space pick, Esc closes, Tab leaves', () => {
    expect(listboxKeyAction('ArrowDown', true)).toEqual({ move: 'next' })
    expect(listboxKeyAction('ArrowUp', true)).toEqual({ move: 'prev' })
    expect(listboxKeyAction('Home', true)).toEqual({ move: 'first' })
    expect(listboxKeyAction('End', true)).toEqual({ move: 'last' })
    expect(listboxKeyAction('Enter', true)).toBe('commit')
    expect(listboxKeyAction(' ', true)).toBe('commit')
    expect(listboxKeyAction('Escape', true)).toBe('close')
    expect(listboxKeyAction('Tab', true)).toBe('tab')
    expect(listboxKeyAction('x', true)).toBeNull()
  })
})

describe('menuKeyAction', () => {
  it('arrows and Home/End move, Enter/Space activate, Esc closes, Tab leaves', () => {
    expect(menuKeyAction('ArrowDown')).toEqual({ move: 'next' })
    expect(menuKeyAction('ArrowUp')).toEqual({ move: 'prev' })
    expect(menuKeyAction('Home')).toEqual({ move: 'first' })
    expect(menuKeyAction('End')).toEqual({ move: 'last' })
    expect(menuKeyAction('Enter')).toBe('activate')
    expect(menuKeyAction(' ')).toBe('activate')
    expect(menuKeyAction('Escape')).toBe('close')
    expect(menuKeyAction('Tab')).toBe('tab')
    expect(menuKeyAction('ArrowLeft')).toBeNull()
  })
})

describe('contextMenuPoint', () => {
  const rect = { left: 40, bottom: 90 }
  it('a pointer opens at the pointer', () => {
    expect(contextMenuPoint({ clientX: 120, clientY: 300, pointerType: 'mouse' }, rect)).toEqual({ x: 120, y: 300 })
  })
  it('Shift+F10 / the ContextMenu key opens under the focused element', () => {
    expect(contextMenuPoint({ clientX: 0, clientY: 0 }, rect)).toEqual({ x: 40, y: 90 })
    expect(contextMenuPoint({ clientX: 55, clientY: 70, pointerType: '' }, rect)).toEqual({ x: 40, y: 90 })
  })
})
