import { describe, it, expect } from 'vitest'
import { modalKeyAction } from './logic'

describe('modalKeyAction', () => {
  it('Esc closes, wherever focus is', () => {
    expect(modalKeyAction('Escape', false, 1, 3)).toBe('close')
    expect(modalKeyAction('Escape', true, -1, 0)).toBe('close')
  })

  it('Tab on the last focusable wraps to the first; inside, the browser moves focus', () => {
    expect(modalKeyAction('Tab', false, 2, 3)).toEqual({ focus: 0 })
    expect(modalKeyAction('Tab', false, 0, 3)).toBeNull()
    expect(modalKeyAction('Tab', false, 1, 3)).toBeNull()
  })

  it('Shift+Tab on the first focusable wraps to the last', () => {
    expect(modalKeyAction('Tab', true, 0, 3)).toEqual({ focus: 2 })
    expect(modalKeyAction('Tab', true, 2, 3)).toBeNull()
  })

  it('pulls focus from outside the focusables back in', () => {
    expect(modalKeyAction('Tab', false, -1, 3)).toEqual({ focus: 0 })
    expect(modalKeyAction('Tab', true, -1, 3)).toEqual({ focus: 2 })
  })

  it('a single focusable keeps focus; none keeps it on the dialog', () => {
    expect(modalKeyAction('Tab', false, 0, 1)).toEqual({ focus: 0 })
    expect(modalKeyAction('Tab', true, 0, 1)).toEqual({ focus: 0 })
    expect(modalKeyAction('Tab', false, -1, 0)).toEqual({ focus: -1 })
  })

  it('ignores other keys', () => {
    for (const k of ['Enter', ' ', 'ArrowDown', 'a', 'Home']) expect(modalKeyAction(k, false, 0, 3)).toBeNull()
  })
})
