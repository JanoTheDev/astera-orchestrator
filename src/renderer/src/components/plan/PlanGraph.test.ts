// W17: the plan graph scales with its tab, down to a floor, then scrolls.
import { describe, expect, it } from 'vitest'
import { graphZoomOf } from './PlanGraph'

describe('graphZoomOf', () => {
  it('draws the graph as laid out when it fits or the box is not measured yet', () => {
    expect(graphZoomOf(1200, 800)).toBe(1)
    expect(graphZoomOf(0, 800)).toBe(1)
    expect(graphZoomOf(500, 0)).toBe(1)
  })
  it('shrinks a wide graph to the box', () => {
    expect(graphZoomOf(640, 800)).toBeCloseTo(0.8)
  })
  it('stops at the floor and leaves the rest to the scroll', () => {
    expect(graphZoomOf(300, 800)).toBe(0.7)
    expect(graphZoomOf(300, 800, 0.5)).toBe(0.5)
  })
})
