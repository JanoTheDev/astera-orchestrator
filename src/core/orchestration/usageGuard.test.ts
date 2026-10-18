import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { UsagePause } from '../types'
import {
  createUsageGuard,
  usageChoice,
  usagePauseAtOf,
  usagePauseOf,
  type AccountReading,
  type UsageChange
} from './usageGuard'
import { readAccountReadings } from '../usage/accountReadings'

const NOW = Date.parse('2026-10-18T12:00:00Z')
const LATER = '2026-10-18T14:20:00Z'
const PAST = '2026-10-18T11:00:00Z'
const reading = (session: number | null, weekly: number | null, resetsAt: string | null = LATER): AccountReading => ({
  session: session === null ? null : { usedPercent: session, resetsAt },
  weekly: weekly === null ? null : { usedPercent: weekly, resetsAt }
})

describe('usagePauseAtOf', () => {
  it('takes a whole percent from 1 to 100, else 90', () => {
    expect(usagePauseAtOf(80)).toBe(80)
    expect(usagePauseAtOf(100)).toBe(100)
    for (const v of [0, 101, 85.5, '90', null, undefined]) expect(usagePauseAtOf(v)).toBe(90)
  })
})

describe('usagePauseOf', () => {
  it('pauses at or over the threshold on the 5-hour window', () => {
    expect(usagePauseOf('a', reading(93, 40), 90, NOW)).toEqual({ accountId: 'a', window: 'five_hour', percent: 93, resetsAt: LATER })
    expect(usagePauseOf('a', reading(90, 40), 90, NOW)?.window).toBe('five_hour')
    expect(usagePauseOf('a', reading(89, 40), 90, NOW)).toBeNull()
  })

  it('pauses on the 7-day window, and tells it first when both are over', () => {
    expect(usagePauseOf('a', reading(10, 95), 90, NOW)?.window).toBe('seven_day')
    expect(usagePauseOf('a', reading(99, 95), 90, NOW)?.window).toBe('seven_day')
  })

  it('does not block with no reading yet', () => {
    expect(usagePauseOf('a', undefined, 90, NOW)).toBeNull()
    expect(usagePauseOf('a', reading(null, null), 90, NOW)).toBeNull()
  })

  it('stops counting a window whose reset has passed', () => {
    expect(usagePauseOf('a', reading(99, 10, PAST), 90, NOW)).toBeNull()
  })

  it('still pauses when the reading has no reset time', () => {
    expect(usagePauseOf('a', reading(95, 10, null), 90, NOW)).toMatchObject({ window: 'five_hour', resetsAt: null })
  })
})

describe('usageChoice', () => {
  const pauses: Record<string, UsagePause> = { a: { accountId: 'a', window: 'five_hour', percent: 93, resetsAt: LATER } }
  const pauseOf = (id: string): UsagePause | null => pauses[id] ?? null

  it('starts on the first account when it is under', () => {
    expect(usageChoice(['b', 'a'], pauseOf)).toEqual({ ok: true, accountId: 'b' })
  })

  it('moves to the next account of the chain that is under', () => {
    expect(usageChoice(['a', 'b'], pauseOf)).toEqual({ ok: true, accountId: 'b' })
  })

  it("answers the first account's pause when the whole chain is paused", () => {
    expect(usageChoice(['a'], pauseOf)).toEqual({ ok: false, pause: pauses.a })
  })
})

describe('createUsageGuard', () => {
  it('tells a pause once, then its end once a fresh reading is under the threshold', async () => {
    let r = new Map([['a', reading(93, 10)]])
    const changes: UsageChange[] = []
    const g = createUsageGuard({ readings: async () => r, pauseAt: async () => 90, nowMs: () => NOW, onChange: (e) => changes.push(e) })
    await g.refresh()
    await g.refresh()
    expect(g.pauseOf('a')?.percent).toBe(93)
    expect(changes.map((c) => c.type)).toEqual(['usage.paused'])
    r = new Map([['a', reading(20, 10)]])
    await g.refresh()
    expect(g.pauseOf('a')).toBeNull()
    expect(changes.map((c) => c.type)).toEqual(['usage.paused', 'usage.resumed'])
  })

  it('ends a pause on its own once resets_at passes', async () => {
    let now = NOW
    const changes: UsageChange[] = []
    const g = createUsageGuard({
      readings: async () => new Map([['a', reading(93, 10)]]),
      pauseAt: async () => 90,
      nowMs: () => now,
      onChange: (e) => changes.push(e)
    })
    await g.refresh()
    now = Date.parse(LATER) + 1
    await g.refresh()
    expect(g.pauseOf('a')).toBeNull()
    expect(changes.map((c) => c.type)).toEqual(['usage.paused', 'usage.resumed'])
  })

  it('reads the threshold each time', async () => {
    let at = 95
    const g = createUsageGuard({ readings: async () => new Map([['a', reading(93, 10)]]), pauseAt: async () => at, nowMs: () => NOW })
    await g.refresh()
    expect(g.pauseOf('a')).toBeNull()
    at = 90
    await g.refresh()
    expect(g.pauseOf('a')).not.toBeNull()
    expect(g.pauseAt()).toBe(90)
    expect(g.view()).toEqual([{ accountId: 'a', ...reading(93, 10), paused: g.pauseOf('a') }])
  })
})

describe('readAccountReadings', () => {
  it("keeps each account's newest statusLine reading", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-readings-'))
    try {
      const payload = (pct: number): string =>
        JSON.stringify({ rate_limits: { five_hour: { used_percentage: pct, resets_at: Date.parse(LATER) / 1000 }, seven_day: { used_percentage: 5 } } })
      await fs.writeFile(path.join(dir, 'old.json'), payload(50))
      await fs.writeFile(path.join(dir, 'new.json'), payload(93))
      await fs.utimes(path.join(dir, 'old.json'), new Date(Date.now() - 600_000), new Date(Date.now() - 600_000))
      await fs.writeFile(path.join(dir, 'other.json'), '{"context_window":{"used_percentage":3}}')
      const out = await readAccountReadings(dir, [
        { id: 'old', accountId: 'a' },
        { id: 'new', accountId: 'a' },
        { id: 'other', accountId: 'b' },
        { id: 'missing', accountId: 'c' },
        { id: 'new', accountId: null }
      ])
      expect([...out.keys()]).toEqual(['a'])
      expect(out.get('a')).toEqual({ session: { usedPercent: 93, resetsAt: new Date(LATER).toISOString() }, weekly: { usedPercent: 5, resetsAt: null } })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
