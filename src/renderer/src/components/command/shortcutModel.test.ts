import { describe, expect, it } from 'vitest'
import { makeActions, resolveBindings } from '../../../../core/keys/binding'
import { conflictsOf, shortcutMatches, sourceOf, takenBy } from './shortcutModel'

const ACTIONS = makeActions('linux')

describe('sourceOf', () => {
  it('is default until the person sets keys, and user once they have (an empty list too)', () => {
    expect(sourceOf({}, 'palette.open')).toBe('default')
    expect(sourceOf({ 'palette.open': ['Ctrl+K'] }, 'palette.open')).toBe('user')
    expect(sourceOf({ 'palette.open': [] }, 'palette.open')).toBe('user')
    expect(sourceOf({ 'palette.open': ['Ctrl+K'] }, 'quickOpen')).toBe('default')
  })
})

describe('takenBy', () => {
  const bindings = resolveBindings({}, ACTIONS)
  it('names the other action that holds the chord', () => {
    expect(takenBy(bindings, ACTIONS, 'quickOpen', 'Ctrl+Shift+P')?.id).toBe('palette.open')
  })
  it('does not count the action itself, or a free chord', () => {
    expect(takenBy(bindings, ACTIONS, 'palette.open', 'Ctrl+Shift+P')).toBeUndefined()
    expect(takenBy(bindings, ACTIONS, 'quickOpen', 'Ctrl+Alt+Shift+Q')).toBeUndefined()
  })
})

describe('conflictsOf', () => {
  it('has none for the defaults', () => expect(conflictsOf(resolveBindings({}, ACTIONS), ACTIONS).size).toBe(0))
  it('lists, for each action of a clash, the chord and the others holding it', () => {
    const c = conflictsOf(resolveBindings({ quickOpen: ['Ctrl+Shift+P'] }, ACTIONS), ACTIONS)
    expect(c.get('quickOpen')).toEqual([{ key: 'Ctrl+Shift+P', others: ['palette.open'] }])
    expect(c.get('palette.open')).toEqual([{ key: 'Ctrl+Shift+P', others: ['quickOpen'] }])
  })
})

describe('shortcutMatches', () => {
  it('finds a command by name or chord, any case and word order', () => {
    expect(shortcutMatches('palette open', 'Open the command palette', ['Ctrl+Shift+P'])).toBe(true)
    expect(shortcutMatches('ctrl shift p', 'Open the command palette', ['Ctrl+Shift+P'])).toBe(true)
    expect(shortcutMatches('zzz', 'Open the command palette', ['Ctrl+Shift+P'])).toBe(false)
  })
  it('keeps everything for an empty search', () => expect(shortcutMatches('  ', 'x', [])).toBe(true))
})
