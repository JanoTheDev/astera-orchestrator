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
})
