import { describe, expect, it } from 'vitest'
import { CHIME_GAP_MS, createChime } from './alertSound'

// W6-B: at most one chime per 5 s, however many notices arrive together
describe('createChime', () => {
  it('sounds once in a burst, and again after the gap', () => {
    let now = 1000
    let sounded = 0
    const c = createChime({ now: () => now, sound: () => sounded++ })
    expect([c.play(), c.play()]).toEqual([true, false])
    now += CHIME_GAP_MS - 1
    expect(c.play()).toBe(false)
    now += 1
    expect(c.play()).toBe(true)
    expect(sounded).toBe(2)
  })
})
