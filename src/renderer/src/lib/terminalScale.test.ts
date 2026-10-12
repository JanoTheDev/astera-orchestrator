// A terminal pane whose pty size another computer may own: the owner fits the pty at the base font, any other pane
// shows it whole at a smaller font (core/terminal/viewSize.ts estimates; this measures and applies it to an xterm).
import { describe, it, expect } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { BASE_FONT, NOTE_RESERVE_PX, PaneSize, SentSizes, showOwn, showPty, wantedOf } from './terminalScale'

/** An xterm whose cell follows its font the way xterm 6 measures one: the width in proportion, the height rounded up
 *  (`ceil(charHeight * dpr)`), so a smaller font does not shrink the cell in proportion (final review C1, C2). */
const fakeTerm = (cols = 80, rows = 24) => {
  const t = {
    cols,
    rows,
    options: { fontSize: BASE_FONT, fontFamily: 'mono' },
    resize(c: number, r: number) {
      t.cols = c
      t.rows = r
    },
    get _core() {
      const f = t.options.fontSize
      return { _renderService: { dimensions: { css: { cell: { width: f * 0.6, height: Math.ceil(f * 1.172) } } } } }
    }
  }
  return t
}
const host = (width: number, height: number) => ({ clientWidth: width, clientHeight: height }) as HTMLElement
const asTerm = (t: ReturnType<typeof fakeTerm>) => t as unknown as Terminal
const cellH = (f: number) => Math.ceil(f * 1.172)

describe('wantedOf', () => {
  it('is the grid the pane holds at the base font', () => {
    // 14px: 8.4 x 17 cells.
    expect(wantedOf(asTerm(fakeTerm()), host(840, 340))).toEqual({ cols: 100, rows: 20 })
  })

  // C1: the grid asked for while the pty is shown scaled is the base font's, measured, not scaled back in proportion
  // from the scaled cell; otherwise each scale changed it and every answer sent another resize.
  it('stays the same while the pty is shown at a smaller font', () => {
    const t = fakeTerm()
    const h = host(800, 740)
    const before = wantedOf(asTerm(t), h)
    showPty(asTerm(t), h, { cols: 100, rows: 50 })
    expect(t.options.fontSize).toBeLessThan(BASE_FONT)
    expect(wantedOf(asTerm(t), h)).toEqual(before)
    showPty(asTerm(t), h, { cols: 100, rows: 60 })
    expect(wantedOf(asTerm(t), h)).toEqual(before)
  })

  it('is null for a pane that is not on screen', () => {
    expect(wantedOf(asTerm(fakeTerm()), host(0, 0))).toBeNull()
  })
})

describe('showPty', () => {
  // C2: the font is the largest whose measured cell fits every row and column, not one estimated in proportion.
  it('shows a larger pty whole: every row and column fits the pane at the font it picks', () => {
    for (const [w, h, cols, rows] of [[800, 740, 100, 50], [800, 740, 160, 40], [1200, 700, 200, 61], [640, 480, 120, 44]]) {
      const t = fakeTerm()
      showPty(asTerm(t), host(w, h), { cols, rows })
      const f = t.options.fontSize
      expect([t.cols, t.rows]).toEqual([cols, rows])
      expect(cols * f * 0.6).toBeLessThanOrEqual(w)
      expect(rows * cellH(f)).toBeLessThanOrEqual(h)
      // The largest such font: one step up would not fit.
      if (f < BASE_FONT) expect(cols * (f + 1) * 0.6 > w || rows * cellH(f + 1) > h).toBe(true)
    }
  })

  // I8: the note sits over the bottom of the pane; the rows are fitted above it.
  it('keeps the rows above a reserved strip for the note', () => {
    const t = fakeTerm()
    showPty(asTerm(t), host(800, 740), { cols: 80, rows: 42 }, NOTE_RESERVE_PX)
    expect(42 * cellH(t.options.fontSize)).toBeLessThanOrEqual(740 - NOTE_RESERVE_PX)
  })

  it('keeps the base font for a smaller pty', () => {
    const t = fakeTerm()
    showPty(asTerm(t), host(840, 340), { cols: 60, rows: 10 })
    expect([t.cols, t.rows, t.options.fontSize]).toEqual([60, 10, BASE_FONT])
  })
})

describe('showOwn', () => {
  // I3: taking the size back draws the grid measured at the base font, whatever font the pane was scaled to.
  it('draws the base font grid after a scaled view', () => {
    const t = fakeTerm()
    const h = host(800, 740)
    const own = wantedOf(asTerm(t), h)
    showPty(asTerm(t), h, { cols: 100, rows: 50 })
    expect(showOwn(asTerm(t), h)).toEqual(own)
    expect([t.cols, t.rows, t.options.fontSize]).toEqual([own!.cols, own!.rows, BASE_FONT])
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

describe('PaneSize', () => {
  // A local tab is told outright (the Host's `owned`), so a size it once dragged through is never taken for its own
  // (final review I7).
  it('takes the Host word on ownership when it gives one', () => {
    const p = new PaneSize()
    p.sent({ cols: 90, rows: 30 })
    p.sent({ cols: 110, rows: 22 })
    p.heard({ cols: 90, rows: 30 }, false)
    expect(p.owned).toBe(false)
    expect(p.shows()).toEqual({ cols: 90, rows: 30 })
    expect(p.note({ cols: 110, rows: 22 })).toBe(true)
    p.heard({ cols: 110, rows: 22 }, true)
    expect(p.shows()).toBe('own')
    expect(p.note({ cols: 110, rows: 22 })).toBe(false)
  })

  // A remote tab hears only sizes: while it owns the size its own echoes keep it, behind a newer one too; once it does
  // not, only the size it asked for last gives it back (another of its old sizes is someone else's window).
  it('without a word, keeps the size on its own echoes and takes it back only on its latest', () => {
    const p = new PaneSize()
    p.sent({ cols: 100, rows: 20 })
    p.sent({ cols: 110, rows: 22 })
    p.heard({ cols: 100, rows: 20 })
    expect(p.owned).toBe(true)
    p.heard({ cols: 90, rows: 30 })
    expect(p.owned).toBe(false)
    p.heard({ cols: 100, rows: 20 })
    expect(p.owned).toBe(false)
    p.heard({ cols: 110, rows: 22 })
    expect(p.owned).toBe(true)
  })

  // Minor 1: an answer to an older resize does not overrule what happened since.
  it('takes a resize answer only for the size it asked for last', () => {
    const p = new PaneSize()
    p.sent({ cols: 100, rows: 20 })
    p.sent({ cols: 110, rows: 22 })
    p.heard({ cols: 90, rows: 30 })
    p.answered({ cols: 100, rows: 20 }, { applied: true })
    expect(p.owned).toBe(false)
    p.answered({ cols: 110, rows: 22 }, { applied: false, reason: 'other', latest: true })
    expect(p.owned).toBe(false)
    expect(p.reason).toBe('other')
    expect(p.latest).toBe(true)
    p.answered({ cols: 110, rows: 22 }, { applied: true, latest: true })
    expect(p.owned).toBe(true)
  })

  // I6: a reconnect's checkpoint carries the pty's size; one that is not the size this tab asked for last means
  // someone else typed meanwhile.
  it('reads a checkpoint against the size it asked for last, and keeps its hope before it asked anything', () => {
    const first = new PaneSize()
    first.reset({ cols: 90, rows: 30 })
    expect(first.owned).toBe(true)
    const p = new PaneSize()
    p.sent({ cols: 110, rows: 22 })
    p.reset({ cols: 90, rows: 30 })
    expect(p.owned).toBe(false)
    p.reset({ cols: 110, rows: 22 })
    expect(p.owned).toBe(true)
  })

  it('shows its own grid while the size is unknown, and says nothing when the sizes agree', () => {
    const p = new PaneSize()
    expect(p.shows()).toBe('own')
    p.heard({ cols: 100, rows: 20 }, false)
    expect(p.note({ cols: 100, rows: 20 })).toBe(false)
  })
})
