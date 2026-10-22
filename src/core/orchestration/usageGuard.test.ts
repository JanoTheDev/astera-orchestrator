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
import { readAccountReadings, withFetchedReadings } from '../usage/accountReadings'

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

  it('blocks on a full window with no readable reset time, until a fresh reading says otherwise (T5a)', () => {
    expect(usagePauseOf('a', reading(95, 10, null), 90, NOW)).toEqual({ accountId: 'a', window: 'five_hour', percent: 95, resetsAt: null })
    expect(usagePauseOf('a', reading(10, 100, null), 90, NOW)).toEqual({ accountId: 'a', window: 'seven_day', percent: 100, resetsAt: null })
    expect(usagePauseOf('a', reading(95, 10, 'soon'), 90, NOW)?.resetsAt).toBeNull()
    expect(usagePauseOf('a', reading(50, 10, null), 90, NOW)).toBeNull()
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
      expect(out.get('a')).toMatchObject({ session: { usedPercent: 93, resetsAt: new Date(LATER).toISOString() }, weekly: { usedPercent: 5, resetsAt: null } })
      expect(out.get('a')?.at).toBeGreaterThan(Date.now() - 60_000)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('T2: automatic accounts in the guard', () => {
  it('reads the setting before the readings, hands it to them, and tells it', async () => {
    let on = true
    const asked: boolean[] = []
    const guard = createUsageGuard({
      readings: async ({ autoAccounts }) => {
        asked.push(autoAccounts)
        return new Map()
      },
      pauseAt: async () => 90,
      autoAccounts: async () => on,
      nowMs: () => NOW
    })
    // T5b: before the first read, the setting's default (on)
    expect(guard.autoAccounts()).toBe(true)
    await guard.refresh()
    expect(guard.autoAccounts()).toBe(true)
    on = false
    await guard.refresh()
    expect(guard.autoAccounts()).toBe(false)
    expect(asked).toEqual([true, false])
  })

  it('is off without the setting wired', async () => {
    const guard = createUsageGuard({ readings: async () => new Map(), pauseAt: async () => 90, nowMs: () => NOW })
    await guard.refresh()
    expect(guard.autoAccounts()).toBe(false)
  })

  it('withFetchedReadings adds the fetcher\'s usage for claude accounts with no live reading, and nothing on a failure', async () => {
    const acct = (id: string, provider: 'claude' | 'codex' = 'claude') => ({ id, label: id, configDir: `/cfg/${id}`, color: '#fff', createdAt: LATER, provider })
    const live = new Map([['live', reading(50, 10)]])
    const fetched = { session: { usedPercent: 30, resetsAt: LATER }, weekly: null, maxPercent: 30, peak: null, status: 'ok' as const }
    const fetch = async (dir: string) => {
      if (dir === '/cfg/bad') throw new Error('net')
      if (dir === '/cfg/none') return { ...fetched, session: null, status: 'unavailable' as const }
      return fetched
    }
    const out = await withFetchedReadings(live, [acct('live'), acct('idle'), acct('bad'), acct('none'), acct('cx', 'codex')], fetch, NOW)
    expect(Object.fromEntries(out)).toEqual({ live: reading(50, 10), idle: { session: fetched.session, weekly: null, at: NOW } })
  })

  it('withFetchedReadings reads codex accounts through the codex fetcher; a failed fetch leaves them unknown', async () => {
    const acct = (id: string) => ({ id, label: id, configDir: `/cfg/${id}`, color: '#fff', createdAt: LATER, provider: 'codex' as const })
    const fetched = { session: { usedPercent: 95, resetsAt: LATER }, weekly: null, maxPercent: 95, peak: null, status: 'ok' as const }
    const never = async () => { throw new Error('claude fetcher must not serve codex') }
    const codex = async (dir: string) => {
      if (dir === '/cfg/bad') throw new Error('net')
      return fetched
    }
    const out = await withFetchedReadings(new Map(), [acct('cx'), acct('bad')], never, NOW, codex)
    expect(Object.fromEntries(out)).toEqual({ cx: { session: fetched.session, weekly: null, at: NOW } })
    // a codex worker rolls off the full codex account to the one with room
    expect(usagePauseOf('cx', out.get('cx'), 90, NOW)?.percent).toBe(95)
  })
})
