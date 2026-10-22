import { describe, it, expect } from 'vitest'
import type { Account, RateLimitUsage } from '../types'
import type { AccountReading } from '../orchestration/usageGuard'
import { readingsFresh, withFetchedReadings } from './accountReadings'

const NOW = Date.parse('2026-10-22T12:00:00Z')
const LATER = '2026-10-22T14:00:00Z'
const acct = (id: string): Account => ({ id, label: id, configDir: `/cfg/${id}`, color: '#fff', createdAt: LATER, provider: 'claude' })
const win = (usedPercent: number) => ({ usedPercent, resetsAt: LATER })
const usage = (session: number, weekly: number): RateLimitUsage => ({ session: win(session), weekly: win(weekly), maxPercent: Math.max(session, weekly), peak: null, status: 'ok' })

/** The fetcher, recording which accounts were asked. */
const fetcher = (answers: Record<string, RateLimitUsage>) => {
  const asked: string[] = []
  return {
    asked,
    fetch: async (dir: string) => {
      asked.push(dir)
      return answers[dir]
    }
  }
}

describe('withFetchedReadings (T5a)', () => {
  it('a fresh live reading with its weekly window is enough: no fetch', async () => {
    const f = fetcher({})
    const live = new Map<string, AccountReading>([['a', { session: win(5), weekly: win(10), at: NOW - 60_000 }]])
    expect(await withFetchedReadings(live, [acct('a')], f.fetch, NOW)).toEqual(live)
    expect(f.asked).toEqual([])
  })

  it('a 20-minute-old statusLine reading triggers a fetch, and the fetched windows win', async () => {
    const f = fetcher({ '/cfg/a': usage(30, 100) })
    const live = new Map<string, AccountReading>([['a', { session: win(0), weekly: win(10), at: NOW - 20 * 60_000 }]])
    const out = await withFetchedReadings(live, [acct('a')], f.fetch, NOW)
    expect(f.asked).toEqual(['/cfg/a'])
    expect(out.get('a')).toEqual({ session: win(30), weekly: win(100), at: NOW })
  })

  it('a statusLine reading with weekly null triggers a fetch; the fresh live 5-hour window is kept', async () => {
    const f = fetcher({ '/cfg/a': usage(30, 100) })
    const live = new Map<string, AccountReading>([['a', { session: win(2), weekly: null, at: NOW - 60_000 }]])
    const out = await withFetchedReadings(live, [acct('a')], f.fetch, NOW)
    expect(f.asked).toEqual(['/cfg/a'])
    expect(out.get('a')).toEqual({ session: win(2), weekly: win(100), at: NOW })
  })

  it('a failed fetch keeps what was known', async () => {
    const live = new Map<string, AccountReading>([['a', { session: win(2), weekly: null, at: NOW - 60_000 }]])
    const out = await withFetchedReadings(live, [acct('a')], async () => { throw new Error('429') }, NOW)
    expect(out.get('a')).toEqual(live.get('a'))
  })
})

describe('readingsFresh', () => {
  it('fetches only the asked accounts that need it and returns only those', async () => {
    const f = fetcher({ '/cfg/b': usage(40, 40), '/cfg/c': usage(1, 1) })
    const live = new Map<string, AccountReading>([['a', { session: win(5), weekly: win(5), at: NOW }]])
    const out = await readingsFresh(['a', 'b'], { live, accounts: [acct('a'), acct('b'), acct('c')], fetch: f.fetch, nowMs: NOW })
    expect(f.asked).toEqual(['/cfg/b'])
    expect([...out.keys()].sort()).toEqual(['a', 'b'])
  })
})

describe('createAccountUsageSource', () => {
  it('reads the statusLine, fetches what is stale or weekly-less, and counts live sessions per account', async () => {
    const { promises: fs } = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const { createAccountUsageSource } = await import('./accountReadings')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-usage-src-'))
    try {
      // a's only session reports 0% 5-hour and no weekly window: the fetch says weekly is 100%
      await fs.writeFile(path.join(dir, 's1.json'), JSON.stringify({ rate_limits: { five_hour: { used_percentage: 0 } } }))
      const f = fetcher({ '/cfg/a': usage(0, 100), '/cfg/b': usage(40, 40) })
      const src = createAccountUsageSource({
        statuslineDir: dir,
        sessions: () => [{ id: 's1', accountId: 'a' }, { id: 's2', accountId: 'a' }, { id: 's3', accountId: null }],
        accounts: async () => [acct('a'), acct('b')],
        fetch: f.fetch,
        pauseAt: async () => 90
      })
      expect(src.current()).toBeNull()
      await src.refresh()
      const u = src.current()!
      expect(u.pauseAt).toBe(90)
      expect(u.readings.get('a')?.weekly).toEqual(win(100))
      expect(u.readings.get('b')?.weekly).toEqual(win(40))
      expect([...u.liveSessions!]).toEqual([['a', 2]])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
