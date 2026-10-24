import { describe, expect, it } from 'vitest'
import { listWindow, offsetsOf, visibleRange, windowPads } from './virtualRows'

// a list of group headers (32px) each followed by two 24px rows
const heights = [32, 24, 24, 32, 24, 24, 32, 24, 24]
const offsets = offsetsOf(heights)

describe('offsetsOf', () => {
  it('sums the heights into row tops and the list height', () => {
    expect(offsets).toEqual([0, 32, 56, 80, 112, 136, 160, 192, 216, 240])
  })
  it('gives [0] for an empty list', () => {
    expect(offsetsOf([])).toEqual([0])
  })
})

describe('visibleRange', () => {
  it('draws the rows that overlap the viewport, without overscan', () => {
    // 40..100 overlaps row 1 (32-56), row 2 (56-80) and row 3, the second header (80-112)
    expect(visibleRange(offsets, 40, 60, 0)).toEqual({ start: 1, end: 4 })
  })
  it('widens by overscan and stays inside the list', () => {
    expect(visibleRange(offsets, 40, 60, 2)).toEqual({ start: 0, end: 6 })
    expect(visibleRange(offsets, 0, 30, 100)).toEqual({ start: 0, end: 9 })
  })
  it('draws every row of a list shorter than the viewport', () => {
    expect(visibleRange(offsets, 0, 1000, 0)).toEqual({ start: 0, end: 9 })
  })
  it('draws nothing for an empty list', () => {
    expect(visibleRange([0], 0, 600, 8)).toEqual({ start: 0, end: 0 })
  })
})

describe('listWindow', () => {
  it('uses the list-relative scroll position', () => {
    expect(listWindow(offsets, 40, 60, 0)).toEqual({ start: 1, end: 4 })
  })
  it('draws nothing while the list is wholly above or below the viewport', () => {
    expect(listWindow(offsets, -700, 600, 6)).toEqual({ start: 0, end: 0 })
    expect(listWindow(offsets, 240, 600, 6)).toEqual({ start: 0, end: 0 })
  })
  it('starts drawing as soon as the list enters the viewport from below', () => {
    expect(listWindow(offsets, -590, 600, 0)).toEqual({ start: 0, end: 1 })
  })
})

describe('windowPads', () => {
  it('pads with the height of the rows left out on each side', () => {
    expect(windowPads(offsets, { start: 3, end: 6 })).toEqual({ before: 80, after: 80 })
  })
  it('pads the whole list when nothing is drawn, and nothing when everything is', () => {
    expect(windowPads(offsets, { start: 0, end: 0 })).toEqual({ before: 0, after: 240 })
    expect(windowPads(offsets, { start: 0, end: 9 })).toEqual({ before: 0, after: 0 })
  })
})
