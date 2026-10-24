import { describe, it, expect } from 'vitest'
import { coalescePerFrame } from './frameCoalesce'

// A frame the test fires by hand.
function manualFrames() {
  let pending: (() => void) | null = null
  return {
    schedule: (run: () => void) => {
      pending = run
      return () => {
        pending = null
      }
    },
    fire: () => {
      const run = pending
      pending = null
      run?.()
    },
    scheduled: () => pending !== null
  }
}

describe('coalescePerFrame', () => {
  it('applies once with the last value for 50 pushes in one frame', () => {
    const f = manualFrames()
    const seen: number[] = []
    const { push } = coalescePerFrame<number>((v) => seen.push(v), { schedule: f.schedule })
    for (let i = 1; i <= 50; i++) push(i)
    expect(seen).toEqual([])
    f.fire()
    expect(seen).toEqual([50])
  })

  it('applies once per frame when pushes span two frames', () => {
    const f = manualFrames()
    const seen: string[] = []
    const { push } = coalescePerFrame<string>((v) => seen.push(v), { schedule: f.schedule })
    push('a')
    push('b')
    f.fire()
    push('c')
    f.fire()
    expect(seen).toEqual(['b', 'c'])
  })

  it('does not apply on a frame with nothing pushed', () => {
    const f = manualFrames()
    const seen: number[] = []
    const { push } = coalescePerFrame<number>((v) => seen.push(v), { schedule: f.schedule })
    push(1)
    f.fire()
    f.fire()
    expect(seen).toEqual([1])
  })

  it('merges the pushes of a frame when asked', () => {
    const f = manualFrames()
    const seen: Record<string, number>[] = []
    const { push } = coalescePerFrame<Record<string, number>>((v) => seen.push(v), {
      schedule: f.schedule,
      merge: (acc, next) => ({ ...acc, ...next })
    })
    push({ a: 1 })
    push({ b: 2 })
    push({ a: 3 })
    f.fire()
    push({ c: 4 })
    f.fire()
    expect(seen).toEqual([{ a: 3, b: 2 }, { c: 4 }])
  })

  it('cancel drops the pending apply and the value, and later pushes still work', () => {
    const f = manualFrames()
    const seen: number[] = []
    const { push, cancel } = coalescePerFrame<number>((v) => seen.push(v), { schedule: f.schedule })
    push(1)
    cancel()
    expect(f.scheduled()).toBe(false)
    f.fire()
    expect(seen).toEqual([])
    push(2)
    f.fire()
    expect(seen).toEqual([2])
  })

  it('keeps working after apply throws', () => {
    const f = manualFrames()
    const seen: number[] = []
    const { push } = coalescePerFrame<number>(
      (v) => {
        seen.push(v)
        if (v === 1) throw new Error('boom')
      },
      { schedule: f.schedule }
    )
    push(1)
    expect(() => f.fire()).toThrow('boom')
    push(2)
    f.fire()
    expect(seen).toEqual([1, 2])
  })

  it('falls back to setTimeout when requestAnimationFrame is missing', async () => {
    const seen: number[] = []
    const { push } = coalescePerFrame<number>((v) => seen.push(v))
    push(1)
    push(2)
    await new Promise((r) => setTimeout(r, 10))
    expect(seen).toEqual([2])
  })
})
