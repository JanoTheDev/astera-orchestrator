// W5-C: the command bar closes on a pointer-down away from it and on Escape from anywhere (owner report: after a click
// into a terminal it could not be closed), but never while the app's confirmation dialog is up.
import { describe, expect, it, vi } from 'vitest'
import { armBarClose } from './barClose'

const BAR = new EventTarget()
const OUTSIDE = new EventTarget()

const setup = (confirmOpen = false) => {
  const win = new EventTarget()
  const close = vi.fn()
  const state = { confirmOpen }
  const off = armBarClose(win, { inside: (n) => n === BAR, confirmOpen: () => state.confirmOpen, close })
  // Dispatched on the window as if it came from `from`: the listener reads `target`, which a capture on the window sees
  const pointer = (from: EventTarget): void => {
    const e = new Event('pointerdown')
    Object.defineProperty(e, 'target', { value: from })
    win.dispatchEvent(e)
  }
  const key = (k: string, isComposing = false): Event => {
    const e = Object.assign(new Event('keydown', { cancelable: true }), { key: k, isComposing })
    win.dispatchEvent(e)
    return e
  }
  return { close, off, pointer, key, state }
}

describe('armBarClose', () => {
  it('closes on a pointer-down outside the bar, not inside it', () => {
    const h = setup()
    h.pointer(BAR)
    expect(h.close).not.toHaveBeenCalled()
    h.pointer(OUTSIDE)
    expect(h.close).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape from anywhere and keeps that Escape from reaching a terminal', () => {
    const h = setup()
    expect(h.key('a').defaultPrevented).toBe(false)
    expect(h.close).not.toHaveBeenCalled()
    const esc = h.key('Escape')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(esc.defaultPrevented).toBe(true)
    // An Escape that ends an IME composition is the IME's
    h.key('Escape', true)
    expect(h.close).toHaveBeenCalledTimes(1)
  })

  it('does nothing while the confirmation dialog is open', () => {
    const h = setup(true)
    h.pointer(OUTSIDE)
    const esc = h.key('Escape')
    expect(h.close).not.toHaveBeenCalled()
    // The dialog's own Escape handler gets it
    expect(esc.defaultPrevented).toBe(false)
    h.state.confirmOpen = false
    h.key('Escape')
    expect(h.close).toHaveBeenCalledTimes(1)
  })

  it('stops listening once disarmed', () => {
    const h = setup()
    h.off()
    h.pointer(OUTSIDE)
    h.key('Escape')
    expect(h.close).not.toHaveBeenCalled()
  })
})
