// How a terminal pane shows a pty whose size another computer decides (tmux's `window-size latest`: the side that
// typed last owns the size). The owner's pane fits the pty at the base font; any other pane shows it whole, at the
// largest font that fits, instead of cutting off the rows below the pane, which is where Claude's prompt is.
// Pure: the views measure, this decides.
import type { Dims } from './resize'

export interface Area {
  width: number
  height: number
}

/** The cell grid a pane holds: what fitTerminalToHost picks (whole cells, at least 2 columns and 1 row). */
export function gridFor(area: Area, cell: Area): Dims {
  return { cols: Math.max(2, Math.floor(area.width / cell.width)), rows: Math.max(1, Math.floor(area.height / cell.height)) }
}

/** The font a pane shows `pty` at: `baseFont` when it fits at `baseCell` (a smaller pty keeps it, with margin), else
 *  the largest whole font down to `minFont` at which it fits, a cell scaling with its font. */
export function scaledFont(o: { pty: Dims; area: Area; baseCell: Area; baseFont: number; minFont: number }): number {
  const ratio = Math.min(o.area.width / (o.pty.cols * o.baseCell.width), o.area.height / (o.pty.rows * o.baseCell.height))
  if (ratio >= 1) return o.baseFont
  return Math.max(o.minFont, Math.floor(o.baseFont * ratio))
}

export function sameDims(a: Dims | null, b: Dims | null): boolean {
  return a !== null && b !== null && a.cols === b.cols && a.rows === b.rows
}
