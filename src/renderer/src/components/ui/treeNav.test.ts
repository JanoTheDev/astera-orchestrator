import { describe, it, expect } from 'vitest'
import { parentIndex, TREE_OVERSCAN, TREE_ROW_H, TREE_VIRTUAL_AFTER, treeKeyAction, treeRevealTop, treeTypeahead, treeWindow, type TreeNavRow } from './treeNav'

// src/            0 open
//   a.ts          1
//   lib/          2 closed
// README.md       3
const rows: TreeNavRow[] = [
  { depth: 0, hasChildren: true, expanded: true },
  { depth: 1 },
  { depth: 1, hasChildren: true, expanded: false },
  { depth: 0 }
]

describe('treeKeyAction', () => {
  it('Up/Down move one row and stop at the ends; Home/End jump', () => {
    expect(treeKeyAction(rows, 1, 'ArrowDown')).toEqual({ focus: 2 })
    expect(treeKeyAction(rows, 3, 'ArrowDown')).toEqual({ focus: 3 })
    expect(treeKeyAction(rows, 1, 'ArrowUp')).toEqual({ focus: 0 })
    expect(treeKeyAction(rows, 0, 'ArrowUp')).toEqual({ focus: 0 })
    expect(treeKeyAction(rows, 2, 'Home')).toEqual({ focus: 0 })
    expect(treeKeyAction(rows, 0, 'End')).toEqual({ focus: 3 })
  })

  it('Right expands a closed parent, then steps into its first child; a leaf ignores it', () => {
    expect(treeKeyAction(rows, 2, 'ArrowRight')).toEqual({ toggle: 2, expand: true })
    expect(treeKeyAction(rows, 0, 'ArrowRight')).toEqual({ focus: 1 })
    expect(treeKeyAction(rows, 1, 'ArrowRight')).toBeNull()
    // an open parent with no rows under it (still loading) stays put
    expect(treeKeyAction([{ depth: 0, hasChildren: true, expanded: true }, { depth: 0 }], 0, 'ArrowRight')).toBeNull()
  })

  it('Left collapses an open parent, else goes to the parent; a top-level row stays', () => {
    expect(treeKeyAction(rows, 0, 'ArrowLeft')).toEqual({ toggle: 0, expand: false })
    expect(treeKeyAction(rows, 2, 'ArrowLeft')).toEqual({ focus: 0 })
    expect(treeKeyAction(rows, 1, 'ArrowLeft')).toEqual({ focus: 0 })
    expect(treeKeyAction(rows, 3, 'ArrowLeft')).toBeNull()
  })

  it('Enter opens; other keys and an empty tree are not ours', () => {
    expect(treeKeyAction(rows, 1, 'Enter')).toEqual({ open: 1 })
    expect(treeKeyAction(rows, 1, 'Tab')).toBeNull()
    expect(treeKeyAction([], -1, 'ArrowDown')).toBeNull()
  })

  it('with no cursor yet, the first key lands on the first (Up/End: the last) row', () => {
    expect(treeKeyAction(rows, -1, 'ArrowDown')).toEqual({ focus: 0 })
    expect(treeKeyAction(rows, -1, 'End')).toEqual({ focus: 3 })
    expect(treeKeyAction(rows, -1, 'Enter')).toBeNull()
  })

  it('parentIndex finds the nearest shallower row above', () => {
    expect(parentIndex(rows, 2)).toBe(0)
    expect(parentIndex(rows, 3)).toBe(-1)
  })
})

describe('treeTypeahead', () => {
  const labels = ['src', 'a.ts', 'lib', 'README.md', 'scripts']
  it('finds the next row starting with the letters, case-insensitive, cycling on a repeated letter', () => {
    expect(treeTypeahead(labels, 'r', 0)).toBe(3)
    expect(treeTypeahead(labels, 's', 0)).toBe(4)
    expect(treeTypeahead(labels, 'ss', 4)).toBe(0)
    expect(treeTypeahead(labels, 'sc', 0)).toBe(4)
    expect(treeTypeahead(labels, 'zz', 0)).toBe(-1)
  })
})

describe('treeWindow', () => {
  it('draws every row up to the threshold', () => {
    expect(treeWindow(TREE_VIRTUAL_AFTER, 5000, 100)).toEqual({ start: 0, end: TREE_VIRTUAL_AFTER })
  })

  it('past it, draws the viewport plus overscan', () => {
    const w = treeWindow(10_000, 100 * TREE_ROW_H, 10 * TREE_ROW_H)
    expect(w).toEqual({ start: 100 - TREE_OVERSCAN, end: 110 + TREE_OVERSCAN })
    expect(treeWindow(10_000, 0, 10 * TREE_ROW_H)).toEqual({ start: 0, end: 10 + TREE_OVERSCAN })
    expect(treeWindow(300, 1e9, 220).end).toBe(300)
  })

  it('treeRevealTop scrolls the least to show a row', () => {
    expect(treeRevealTop(5, 0, 220)).toBe(0)
    expect(treeRevealTop(20, 0, 220)).toBe(21 * TREE_ROW_H - 220)
    expect(treeRevealTop(2, 10 * TREE_ROW_H, 220)).toBe(2 * TREE_ROW_H)
  })
})
