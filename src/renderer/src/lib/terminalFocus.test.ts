import { describe, it, expect } from 'vitest'
import { terminalMayTakeFocus, type FocusedElement } from './terminalFocus'

/** An element whose ancestors match the given selectors. */
const el = (tagName: string, inside: string[] = [], isContentEditable = false): FocusedElement => ({
  tagName,
  isContentEditable,
  closest: (selector) => (inside.includes(selector) ? {} : null)
})

describe('terminalMayTakeFocus (W4: a worker tab must not take the command bar’s keyboard)', () => {
  it('never takes focus from the command bar, a dialog, or a field being typed in', () => {
    expect(terminalMayTakeFocus(el('INPUT', ['[role="dialog"]']))).toBe(false) // the command bar
    expect(terminalMayTakeFocus(el('BUTTON', ['[role="dialog"]']))).toBe(false) // a confirmation dialog
    expect(terminalMayTakeFocus(el('input'))).toBe(false)
    expect(terminalMayTakeFocus(el('TEXTAREA'))).toBe(false)
    expect(terminalMayTakeFocus(el('SELECT'))).toBe(false)
    expect(terminalMayTakeFocus(el('DIV', [], true))).toBe(false)
  })

  it('takes it from nothing, the page, a clicked tab, or another terminal', () => {
    expect(terminalMayTakeFocus(null)).toBe(true)
    expect(terminalMayTakeFocus(el('BODY'))).toBe(true)
    expect(terminalMayTakeFocus(el('BUTTON'))).toBe(true)
    expect(terminalMayTakeFocus(el('TEXTAREA', ['.xterm']))).toBe(true)
  })
})
