// Pure logic behind ui/Tree: the ARIA tree keys (WAI-ARIA APG tree view) and the virtual window. DOM-free.

import { typeaheadIndex } from './logic'

/** A tree row's shape as far as the keys care: rows come flattened, parents before their children. */
export type TreeNavRow = { depth: number; expanded?: boolean; hasChildren?: boolean }

export type TreeKeyAction = { focus: number } | { toggle: number; expand: boolean } | { open: number } | null

/** What a key does on the flat row list, from the focused row `current` (-1: none yet).
 *  Up/Down move one row, Home/End jump; Right expands a closed parent, then steps to its first child;
 *  Left collapses an open parent, else steps to the parent; Enter opens. Null: not ours (typeahead is separate). */
export function treeKeyAction(rows: readonly TreeNavRow[], current: number, key: string): TreeKeyAction {
  const n = rows.length
  if (n === 0) return null
  if (current < 0 || current >= n) {
    if (key === 'ArrowDown' || key === 'Home' || key === 'ArrowRight' || key === 'ArrowLeft') return { focus: 0 }
    if (key === 'ArrowUp' || key === 'End') return { focus: n - 1 }
    return null
  }
  const row = rows[current]
  switch (key) {
    case 'ArrowDown':
      return { focus: Math.min(n - 1, current + 1) }
    case 'ArrowUp':
      return { focus: Math.max(0, current - 1) }
    case 'Home':
      return { focus: 0 }
    case 'End':
      return { focus: n - 1 }
    case 'ArrowRight':
      if (!row.hasChildren) return null
      if (!row.expanded) return { toggle: current, expand: true }
      return current + 1 < n && rows[current + 1].depth > row.depth ? { focus: current + 1 } : null
    case 'ArrowLeft': {
      if (row.hasChildren && row.expanded) return { toggle: current, expand: false }
      const parent = parentIndex(rows, current)
      return parent >= 0 ? { focus: parent } : null
    }
    case 'Enter':
      return { open: current }
    default:
      return null
  }
}

/** The nearest row above `index` one level up; -1 for a top-level row. */
export function parentIndex(rows: readonly TreeNavRow[], index: number): number {
  const depth = rows[index]?.depth ?? 0
  for (let i = index - 1; i >= 0; i--) if (rows[i].depth < depth) return i
  return -1
}

/** Type-ahead over the visible rows' labels (no row is disabled in a tree). */
export function treeTypeahead(labels: readonly string[], query: string, current: number): number {
  return typeaheadIndex(labels, new Array<boolean>(labels.length).fill(false), query, current)
}

/** A tree row is 22px (DESIGN-W13 §11, --row-h). */
export const TREE_ROW_H = 22
/** Past this many rows the tree draws only the viewport (FileExplorer's approach, components/explorerRows.ts). */
export const TREE_VIRTUAL_AFTER = 200
/** Rows drawn beyond each edge of the viewport, so a fast scroll does not show blank space first. */
export const TREE_OVERSCAN = 8
/** The viewport height assumed before the tree has been measured (the first render). */
export const TREE_DEFAULT_VIEWPORT_H = 600

/** The rows to draw, [start, end): all of them up to TREE_VIRTUAL_AFTER, else the viewport plus overscan. */
export function treeWindow(count: number, scrollTop: number, viewportH: number): { start: number; end: number } {
  if (count <= TREE_VIRTUAL_AFTER) return { start: 0, end: count }
  const first = Math.floor(Math.max(0, scrollTop) / TREE_ROW_H)
  const last = Math.ceil((Math.max(0, scrollTop) + viewportH) / TREE_ROW_H)
  return { start: Math.max(0, Math.min(count, first) - TREE_OVERSCAN), end: Math.min(count, last + TREE_OVERSCAN) }
}

/** The scrollTop that brings row `index` into view with the least movement. */
export function treeRevealTop(index: number, scrollTop: number, viewportH: number): number {
  const top = index * TREE_ROW_H
  const bottom = top + TREE_ROW_H
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewportH) return Math.max(0, bottom - viewportH)
  return scrollTop
}
