import { describe, it, expect } from 'vitest'
import { wheelScrollDelta } from './useWheelScrollX'

const overflowing = { scrollWidth: 800, clientWidth: 400 }

describe('wheelScrollDelta', () => {
  it('turns a vertical wheel into a sideways scroll', () => {
    expect(wheelScrollDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 }, overflowing)).toBe(100)
    expect(wheelScrollDelta({ deltaX: 0, deltaY: -100, deltaMode: 0 }, overflowing)).toBe(-100)
  })

  it('leaves a mostly-horizontal scroll to the browser', () => {
    expect(wheelScrollDelta({ deltaX: 50, deltaY: 10, deltaMode: 0 }, overflowing)).toBeNull()
    expect(wheelScrollDelta({ deltaX: 30, deltaY: 30, deltaMode: 0 }, overflowing)).toBeNull()
  })

  it('leaves the event alone when the row does not overflow', () => {
    expect(wheelScrollDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 }, { scrollWidth: 400, clientWidth: 400 })).toBeNull()
  })

  it('scales line and page modes', () => {
    expect(wheelScrollDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, overflowing)).toBe(48)
    expect(wheelScrollDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, overflowing)).toBe(400)
  })
})
