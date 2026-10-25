import { describe, expect, it } from 'vitest'
import { terminalKeyAction, terminalMenuEntries } from './terminalMenu'

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  type: 'keydown',
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

describe('terminalMenuEntries', () => {
  it('lists copy, paste, select all, clear and find, with copy disabled without a selection', () => {
    const entries = terminalMenuEntries(false)
    expect(entries.map((e) => (e === 'separator' ? e : e.action))).toEqual([
      'copy', 'paste', 'separator', 'selectAll', 'clear', 'separator', 'find'
    ])
    expect(entries[0]).toEqual({ action: 'copy', disabled: true })
  })

  it('enables copy with a selection', () => {
    expect(terminalMenuEntries(true)[0]).toEqual({ action: 'copy', disabled: false })
  })
})

describe('terminalKeyAction', () => {
  it('maps Ctrl+C / Ctrl+V on Linux and Windows', () => {
    expect(terminalKeyAction(key('c', { ctrlKey: true }), false)).toBe('copy')
    expect(terminalKeyAction(key('V', { ctrlKey: true }), false)).toBe('paste')
    expect(terminalKeyAction(key('v', { ctrlKey: true, shiftKey: true }), false)).toBe('paste')
  })

  it('maps Cmd+C / Cmd+V on macOS and leaves Ctrl+C as the interrupt', () => {
    expect(terminalKeyAction(key('c', { metaKey: true }), true)).toBe('copy')
    expect(terminalKeyAction(key('v', { metaKey: true }), true)).toBe('paste')
    expect(terminalKeyAction(key('c', { ctrlKey: true }), true)).toBeNull()
  })

  it('does not claim Ctrl+Shift+C, Alt combos, keyups or the other platform modifier', () => {
    expect(terminalKeyAction(key('c', { ctrlKey: true, shiftKey: true }), false)).toBeNull()
    expect(terminalKeyAction(key('c', { ctrlKey: true, altKey: true }), false)).toBeNull()
    expect(terminalKeyAction({ ...key('c', { ctrlKey: true }), type: 'keyup' }, false)).toBeNull()
    expect(terminalKeyAction(key('c', { ctrlKey: true, metaKey: true }), false)).toBeNull()
  })

  it('opens find with Ctrl+Shift+F (Cmd+F on macOS), and Ctrl+F only where plainFind is set', () => {
    expect(terminalKeyAction(key('F', { ctrlKey: true, shiftKey: true }), false)).toBe('find')
    expect(terminalKeyAction(key('f', { ctrlKey: true }), false)).toBeNull()
    expect(terminalKeyAction(key('f', { ctrlKey: true }), false, true)).toBe('find')
    expect(terminalKeyAction(key('f', { metaKey: true }), true)).toBe('find')
    expect(terminalKeyAction(key('f', { metaKey: true, shiftKey: true }), true)).toBeNull()
  })
})
