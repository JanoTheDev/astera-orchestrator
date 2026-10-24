import { describe, expect, it } from 'vitest'
import { elapsedLabel, modelEffortLabel, rowTimeOf } from './sessionRow'

describe('elapsedLabel', () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0)
  it('reads <1m under a minute and when the clock is behind', () => {
    expect(elapsedLabel(now - 59_000, now)).toBe('<1m')
    expect(elapsedLabel(now + 5_000, now)).toBe('<1m')
  })
  it('counts whole minutes under an hour and whole hours under a day', () => {
    expect(elapsedLabel(now - 60_000, now)).toBe('1m')
    expect(elapsedLabel(now - 59 * 60_000, now)).toBe('59m')
    expect(elapsedLabel(now - 60 * 60_000, now)).toBe('1h')
    expect(elapsedLabel(now - (23 * 60 + 59) * 60_000, now)).toBe('23h')
  })
  it('shows the short date from a day on', () => {
    const from = now - 3 * 24 * 60 * 60_000
    expect(elapsedLabel(from, now)).toBe(new Date(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
  })
})

describe('modelEffortLabel', () => {
  it('joins what is known', () => {
    expect(modelEffortLabel()).toBe('')
    expect(modelEffortLabel('opus')).toBe('opus')
    expect(modelEffortLabel('opus', 'high')).toBe('opus · high')
    expect(modelEffortLabel(undefined, 'high')).toBe('high')
  })
})

describe('rowTimeOf', () => {
  it('a live row counts from its start, a finished one from its last sign of life', () => {
    expect(rowTimeOf({ startedAt: 1, lastActiveAt: 2 }, false)).toEqual({ at: 1, started: true })
    expect(rowTimeOf({ startedAt: 1, lastActiveAt: 2 }, true)).toEqual({ at: 2, started: false })
  })
  it('a finished row with no tool call and no Dispatch (a planner) still shows its start', () => {
    expect(rowTimeOf({ startedAt: 1 }, true)).toEqual({ at: 1, started: true })
    expect(rowTimeOf({}, true)).toBeNull()
  })
})
