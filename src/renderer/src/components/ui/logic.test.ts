import { describe, it, expect } from 'vitest'
import {
  contextMenuPoint, FOCUSABLE, isTypeaheadKey, listboxKeyAction, menuKeyAction, moveIndex, nextFocusIndex, readSectionOpen, sectionStorageKey,
  TYPEAHEAD_PAUSE_MS, typeaheadBuffer, typeaheadIndex, writeSectionOpen, readPaneSize, writePaneSize, resizePair, pairWeights, sashSize, sashKeyDelta, badgeText
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

describe('FOCUSABLE', () => {
  it('leaves out every part a roving row (tabindex -1) would match, so a modal trap ends on a Tab stop', () => {
    for (const part of FOCUSABLE.split(',')) expect(part).toContain(':not([tabindex="-1"])')
  })
})

describe('Sash and ActivityBarItem helpers', () => {
  it('sashSize clamps the dragged size to [min, max]; reverse grows toward the start', () => {
    expect(sashSize(260, 40, 170, 600)).toBe(300)
    expect(sashSize(260, -200, 170, 600)).toBe(170)
    expect(sashSize(260, 1000, 170, 600)).toBe(600)
    expect(sashSize(300, -50, 100, 800, true)).toBe(350)
    expect(sashSize(300, 0.6, 100, 800)).toBe(301)
  })

  it('sashKeyDelta steps 8px on its own axis only', () => {
    expect(sashKeyDelta('ArrowRight', 'vertical')).toBe(8)
    expect(sashKeyDelta('ArrowLeft', 'vertical')).toBe(-8)
    expect(sashKeyDelta('ArrowUp', 'vertical')).toBe(0)
    expect(sashKeyDelta('ArrowDown', 'horizontal')).toBe(8)
    expect(sashKeyDelta('ArrowUp', 'horizontal')).toBe(-8)
    expect(sashKeyDelta('Enter', 'horizontal')).toBe(0)
  })

  it('badgeText hides 0, shows up to 9, then "9+"', () => {
    expect(badgeText(0)).toBe('')
    expect(badgeText(undefined)).toBe('')
    expect(badgeText(-2)).toBe('')
    expect(badgeText(1)).toBe('1')
    expect(badgeText(9)).toBe('9')
    expect(badgeText(10)).toBe('9+')
    expect(badgeText(250)).toBe('9+')
  })

  it('resizePair trades height only between the divider neighbours and clamps to the minimum', () => {
    const o = [true, true, true]
    expect(resizePair([200, 300, 100], o, 1, 350, 40)).toEqual([150, 350, 100])
    expect(resizePair([200, 300, 100], o, 1, 10, 40)).toEqual([460, 40, 100])
    expect(resizePair([200, 300, 100], o, 2, 999, 40)).toEqual([200, 40, 360])
    expect(resizePair([200, 300], [true, true], 0, 50, 40)).toEqual([200, 300])
  })

  it('resizePair skips collapsed panes, leaves them and every third pane untouched, and keeps the sum', () => {
    const h = [200, 22, 300, 100]
    const out = resizePair(h, [true, false, true, true], 2, 250, 40)
    expect(out).toEqual([250, 22, 250, 100])
    expect(out.reduce((a, b) => a + b)).toBe(h.reduce((a, b) => a + b))
    expect(resizePair(h, [false, false, true, true], 2, 250, 40)).toEqual(h) // nothing open above
    expect(resizePair(h, [true, false, false, true], 2, 250, 40)).toEqual(h) // a collapsed pane has no sash
  })

  it('pairWeights keeps the pair\'s combined weight so a default-flex third pane keeps its height', () => {
    // three unsaved panes at flex-grow 1 over 600px; the divider between 0 and 1 moves 50px
    const [a, b] = pairWeights([1, 1], [250, 150])
    expect(a + b).toBeCloseTo(2)
    const free = 600
    const third = (1 / (a + b + 1)) * free
    expect(third).toBeCloseTo(200)
    expect((a / (a + b + 1)) * free).toBeCloseTo(250)
    // one saved weight (300) next to an unsaved one (grow 1): the total stays 301
    expect(pairWeights([300, 1], [100, 100])).toEqual([150.5, 150.5])
  })

  it('pairWeights puts a content-sized pane on the flex scale without moving a third pane', () => {
    // a 600px column: THIS content-sized (flex: none, 100px), YOURS and FOUND at grow 1 over the remaining 500px
    const px = 250
    const [a, b] = pairWeights([0, 1], [70, 280], px) // the divider moves 30px up
    const found = 1
    const free = 600 // THIS is flex-basis 0 now, so the flex panes share the whole column
    const share = (w: number): number => (w / (a + b + found)) * free
    expect(share(a)).toBeCloseTo(70)
    expect(share(b)).toBeCloseTo(280)
    expect(share(found)).toBeCloseTo(250)
  })

  it('pane weights round-trip through storage and ignore junk', () => {
    const m = new Map<string, string>()
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    expect(readPaneSize(s, 'a')).toBeUndefined()
    writePaneSize(s, 'a', 1.23456)
    expect(m.get('cm.section.a.weight')).toBe('1.235')
    expect(readPaneSize(s, 'a')).toBe(1.235) // weights are fractions of a flex-grow unit
    m.set('cm.section.a.weight', 'x')
    expect(readPaneSize(s, 'a')).toBeUndefined()
    expect(readPaneSize(undefined, 'a')).toBeUndefined()
  })

  it('ignores the px-scale .size value the old code saved', () => {
    const m = new Map<string, string>([['cm.section.a.size', '300']])
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    expect(readPaneSize(s, 'a')).toBeUndefined() // a 300 flex-grow sibling would squash its neighbour to ~0
  })
})
