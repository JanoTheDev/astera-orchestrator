// A terminal watched from two computers has one size: the one the side that typed last wants. The other side shows
// it whole, at a smaller font when it does not fit, rather than cutting off the rows below its pane (where Claude's
// prompt is).
import { describe, it, expect } from 'vitest'
import { gridFor, sameDims, scaledFont } from './viewSize'

const cell = { width: 8, height: 17 }

describe('gridFor', () => {
  it('is the whole cells that fit, at least 2 columns and 1 row', () => {
    expect(gridFor({ width: 805, height: 345 }, cell)).toEqual({ cols: 100, rows: 20 })
    expect(gridFor({ width: 5, height: 5 }, cell)).toEqual({ cols: 2, rows: 1 })
  })
})

describe('scaledFont', () => {
  const area = { width: 800, height: 340 } // 100 x 20 at the base cell

  it('keeps the base font when the pty fits, also when it is smaller than the pane', () => {
    expect(scaledFont({ pty: { cols: 100, rows: 20 }, area, baseCell: cell, baseFont: 14, minFont: 6 })).toBe(14)
    expect(scaledFont({ pty: { cols: 60, rows: 10 }, area, baseCell: cell, baseFont: 14, minFont: 6 })).toBe(14)
  })

  it('picks the largest whole font at which a larger pty fits', () => {
    // 160 columns at 14px need 1280px; 800px holds them at 14 * 800 / 1280 = 8.75 → 8.
    expect(scaledFont({ pty: { cols: 160, rows: 20 }, area, baseCell: cell, baseFont: 14, minFont: 6 })).toBe(8)
    // 40 rows at 14px need 680px; 340px holds them at 7.
    expect(scaledFont({ pty: { cols: 100, rows: 40 }, area, baseCell: cell, baseFont: 14, minFont: 6 })).toBe(7)
  })

  it('never goes below the floor', () => {
    expect(scaledFont({ pty: { cols: 1000, rows: 20 }, area, baseCell: cell, baseFont: 14, minFont: 6 })).toBe(6)
  })
})

describe('sameDims', () => {
  it('compares columns and rows, null being unknown', () => {
    expect(sameDims({ cols: 1, rows: 2 }, { cols: 1, rows: 2 })).toBe(true)
    expect(sameDims({ cols: 1, rows: 2 }, { cols: 1, rows: 3 })).toBe(false)
    expect(sameDims(null, { cols: 1, rows: 2 })).toBe(false)
  })
})
