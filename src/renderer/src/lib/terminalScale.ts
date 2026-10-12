// A terminal pane whose pty size another computer may own (the Host gives the size to the side that typed last). The
// owner's pane fits the pty at the base font; any other pane shows it whole at the largest font that fits, instead of
// cutting off the rows below it, which is where Claude's prompt is.
//
// **Measured, never scaled in proportion** (final review C1, C2): xterm rounds a cell's height up to whole device
// pixels, so a cell does not shrink in step with its font. A grid worked out from a scaled cell scaled back drifted with
// every font, and a font picked by proportion left the last row past the pane. Setting `fontSize` re-measures the cell
// at once (xterm's CharSizeService, then the DOM renderer's dimensions), so each font is tried and read back.
//
// **Never a 2x1 grid.** A pane that is not on screen (an inactive tab is display:none) measures 0, and a grid derived
// from that is 2x1, which looks legitimate to everything downstream: sent to a conpty it ended the agent (codex redrew
// one character per line and its pty ended with no exit code about a second later; three Job workers died that way).
// Everything here answers null off screen, and the callers send nothing then.
import type { Terminal } from '@xterm/xterm'
import type { Dims } from '../../../core/terminal/resize'
import { gridFor, sameDims, scaledFont, type Area } from '../../../core/terminal/viewSize'

/** The terminal font every pane is built with, and the smallest a pane shrinks a larger pty to. */
export const BASE_FONT = 14
export const MIN_FONT = 6
/** The strip at the bottom of a pane the note covers (`.remote-session-banners`: 8px off the bottom, one 12px line in
 *  4px padding), kept clear of rows while the note shows (final review I8). */
export const NOTE_RESERVE_PX = 32

type WithRenderService = {
  _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } }
}

/** The cell xterm measured at the font it has now, or null before the first render. */
function cellOf(term: Terminal): Area | null {
  const cell = (term as unknown as WithRenderService)._core?._renderService?.dimensions?.css?.cell
  return cell?.width && cell.height ? { width: cell.width, height: cell.height } : null
}

const setFont = (term: Terminal, font: number): void => {
  if (term.options.fontSize !== font) term.options.fontSize = font
}

/** The cell at the base font, measured at it: read whenever the pane is at the base font, kept for the font family and
 *  pixel ratio it was read at, and measured again (the font set to the base and back) when either changed. */
const baseCells = new WeakMap<Terminal, { key: string; cell: Area }>()
function baseCell(term: Terminal): Area | null {
  const key = `${String(term.options.fontFamily)}|${(globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1}`
  const at = term.options.fontSize ?? BASE_FONT
  if (at !== BASE_FONT) {
    const kept = baseCells.get(term)
    if (kept && kept.key === key) return kept.cell
    setFont(term, BASE_FONT)
  }
  const cell = cellOf(term)
  if (cell) baseCells.set(term, { key, cell })
  setFont(term, at)
  return cell
}

const areaOf = (host: HTMLElement): Area | null =>
  host.clientWidth && host.clientHeight ? { width: host.clientWidth, height: host.clientHeight } : null

/** The grid this pane holds at the base font: the size it asks the pty for. Null off screen or before the first render. */
export function wantedOf(term: Terminal, host: HTMLElement): Dims | null {
  const area = areaOf(host)
  const cell = area ? baseCell(term) : null
  return area && cell ? gridFor(area, cell) : null
}

/** Shows the pty at its own size, at the largest font whose measured cell fits every row and column in the pane, less
 *  `reserve` pixels at the bottom for the note. */
export function showPty(term: Terminal, host: HTMLElement, pty: Dims, reserve = 0): void {
  const pane = areaOf(host)
  const base = pane ? baseCell(term) : null
  if (!pane || !base) return
  const area = { width: pane.width, height: Math.max(1, pane.height - reserve) }
  const fits = (cell: Area): boolean => pty.cols * cell.width <= area.width && pty.rows * cell.height <= area.height
  // The proportional estimate is a starting point, one step above in case rounding favoured it; then down until it fits.
  let font = Math.min(BASE_FONT, scaledFont({ pty, area, baseCell: base, baseFont: BASE_FONT, minFont: MIN_FONT }) + 1)
  for (;;) {
    setFont(term, font)
    const cell = cellOf(term)
    if (!cell || fits(cell) || font <= MIN_FONT) break
    font -= 1
  }
  if (term.cols !== pty.cols || term.rows !== pty.rows) term.resize(pty.cols, pty.rows)
}

/** Shows this pane's own grid at the base font (it owns the size), and returns that grid, or null off screen. */
export function showOwn(term: Terminal, host: HTMLElement): Dims | null {
  const area = areaOf(host)
  if (!area) return null
  setFont(term, BASE_FONT)
  const wanted = wantedOf(term, host)
  if (!wanted) return null
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

/** A controller's resize answer, as the Runtime gives it. */
export interface ResizeAnswer {
  applied: boolean
  /** Who has the size when it was not applied: the Runtime's own app (`held`), another controller (`other`). */
  reason?: string
  /** The Runtime gives the size to whoever types (an older one does not say it, and typing changes nothing there). */
  latest?: boolean
}

/** Whether a pane owns its pty's size, from what the Host says, and so how it shows the pty. */
export class PaneSize {
  /** True until the Host says otherwise: a pty nobody else ever resized follows its app as it always did. */
  owned = true
  /** The pty's size as the Host last reported it, or null before any report. */
  pty: Dims | null = null
  /** From the last resize answer (a controller's tab): who has the size, and whether typing takes it there. */
  reason: string | undefined = undefined
  latest = true
  private readonly recent = new SentSizes()
  private last: Dims | null = null

  /** This pane asked for `d`. */
  sent(d: Dims): void {
    this.recent.add(d)
    this.last = d
  }

  /** The Host says the pty has `d`. `owned` is its word on it when it gives one (a local tab); without it (a remote
   *  tab, which hears only sizes) the pane's own echoes keep the size while it owns it, and only the size it asked
   *  for last gives it back once it does not (another of its old sizes is someone else's window, final review I7). */
  heard(d: Dims, owned?: boolean): void {
    this.pty = d
    if (owned !== undefined) this.owned = owned
    else this.owned = this.owned ? this.recent.has(d) : this.last !== null && sameDims(d, this.last)
  }

  /** A reconnect's checkpoint: the pty's size, read against the size this pane asked for last (final review I6). Before
   *  it asked anything it keeps its hope; the resize it sends next says. */
  reset(d: Dims): void {
    this.pty = d
    if (this.last !== null) this.owned = sameDims(d, this.last)
  }

  /** A controller's resize answer for `d`, taken only when `d` is the size it asked for last (final review Minor 1). */
  answered(d: Dims, a: ResizeAnswer): void {
    if (!sameDims(d, this.last)) return
    this.owned = a.applied
    this.reason = a.applied ? undefined : a.reason
    this.latest = a.latest === true
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
