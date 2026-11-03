import { describe, it, expect, vi } from 'vitest'
import { createSharedPoll } from './sharedPoll'

const fakeDoc = () => {
  const t = new EventTarget() as EventTarget & { hidden: boolean }
  t.hidden = false
  return t
}

describe('createSharedPoll', () => {
  it('two subscribers share one timer and one read; the last to leave stops it', async () => {
    vi.useFakeTimers()
    try {
      const poll = createSharedPoll<number>(1_000, fakeDoc())
      const read = vi.fn(async () => 1)
      const a = vi.fn()
      const b = vi.fn()
      const offA = poll.subscribe('k', { read }, a)
      const offB = poll.subscribe('k', { read }, b)
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(1)
      expect(a).toHaveBeenCalledWith(1)
      expect(b).toHaveBeenCalledWith(1) // joined an open poll: handed the value already held
      offA()
      expect(vi.getTimerCount()).toBe(1)
      offB()
      expect(vi.getTimerCount()).toBe(0)
      expect(poll.size()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads nothing while the document is hidden and tells nobody about an unchanged answer', async () => {
    vi.useFakeTimers()
    try {
      const doc = fakeDoc()
      const poll = createSharedPoll<{ n: number }>(1_000, doc)
      const same = { n: 1 }
      const read = vi.fn(async () => same)
      const listener = vi.fn()
      const off = poll.subscribe('k', { read }, listener)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(read).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenCalledTimes(1) // the second answer is the same object
      doc.hidden = true
      await vi.advanceTimersByTimeAsync(10_000)
      expect(read).toHaveBeenCalledTimes(2)
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps one read in flight and reloads on demand', async () => {
    vi.useFakeTimers()
    try {
      const poll = createSharedPoll<number>(1_000, fakeDoc())
      let release: (v: number) => void = () => {}
      const read = vi.fn(() => new Promise<number>((r) => (release = r)))
      const off = poll.subscribe('k', { read }, () => {})
      poll.reload('k')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(read).toHaveBeenCalledTimes(1)
      release(1)
      await vi.advanceTimersByTimeAsync(0)
      poll.reload('k')
      expect(read).toHaveBeenCalledTimes(2)
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a reload during a pending read runs one follow-up read after it, and that value reaches the listener', async () => {
    vi.useFakeTimers()
    try {
      const poll = createSharedPoll<number>(1_000, fakeDoc())
      const releases: Array<(v: number) => void> = []
      const read = vi.fn(() => new Promise<number>((r) => releases.push(r)))
      const listener = vi.fn()
      const off = poll.subscribe('k', { read }, listener)
      await vi.advanceTimersByTimeAsync(0)
      poll.reload('k')
      expect(read).toHaveBeenCalledTimes(1)
      releases[0](1)
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(2)
      releases[1](2)
      await vi.advanceTimersByTimeAsync(0)
      expect(listener).toHaveBeenLastCalledWith(2)
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('three reloads during one read cause exactly one follow-up read', async () => {
    vi.useFakeTimers()
    try {
      const poll = createSharedPoll<number>(1_000, fakeDoc())
      const releases: Array<(v: number) => void> = []
      const read = vi.fn(() => new Promise<number>((r) => releases.push(r)))
      const off = poll.subscribe('k', { read }, () => {})
      await vi.advanceTimersByTimeAsync(0)
      poll.reload('k')
      poll.reload('k')
      poll.reload('k')
      releases[0](1)
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(2)
      releases[1](2)
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(2)
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('no read runs after the last unsubscribe, even one a reload asked for mid-read', async () => {
    vi.useFakeTimers()
    try {
      const poll = createSharedPoll<number>(1_000, fakeDoc())
      let release: (v: number) => void = () => {}
      const read = vi.fn(() => new Promise<number>((r) => (release = r)))
      const off = poll.subscribe('k', { read }, () => {})
      await vi.advanceTimersByTimeAsync(0)
      poll.reload('k')
      off()
      release(1)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(read).toHaveBeenCalledTimes(1)
      expect(poll.size()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // 2026-11-03: one read that never settled held `running`, and so every refresh after it, for as long as it hung
  it('a read past its deadline no longer holds the poll: the next turn reads again, and the late answer is dropped', async () => {
    vi.useFakeTimers()
    try {
      const poll = createSharedPoll<number>(1_000, fakeDoc(), { readTimeoutMs: 3_000 })
      const releases: Array<(v: number) => void> = []
      const read = vi.fn(() => new Promise<number>((r) => releases.push(r)))
      const got: number[] = []
      const off = poll.subscribe('k', { read }, (v) => got.push(v))
      await vi.advanceTimersByTimeAsync(2_500)
      expect(read).toHaveBeenCalledTimes(1) // still within its deadline: the turns wait for it
      await vi.advanceTimersByTimeAsync(1_000)
      expect(read).toHaveBeenCalledTimes(2) // past it: the next turn reads again
      releases[1]!(2)
      await vi.advanceTimersByTimeAsync(0)
      releases[0]!(1) // the stuck one, late
      await vi.advanceTimersByTimeAsync(0)
      expect(got).toEqual([2])
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it("a probe whose answer did not move skips the turn's read; a moved one, a stale one or a signal reads", async () => {
    vi.useFakeTimers()
    try {
      let t = 0
      const poll = createSharedPoll<number>(1_000, fakeDoc(), { now: () => t })
      let generation = 1
      let n = 0
      const read = vi.fn(async () => ++n)
      let signal: () => void = () => {}
      const got: number[] = []
      const off = poll.subscribe(
        'k',
        {
          read,
          probe: { key: async () => generation, maxAgeMs: 10_000 },
          signals: (reload) => {
            signal = reload
            return () => {}
          }
        },
        (v) => got.push(v)
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(1)
      t = 3_000
      await vi.advanceTimersByTimeAsync(3_000)
      expect(read).toHaveBeenCalledTimes(1) // three turns, nothing moved
      generation = 2
      await vi.advanceTimersByTimeAsync(1_000)
      expect(read).toHaveBeenCalledTimes(2) // it moved
      signal()
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(3) // a push reads whatever the probe says
      t = 20_000
      await vi.advanceTimersByTimeAsync(1_000)
      expect(read).toHaveBeenCalledTimes(4) // the last whole read is too old
      expect(got).toEqual([1, 2, 3, 4])
      off()
    } finally {
      vi.useRealTimers()
    }
  })

  it('hands the held value to the read, so a read can keep the parts it could not read', async () => {
    vi.useFakeTimers()
    try {
      const poll = createSharedPoll<number>(1_000, fakeDoc())
      const seen: Array<number | undefined> = []
      const off = poll.subscribe('k', { read: async (prev) => (seen.push(prev), (prev ?? 0) + 1) }, () => {})
      await vi.advanceTimersByTimeAsync(1_000)
      expect(seen).toEqual([undefined, 1])
      off()
    } finally {
      vi.useRealTimers()
    }
  })
})
