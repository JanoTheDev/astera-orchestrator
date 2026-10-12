// A terminal pane whose pty size another computer may own (the Host gives the size to the side that typed last). The
// owner's pane fits the pty at the base font; any other pane shows it whole at the largest font that fits
// (core/terminal/viewSize.ts), instead of cutting off the rows below it, which is where Claude's prompt is.
import type { Terminal } from '@xterm/xterm'
import type { Dims } from '../../../core/terminal/resize'
import { gridFor, sameDims, scaledFont, type Area } from '../../../core/terminal/viewSize'

/** The terminal font every pane is built with, and the smallest a pane shrinks a larger pty to. */
export const BASE_FONT = 14
export const MIN_FONT = 6

type WithRenderService = {
  _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } }
}

/** The cell at the base font: the cell xterm measured, scaled back from the font it has now. */
function baseCell(term: Terminal): Area | null {
  const cell = (term as unknown as WithRenderService)._core?._renderService?.dimensions?.css?.cell
  if (!cell?.width || !cell.height) return null
  const k = BASE_FONT / (term.options.fontSize ?? BASE_FONT)
  return { width: cell.width * k, height: cell.height * k }
}

const areaOf = (host: HTMLElement): Area | null =>
  host.clientWidth && host.clientHeight ? { width: host.clientWidth, height: host.clientHeight } : null

/** The grid this pane holds at the base font: the size it asks the pty for. Null off screen or before the first
 *  render, when a measure would be a 2x1 grid (fitTerminal.ts says why that is fatal). */
export function wantedOf(term: Terminal, host: HTMLElement): Dims | null {
  const area = areaOf(host)
  const cell = baseCell(term)
  return area && cell ? gridFor(area, cell) : null
}

/** Shows the pty at its own size, at the largest font that fits this pane. */
export function showPty(term: Terminal, host: HTMLElement, pty: Dims): void {
  const area = areaOf(host)
  const cell = baseCell(term)
  if (!area || !cell) return
  const font = scaledFont({ pty, area, baseCell: cell, baseFont: BASE_FONT, minFont: MIN_FONT })
  if (term.options.fontSize !== font) term.options.fontSize = font
  if (term.cols !== pty.cols || term.rows !== pty.rows) term.resize(pty.cols, pty.rows)
}

/** Shows this pane's own grid at the base font (it owns the size), and returns that grid, or null off screen. */
export function showOwn(term: Terminal, host: HTMLElement): Dims | null {
  const wanted = wantedOf(term, host)
  if (!wanted) return null
  if (term.options.fontSize !== BASE_FONT) term.options.fontSize = BASE_FONT
  if (term.cols !== wanted.cols || term.rows !== wanted.rows) term.resize(wanted.cols, wanted.rows)
  return wanted
}

/** The sizes a pane sent lately. The Host answers each with the pty's size, sometimes behind a newer one already
 *  sent (a window being dragged): a size found here is the pane's own echo, not another computer taking the size. */
export class SentSizes {
  private readonly sizes: Dims[] = []
  add(d: Dims): void {
    this.sizes.push(d)
    if (this.sizes.length > 8) this.sizes.shift()
  }
  has(d: Dims): boolean {
    return this.sizes.some((s) => sameDims(s, d))
  }
}

/** Whether a pane owns its pty's size, from what the Host says, and so how it shows the pty. */
export class PaneSize {
  /** True until the Host says otherwise: a pty nobody else ever resized follows its app as it always did. */
  owned = true
  /** The pty's size as the Host last reported it, or null before any report. */
  pty: Dims | null = null
  private readonly recent = new SentSizes()

  /** This pane asked for `d`. */
  sent(d: Dims): void {
    this.recent.add(d)
  }

  /** The Host says the pty has `d`: one of this pane's own sizes keeps it the owner, any other means another computer
   *  typed last. */
  heard(d: Dims): void {
    this.pty = d
    this.owned = this.recent.has(d)
  }

  /** A controller's resize answer: applied or kept for later. */
  answered(applied: boolean): void {
    this.owned = applied
  }

  /** What the pane draws: its own grid (`'own'`), or the pty's size, scaled. */
  shows(): 'own' | Dims {
    return this.owned || this.pty === null ? 'own' : this.pty
  }

  /** Whether the pane says whose window it follows: shown at another size than its own. */
  note(wanted: Dims | null): boolean {
    return !this.owned && this.pty !== null && wanted !== null && !sameDims(this.pty, wanted)
  }
}
