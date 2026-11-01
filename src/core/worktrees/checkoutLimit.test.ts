import { describe, expect, it } from 'vitest'
import { inCheckoutSlot } from './checkoutLimit'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

describe('inCheckoutSlot', () => {
  it('runs at most `limit` at once per repository, in arrival order, and hands a failed run\'s slot on', async () => {
    let active = 0, peak = 0
    const started: number[] = []
    const step = (n: number) => async (): Promise<number> => {
      started.push(n)
      peak = Math.max(peak, ++active)
      await tick()
      active--
      if (n === 0) throw new Error('boom')
      return n
    }
    const runs = [0, 1, 2, 3, 4].map((n) => inCheckoutSlot('C:\\repo', step(n), 2))
    const done = await Promise.allSettled(runs)
    expect(peak).toBe(2)
    expect(started).toEqual([0, 1, 2, 3, 4])
    expect(done.map((d) => d.status)).toEqual(['rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled'])
  })

  it('counts each repository on its own', async () => {
    let active = 0, peak = 0
    const step = async (): Promise<void> => {
      peak = Math.max(peak, ++active)
      await tick()
      active--
    }
    await Promise.all([inCheckoutSlot('C:\\one', step, 1), inCheckoutSlot('C:\\two', step, 1)])
    expect(peak).toBe(2)
  })
})
