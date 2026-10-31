// T3 (account center sync): what the shared usage cache tells its listeners, and what a login change may
// forget. The panel pushes a reading whoever fetched it, so these are the facts that push rests on.
import { describe, it, expect } from 'vitest'
import type { RateLimitUsage } from '../types'
import { ERROR_USAGE, TTL_OK_MS, TTL_UNAVAILABLE_MS, UsageCache, type UsageAttempt } from './usageCache'
import { refusedLogin } from './rateLimitFetcher'
import { jwtExpiryMs } from './codexUsageFetcher'

const OK: RateLimitUsage = {
  session: { usedPercent: 10, resetsAt: null },
  weekly: null,
  maxPercent: 10,
  peak: null,
  status: 'ok'
}

function harness(answers: UsageAttempt[]) {
  let now = 1_000_000
  const cache = new UsageCache(() => now)
  let calls = 0
  const attempt = async (): Promise<UsageAttempt> => answers[Math.min(calls++, answers.length - 1)]
  return {
    cache,
    get: () => cache.get('/cfg/a', undefined, attempt),
    calls: () => calls,
    advance: (ms: number) => void (now += ms)
  }
}

describe('UsageCache (T3)', () => {
  it('holds a missing-credentials answer only as long as an ordinary failure, not the success TTL', async () => {
    const h = harness([{ result: ERROR_USAGE('unavailable') }, { result: OK }])
    await h.get()
    h.advance(TTL_UNAVAILABLE_MS)
    expect(await h.get()).toEqual(OK)
    expect(h.calls()).toBe(2)
    expect(TTL_UNAVAILABLE_MS).toBeLessThan(TTL_OK_MS)
  })

  it('tells its listeners about each fetched answer, with the refusal flag, and not about cache hits', async () => {
    const h = harness([{ result: ERROR_USAGE('error'), refused: true }, { result: OK }])
    const heard: Array<[string, string, boolean]> = []
    h.cache.onStored((dir, r, info) => heard.push([dir, r.status, info.refused]))
    await h.get()
    await h.get() // inside the error TTL: a cache hit
    h.advance(60_000)
    await h.get()
    expect(heard).toEqual([
      ['/cfg/a', 'error', true],
      ['/cfg/a', 'ok', false]
    ])
  })

  it('a throwing listener does not fail the fetch, and an unsubscribed one hears nothing', async () => {
    const h = harness([{ result: OK }])
    h.cache.onStored(() => {
      throw new Error('listener blew up')
    })
    const heard: string[] = []
    const off = h.cache.onStored((d) => heard.push(d))
    off()
    expect(await h.get()).toEqual(OK)
    expect(heard).toEqual([])
  })

  it('forget makes the next ask fetch again, bypassing a cached missing-credentials answer', async () => {
    const h = harness([{ result: ERROR_USAGE('unavailable') }, { result: OK }])
    await h.get()
    h.cache.forget('/cfg/a', { keepBackOff: true })
    expect(await h.get()).toEqual(OK)
  })

  it('forget with keepBackOff leaves a live 429 back-off in place', async () => {
    const h = harness([{ result: ERROR_USAGE('error'), retryAfterMs: 120_000 }, { result: OK }])
    await h.get()
    h.cache.forget('/cfg/a', { keepBackOff: true })
    expect((await h.get()).status).toBe('error')
    expect(h.calls()).toBe(1)
    h.cache.forget('/cfg/a') // a plain forget still drops it (an email change: another person's back-off)
    expect(await h.get()).toEqual(OK)
  })
})

describe('refusedLogin', () => {
  it('a 401/403 on a token that should still be good, or has no recorded expiry, is a refused login', () => {
    expect(refusedLogin(401, 2_000, 1_000)).toBe(true)
    expect(refusedLogin(403, null, 1_000)).toBe(true)
  })
  it('a 401 on a token already past its expiry is a stale token, not a refused login', () => {
    expect(refusedLogin(401, 500, 1_000)).toBe(false)
  })
  it('other statuses are never a refused login', () => {
    expect(refusedLogin(500, null, 1_000)).toBe(false)
    expect(refusedLogin(429, null, 1_000)).toBe(false)
  })
})

describe('jwtExpiryMs', () => {
  const jwt = (payload: object): string =>
    `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`
  it('reads the exp claim in ms', () => {
    expect(jwtExpiryMs(jwt({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000)
  })
  it('anything else is null', () => {
    expect(jwtExpiryMs('not-a-jwt')).toBeNull()
    expect(jwtExpiryMs(jwt({ sub: 'x' }))).toBeNull()
    expect(jwtExpiryMs('a.%%%.b')).toBeNull()
  })
})
