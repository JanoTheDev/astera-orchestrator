import { describe, it, expect } from 'vitest'
import { clockFor, minuteClock } from './runClock'

// Audit UI-11: the Jobs sidebar ticked once a second while anything ran, and every Run card drew again on each tick,
// the finished ones too. A card with nothing running is handed a clock that does not move, so it is not drawn again.
describe('clockFor', () => {
  const running = { tasks: [{ startedAt: '2026-10-09T00:00:00Z' }] }
  const waiting = { tasks: [{ waiting: { resetsAt: '2026-10-09T01:00:00Z' } }] }
  const done = { tasks: [{ startedAt: undefined }] }
  it('is the clock for a Run with a task running or waiting', () => {
    expect(clockFor(running, 1234)).toBe(1234)
    expect(clockFor(waiting, 1234)).toBe(1234)
  })
  it('is a fixed value for a Run with nothing running', () => {
    expect(clockFor(done, 1234)).toBe(clockFor(done, 9999))
  })
})

// The Plans list ages a plan by the real clock: clockFor's 0 for a finished plan made "<1m" of a plan hours old.
describe('minuteClock', () => {
  it('is the real time cut to the minute, so a finished card draws again once a minute only', () => {
    const t = Date.parse('2026-10-22T12:00:00Z')
    expect(minuteClock(t + 59_999)).toBe(t)
    expect(minuteClock(t + 60_000)).toBe(t + 60_000)
  })
})
