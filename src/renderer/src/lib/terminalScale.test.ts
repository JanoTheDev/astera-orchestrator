// A terminal pane whose pty size another computer may own: the owner fits the pty at the base font, any other pane
// shows it whole at a smaller font (core/terminal/viewSize.ts decides; this applies it to an xterm).
import { describe, it, expect } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { BASE_FONT, PaneSize, SentSizes, showOwn, showPty, wantedOf } from './terminalScale'

/** An xterm whose cell scales with its font: 8 x 17 at 14px. */
const fakeTerm = (cols = 80, rows = 24) => {
  const t = {
    cols,
    rows,
    options: { fontSize: BASE_FONT },
    resize(c: number, r: number) {
      t.cols = c
      t.rows = r
    },
    get _core() {
      const k = t.options.fontSize / BASE_FONT
      return { _renderService: { dimensions: { css: { cell: { width: 8 * k, height: 17 * k } } } } }
    }
  }
  return t
}
const host = (width: number, height: number) => ({ clientWidth: width, clientHeight: height }) as HTMLElement
const asTerm = (t: ReturnType<typeof fakeTerm>) => t as unknown as Terminal

describe('wantedOf', () => {
  it('is the grid the pane holds at the base font, also while the font is scaled down', () => {
    const t = fakeTerm()
    expect(wantedOf(asTerm(t), host(800, 340))).toEqual({ cols: 100, rows: 20 })
    t.options.fontSize = 7
    expect(wantedOf(asTerm(t), host(800, 340))).toEqual({ cols: 100, rows: 20 })
  })

  it('is null for a pane that is not on screen', () => {
    expect(wantedOf(asTerm(fakeTerm()), host(0, 0))).toBeNull()
  })
})

describe('showPty and showOwn', () => {
  it('shows a larger pty whole at a smaller font, then the own grid at the base font again', () => {
    const t = fakeTerm()
    showPty(asTerm(t), host(800, 340), { cols: 160, rows: 20 })
    expect([t.cols, t.rows, t.options.fontSize]).toEqual([160, 20, 8])
    expect(showOwn(asTerm(t), host(800, 340))).toEqual({ cols: 100, rows: 20 })
    expect([t.cols, t.rows, t.options.fontSize]).toEqual([100, 20, BASE_FONT])
  })

  it('keeps the base font for a smaller pty', () => {
    const t = fakeTerm()
    showPty(asTerm(t), host(800, 340), { cols: 60, rows: 10 })
    expect([t.cols, t.rows, t.options.fontSize]).toEqual([60, 10, BASE_FONT])
  })
})

// The pane's own resizes come back from the Host as the pty's size, possibly behind a newer one it already sent: those
// are its own echoes, not another computer taking the size.
describe('SentSizes', () => {
  it('knows the sizes it sent recently', () => {
    const s = new SentSizes()
    s.add({ cols: 100, rows: 20 })
    s.add({ cols: 110, rows: 22 })
    expect(s.has({ cols: 100, rows: 20 })).toBe(true)
    expect(s.has({ cols: 90, rows: 20 })).toBe(false)
  })

  it('keeps only the newest few', () => {
    const s = new SentSizes()
    for (let i = 0; i < 20; i += 1) s.add({ cols: 100 + i, rows: 20 })
    expect(s.has({ cols: 100, rows: 20 })).toBe(false)
    expect(s.has({ cols: 119, rows: 20 })).toBe(true)
  })
})

// Whether this pane owns the pty's size, from what the Host says: its own sizes echoed back keep it, another size
// means another computer typed last; a controller's resize answer says it outright.
describe('PaneSize', () => {
  it('owns the size until the Host reports a size it did not send', () => {
    const p = new PaneSize()
    p.sent({ cols: 100, rows: 20 })
    p.sent({ cols: 110, rows: 22 })
    p.heard({ cols: 100, rows: 20 }) // an echo behind the newer one
    expect(p.owned).toBe(true)
    expect(p.shows()).toBe('own')
    p.heard({ cols: 90, rows: 30 })
    expect(p.owned).toBe(false)
    expect(p.shows()).toEqual({ cols: 90, rows: 30 })
    expect(p.note({ cols: 110, rows: 22 })).toBe(true)
    p.heard({ cols: 110, rows: 22 }) // typed here: the Host gave it the size it asked for
    expect(p.owned).toBe(true)
    expect(p.note({ cols: 110, rows: 22 })).toBe(false)
  })

  it('takes a resize answer as the word on who owns it', () => {
    const p = new PaneSize()
    p.heard({ cols: 90, rows: 30 })
    p.answered(false)
    expect(p.shows()).toEqual({ cols: 90, rows: 30 })
    p.answered(true)
    expect(p.shows()).toBe('own')
  })

  it('shows its own grid while the size is unknown, and says nothing when the sizes agree', () => {
    const p = new PaneSize()
    expect(p.shows()).toBe('own')
    p.heard({ cols: 100, rows: 20 })
    p.answered(false)
    expect(p.note({ cols: 100, rows: 20 })).toBe(false)
  })
})
