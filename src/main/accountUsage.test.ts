import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Account, AccountUsage, RateLimitUsage } from '../core/types'
import { AccountUsageStore, type RememberedUsage } from './accountUsageStore'
import { createAccountUsage, TICK_MS, REFRESH_MIN_GAP_MS } from './accountUsage'
import { ERROR_USAGE, TTL_OK_MS, UsageCache, type UsageAttempt } from '../core/usage/usageCache'

const HOUR = 3_600_000
const NOW = Date.parse('2026-09-02T12:00:00.000Z')

let dir = ''
let store: AccountUsageStore

const account = (label: string, configDir: string, provider?: 'claude' | 'codex'): Account => ({
  id: label,
  label,
  configDir,
  color: '#5b8dd9',
  createdAt: new Date(NOW).toISOString(),
  ...(provider ? { provider } : {})
})

const ok = (percent: number): RateLimitUsage => ({
  session: { usedPercent: percent, resetsAt: new Date(NOW + HOUR).toISOString() },
  weekly: { usedPercent: 36, resetsAt: new Date(NOW + 96 * HOUR).toISOString() },
  maxPercent: percent,
  peak: { percent, resetsAt: new Date(NOW + 2 * HOUR).toISOString(), weekly: false },
  status: 'ok'
})

const failed: RateLimitUsage = {
  session: null,
  weekly: null,
  maxPercent: null,
  peak: null,
  status: 'unavailable'
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-account-usage-svc-'))
  store = new AccountUsageStore(path.join(dir, 'account-usage.json'), () => NOW)
  await store.load()
})

afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
})

/** An in-memory double for the three fake-timer tests below, matching AccountUsageDeps's
 *  structural store type. A real AccountUsageStore.remember() ends in a real fs.writeFile, and that
 *  write cannot settle inside vi.advanceTimersByTimeAsync's bounded event-loop yields — see the
 *  comment on `store` in accountUsage.ts. This double applies the same refusals the real store does
 *  (non-'ok' status, an unparseable or missing peak.resetsAt, no window at all) and the same past-
 *  peak expiry rule on read, so a test built on it still means what it would mean on the real store.
 */
function fakeStore(): Pick<AccountUsageStore, 'get' | 'remember'> {
  const entries = new Map<string, RememberedUsage>()
  return {
    get(configDir) {
      const entry = entries.get(configDir)
      if (!entry) return null
      if (Date.parse(entry.peak.resetsAt) <= NOW) return null
      return entry
    },
    async remember(configDir, usage) {
      if (usage.status !== 'ok') return
      const resetsAt = usage.peak?.resetsAt ?? null
      if (typeof resetsAt !== 'string' || !Number.isFinite(Date.parse(resetsAt))) return
      if (!usage.session && !usage.weekly) return
      entries.set(configDir, {
        session: usage.session,
        weekly: usage.weekly,
        peak: { percent: usage.peak!.percent, resetsAt, weekly: usage.peak!.weekly },
        readAt: new Date(NOW).toISOString()
      })
    }
  }
}

/** A service over two fetchers whose answer per configDir is scripted. `storeOverride` lets the three
 *  fake-timer tests below supply the in-memory double instead of the shared, disk-backed `store`.
 *
 *  The two fetchers answer from the one `answers` map — configDirs are distinct per provider, so what
 *  a test needs to see is not *what* came back but *which* fetcher was asked. `calls` and `codexCalls`
 *  are that: a configDir appearing in the wrong one is a token read from the wrong file and sent to
 *  the wrong endpoint. */
function harness(
  accounts: Account[],
  answers: Record<string, RateLimitUsage>,
  storeOverride?: Pick<AccountUsageStore, 'get' | 'remember'>
) {
  const sent: Record<string, AccountUsage>[] = []
  const calls: string[] = []
  const codexCalls: string[] = []
  const fetcherLogging = (log: string[]) => ({
    get: async (configDir: string): Promise<RateLimitUsage> => {
      log.push(configDir)
      return answers[configDir] ?? failed
    }
  })
  const svc = createAccountUsage({
    accounts: { list: () => accounts },
    fetcher: fetcherLogging(calls),
    codexFetcher: fetcherLogging(codexCalls),
    store: storeOverride ?? store,
    send: (_channel, payload) => sent.push(payload)
  })
  return { svc, sent, calls, codexCalls }
}

describe('createAccountUsage', () => {
  it('a successful fetch is stored and comes back undimmed', async () => {
    const { svc, sent } = harness([account('main', '/cfg/main')], { '/cfg/main': ok(78) })
    await svc.tick()
    expect(svc.usage()['/cfg/main']).toMatchObject({
      session: { usedPercent: 78 },
      weekly: { usedPercent: 36 },
      remembered: false
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]['/cfg/main'].remembered).toBe(false)
  })

  // The core of §3: an idle account fails every request, and the remembered figure is what the row
  // draws — dimmed, so the person can see it is not live.
  it('a failed fetch falls back to the stored reading, dimmed', async () => {
    const accounts = [account('main', '/cfg/main')]
    const first = harness(accounts, { '/cfg/main': ok(78) })
    await first.svc.tick()

    const second = harness(accounts, {}) // every answer is now 'unavailable'
    await second.svc.tick()
    expect(second.svc.usage()['/cfg/main']).toMatchObject({
      session: { usedPercent: 78 },
      remembered: true
    })
  })

  it('an account with no stored reading and a failing fetch is absent from the map', async () => {
    const { svc } = harness([account('spare', '/cfg/spare')], {})
    await svc.tick()
    expect(svc.usage()['/cfg/spare']).toBeUndefined()
  })

  // A codex account draws the same meter as a claude one, from codex's own endpoint. The routing is
  // what this asserts: a codex configDir must never be sent to Anthropic's endpoint (its token comes
  // out of a different file and would be a stranger's credential there), nor a claude one to codex's.
  it('a codex account is fetched through the codex fetcher and listed', async () => {
    const { svc, calls, codexCalls } = harness(
      [account('main', '/cfg/main'), account('cdx', '/cfg/cdx', 'codex')],
      { '/cfg/main': ok(12), '/cfg/cdx': ok(50) }
    )
    await svc.tick()
    expect(calls).toEqual(['/cfg/main'])
    expect(codexCalls).toEqual(['/cfg/cdx'])
    expect(svc.usage()['/cfg/cdx']).toMatchObject({
      session: { usedPercent: 50 },
      remembered: false
    })
  })

  // The codex counterpart of the fallback test above: an idle codex account answers 401 (auth.json is
  // read-only here — only codex itself refreshes that token), and the row keeps its dimmed figure.
  it('a failed codex fetch falls back to the stored reading, dimmed', async () => {
    const accounts = [account('cdx', '/cfg/cdx', 'codex')]
    await harness(accounts, { '/cfg/cdx': ok(41) }).svc.tick()

    const second = harness(accounts, {}) // every answer is now 'unavailable'
    await second.svc.tick()
    expect(second.svc.usage()['/cfg/cdx']).toMatchObject({
      session: { usedPercent: 41 },
      remembered: true
    })
  })

  it('an account with no provider field counts as claude', async () => {
    const { svc, calls } = harness([account('legacy', '/cfg/legacy')], { '/cfg/legacy': ok(5) })
    await svc.tick()
    expect(calls).toEqual(['/cfg/legacy'])
  })

  it('two accounts sharing a configDir are fetched once', async () => {
    const { svc, calls } = harness(
      [account('a', '/cfg/shared'), account('b', '/cfg/shared')],
      { '/cfg/shared': ok(30) }
    )
    await svc.tick()
    expect(calls).toEqual(['/cfg/shared'])
  })

  // "ok" is not the same as "stored": remember() refuses a reading it cannot date, and an undimmed
  // figure with nothing behind it would be a lie about how fresh it is.
  it('an ok reading the store refuses is not reported as live', async () => {
    const undatable: RateLimitUsage = { ...ok(78), peak: { percent: 78, resetsAt: null, weekly: false } }
    const { svc } = harness([account('main', '/cfg/main')], { '/cfg/main': undatable })
    await svc.tick()
    expect(svc.usage()['/cfg/main']).toBeUndefined()
  })

  it('a fetcher that throws is survived and the account falls back', async () => {
    const accounts = [account('main', '/cfg/main')]
    await harness(accounts, { '/cfg/main': ok(64) }).svc.tick()

    const sent: Record<string, AccountUsage>[] = []
    const svc = createAccountUsage({
      accounts: { list: () => accounts },
      fetcher: {
        get: () => Promise.reject(new Error('boom'))
      },
      codexFetcher: {
        get: () => Promise.reject(new Error('boom'))
      },
      store,
      send: (_c, payload) => sent.push(payload)
    })
    await svc.tick()
    expect(svc.usage()['/cfg/main']?.remembered).toBe(true)
    expect(sent).toHaveLength(1)
  })

  it('subscribe fetches immediately and starts the tick; unsubscribe stops it', async () => {
    vi.useFakeTimers()
    const { svc, calls } = harness([account('main', '/cfg/main')], { '/cfg/main': ok(11) }, fakeStore())

    svc.subscribe()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(1) // the mount fetch

    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(calls).toHaveLength(2)

    svc.unsubscribe()
    await vi.advanceTimersByTimeAsync(TTL_OK_MS * 3)
    expect(calls).toHaveLength(2) // a panel nobody is looking at spends no requests
  })

  it('the tick keeps running while a second subscriber is still mounted', async () => {
    vi.useFakeTimers()
    const { svc, calls } = harness([account('main', '/cfg/main')], { '/cfg/main': ok(11) }, fakeStore())
    svc.subscribe()
    svc.subscribe()
    await vi.advanceTimersByTimeAsync(0)
    const afterMounts = calls.length

    svc.unsubscribe()
    await vi.advanceTimersByTimeAsync(TICK_MS)
    expect(calls.length).toBeGreaterThan(afterMounts)

    svc.unsubscribe()
    const afterStop = calls.length
    await vi.advanceTimersByTimeAsync(TTL_OK_MS * 2)
    expect(calls).toHaveLength(afterStop)
  })

  // T3: the tick at exactly the cache TTL could land a hair early and be served the old entry, doubling the
  // real gap; it runs a little above it.
  it('the tick runs a little above the fetcher success TTL', () => {
    expect(TICK_MS).toBeGreaterThan(TTL_OK_MS)
    expect(TICK_MS).toBeLessThan(TTL_OK_MS * 2)
  })

  it('stop clears the tick however many subscribers were counted', async () => {
    vi.useFakeTimers()
    const { svc, calls } = harness([account('main', '/cfg/main')], { '/cfg/main': ok(11) }, fakeStore())
    svc.subscribe()
    svc.subscribe()
    await vi.advanceTimersByTimeAsync(0)
    const mounted = calls.length

    svc.stop()
    await vi.advanceTimersByTimeAsync(TTL_OK_MS * 3)
    expect(calls).toHaveLength(mounted)
  })
})

/** T3: a fetcher over the real shared cache (UsageCache), with each configDir's answers scripted in order.
 *  What these tests are about is the cache's listener and forget, so the double keeps them real. */
function cachedFetcher(script: Record<string, UsageAttempt[]>, now: () => number = () => NOW) {
  const cache = new UsageCache(now)
  const asked: Array<[string, number | undefined]> = []
  const seen: Record<string, number> = {}
  const attempt = async (dir: string): Promise<UsageAttempt> => {
    const list = script[dir] ?? [{ result: failed }]
    const i = Math.min(seen[dir] ?? 0, list.length - 1)
    seen[dir] = (seen[dir] ?? 0) + 1
    return list[i]
  }
  return {
    asked,
    fetches: (dir: string) => seen[dir] ?? 0,
    get(configDir: string, maxAgeMs?: number) {
      asked.push([configDir, maxAgeMs])
      return cache.get(configDir, maxAgeMs, attempt)
    },
    forget: (configDir: string, opts?: { keepBackOff?: boolean }) => cache.forget(configDir, opts),
    onStored: cache.onStored.bind(cache)
  }
}

describe('createAccountUsage, kept in step with the shared cache (T3)', () => {
  const setup = (script: Record<string, UsageAttempt[]>, opts?: { now?: () => number }) => {
    const sent: Record<string, AccountUsage>[] = []
    const answers: Array<[string, string, boolean]> = []
    const fetcher = cachedFetcher(script, opts?.now)
    const codexFetcher = cachedFetcher({}, opts?.now)
    const svc = createAccountUsage({
      accounts: { list: () => [account('main', '/cfg/main'), account('spare', '/cfg/spare')] },
      fetcher,
      codexFetcher,
      store: fakeStore(),
      send: (_c, payload) => sent.push(payload),
      onAnswer: (dir, a) => answers.push([dir, a.status, a.refused]),
      now: opts?.now
    })
    return { svc, sent, answers, fetcher }
  }

  it('pushes a reading someone else fetched through the shared cache, without waiting for its own tick', async () => {
    const { sent, fetcher } = setup({ '/cfg/main': [{ result: ok(91) }] })
    await fetcher.get('/cfg/main', 10_000) // the limit gate asking, not the panel
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]['/cfg/main']).toMatchObject({ session: { usedPercent: 91 }, remembered: false })
  })

  it('its own tick pushes once, not once per answer plus once at the end', async () => {
    const { svc, sent } = setup({ '/cfg/main': [{ result: ok(20) }], '/cfg/spare': [{ result: ok(30) }] })
    await svc.tick()
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toHaveLength(1)
    expect(Object.keys(sent[0]).sort()).toEqual(['/cfg/main', '/cfg/spare'])
  })

  it('a reading for a folder no account uses is ignored', async () => {
    const { sent, fetcher } = setup({ '/cfg/other': [{ result: ok(5) }] })
    await fetcher.get('/cfg/other')
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toEqual([])
  })

  it('reports each answer with its refusal flag to onAnswer', async () => {
    const { answers, fetcher } = setup({ '/cfg/main': [{ result: ERROR_USAGE('error'), refused: true }] })
    await fetcher.get('/cfg/main')
    expect(answers).toEqual([['/cfg/main', 'error', true]])
  })

  // The sign-in case: a cached "no credentials" would hide the new login for the cache's whole hold.
  it('refetch asks again past a cached missing-credentials answer and pushes the new reading', async () => {
    const { svc, sent, fetcher } = setup({ '/cfg/main': [{ result: ERROR_USAGE('unavailable') }, { result: ok(12) }] })
    await svc.tick()
    expect(svc.usage()['/cfg/main']).toBeUndefined()
    await svc.refetch('/cfg/main')
    expect(fetcher.fetches('/cfg/main')).toBe(2)
    expect(sent.at(-1)?.['/cfg/main']).toMatchObject({ session: { usedPercent: 12 }, remembered: false })
  })

  it('refetch leaves a 429 back-off alone', async () => {
    const { svc, fetcher } = setup({ '/cfg/main': [{ result: ERROR_USAGE('error'), retryAfterMs: 600_000 }, { result: ok(12) }] })
    await svc.tick()
    await svc.refetch('/cfg/main')
    expect(fetcher.fetches('/cfg/main')).toBe(1)
  })

  // The popover-open refresh: fresher than the tick's cache, and at most once per REFRESH_MIN_GAP_MS per account.
  it('refresh reads through a short max age, and only once per gap', async () => {
    let now = NOW
    const { svc, fetcher, sent } = setup({ '/cfg/main': [{ result: ok(1) }] }, { now: () => now })
    await svc.refresh()
    expect(fetcher.asked.map(([, age]) => age)).toEqual([expect.any(Number), expect.any(Number)])
    expect(fetcher.asked[0][1]!).toBeLessThan(TTL_OK_MS)
    expect(sent.length).toBeGreaterThan(0)
    await svc.refresh()
    expect(fetcher.asked).toHaveLength(2) // inside the gap: nothing asked
    now += REFRESH_MIN_GAP_MS
    await svc.refresh()
    expect(fetcher.asked).toHaveLength(4)
  })
})
