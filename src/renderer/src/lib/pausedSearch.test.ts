// A search asked after a pause in typing (plugin Phase 4 J12, §3.2): a source's search API is rate limited, and a
// person typing a word is one search, not one a letter.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPause } from './pausedSearch'

afterEach(() => {
  vi.useRealTimers()
})

describe('createPause', () => {
  it('runs only the last of quick calls, once the pause has passed', () => {
    vi.useFakeTimers()
    const ran: string[] = []
    const pause = createPause(300, (q) => ran.push(q))
    pause.type('l')
    vi.advanceTimersByTime(100)
    pause.type('lo')
    vi.advanceTimersByTime(100)
    pause.type('log')
    vi.advanceTimersByTime(299)
    expect(ran).toEqual([])
    vi.advanceTimersByTime(1)
    expect(ran).toEqual(['log'])
  })

  it('runs nothing once cancelled, as when the window closes', () => {
    vi.useFakeTimers()
    const ran: string[] = []
    const pause = createPause(300, (q) => ran.push(q))
    pause.type('x')
    pause.cancel()
    vi.advanceTimersByTime(1_000)
    expect(ran).toEqual([])
  })
})
