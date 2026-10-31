// T3 (account center sync): the one "this account's login changed" signal, from each of its sources.
vi.mock('electron', () => ({}))
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Account, AccountUsage, RateLimitUsage } from '../core/types'
import { createAccountSync, CREDENTIALS_POLL_MS } from './accountSync'
import { createAccountUsage } from './accountUsage'
import { accountLoginHandlers, type LoginProc } from './accountLogin'
import { ERROR_USAGE, UsageCache, type UsageAttempt } from '../core/usage/usageCache'
import type { AccountUsageStore } from './accountUsageStore'

const NOW = Date.parse('2026-10-31T12:00:00.000Z')
const HOUR = 3_600_000

const account = (id: string, configDir = `/cfg/${id}`): Account => ({
  id,
  label: id,
  configDir,
  color: '#5b8dd9',
  createdAt: new Date(NOW).toISOString()
})

const ok = (percent: number): RateLimitUsage => ({
  session: { usedPercent: percent, resetsAt: new Date(NOW + HOUR).toISOString() },
  weekly: null,
  maxPercent: percent,
  peak: { percent, resetsAt: new Date(NOW + HOUR).toISOString(), weekly: false },
  status: 'ok'
})

function memoryStore(): Pick<AccountUsageStore, 'get' | 'remember'> {
  const m = new Map<string, ReturnType<AccountUsageStore['get']>>()
  return {
    get: (d) => m.get(d) ?? null,
    async remember(d, u) {
      if (u.status !== 'ok' || !u.peak?.resetsAt) return
      m.set(d, { session: u.session, weekly: u.weekly, peak: { ...u.peak, resetsAt: u.peak.resetsAt }, readAt: new Date(NOW).toISOString() })
    }
  }
}

function world(opts: { accounts: Account[]; loggedIn?: Record<string, boolean>; script?: Record<string, UsageAttempt[]> }) {
  const loggedIn = { ...(opts.loggedIn ?? {}) }
  const mtimes: Record<string, number | null> = {}
  const events: string[] = []
  const pushes: Record<string, AccountUsage>[] = []
  const cache = new UsageCache(() => NOW)
  const fetched: Record<string, number> = {}
  const fetcher = {
    get: (dir: string, age?: number) =>
      cache.get(dir, age, async (d) => {
        const list = opts.script?.[d] ?? [{ result: ERROR_USAGE('unavailable') }]
        const i = Math.min(fetched[d] ?? 0, list.length - 1)
        fetched[d] = (fetched[d] ?? 0) + 1
        return list[i]
      }),
    forget: (d: string, o?: { keepBackOff?: boolean }) => cache.forget(d, o),
    onStored: cache.onStored.bind(cache)
  }
  // eslint-disable-next-line prefer-const
  let sync: ReturnType<typeof createAccountSync>
  const usage = createAccountUsage({
    accounts: { list: () => opts.accounts },
    fetcher,
    codexFetcher: fetcher,
    store: memoryStore(),
    send: (_c, p) => void pushes.push(p),
    onAnswer: (dir, a) => sync.answer(dir, a)
  })
  sync = createAccountSync({
    accounts: { list: () => opts.accounts, loginStatus: async (id) => loggedIn[id] ?? false },
    email: async () => null,
    usage,
    send: (_c, p) => void events.push(p.accountId),
    credentialsMtime: async (a) => mtimes[a.id] ?? null
  })
  return { sync, usage, fetcher, events, pushes, loggedIn, mtimes, fetched }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createAccountSync', () => {
  it('after an in-app sign-in completes, pushes the change and fetches usage past a cached missing-credentials answer', async () => {
    const w = world({ accounts: [account('a1')], script: { '/cfg/a1': [{ result: ERROR_USAGE('unavailable') }, { result: ok(42) }] } })
    await w.usage.tick() // before sign-in: no credentials, cached
    expect(w.usage.usage()['/cfg/a1']).toBeUndefined()

    let exit!: (code: number) => void
    const proc: LoginProc = { onOutput: () => {}, exited: new Promise((r) => (exit = r)), write: () => {}, kill: () => {} }
    const login = accountLoginHandlers({
      account: (id) => account(id),
      run: () => proc,
      loggedIn: async (id) => w.loggedIn[id] ?? false,
      onFinished: (id) => w.sync.changed(id)
    })
    const done = login.login('a1')
    w.loggedIn.a1 = true // the CLI wrote the credentials
    exit(0)
    expect(await done).toEqual({ ok: true })

    await vi.waitFor(() => expect(w.pushes.at(-1)?.['/cfg/a1']).toMatchObject({ session: { usedPercent: 42 }, remembered: false }))
    expect(w.events).toContain('a1')
    expect(w.fetched['/cfg/a1']).toBe(2)
    expect(await w.sync.status('a1')).toEqual({ login: 'signedIn', email: null })
  })

  it('a refused login (401/403) marks the account expired and pushes the change; a later good answer clears it', async () => {
    const w = world({
      accounts: [account('a1')],
      loggedIn: { a1: true },
      script: { '/cfg/a1': [{ result: ERROR_USAGE('error'), refused: true }, { result: ok(3) }] }
    })
    await w.fetcher.get('/cfg/a1')
    expect(w.events).toEqual(['a1'])
    expect((await w.sync.status('a1')).login).toBe('expired')

    await w.fetcher.get('/cfg/a1') // inside the error TTL: a cache hit, no second signal
    expect(w.events).toEqual(['a1'])

    w.fetcher.forget('/cfg/a1')
    await w.fetcher.get('/cfg/a1')
    expect(w.events).toEqual(['a1', 'a1'])
    expect((await w.sync.status('a1')).login).toBe('signedIn')
  })

  it('an ordinary failure (not a refusal) does not mark the account expired', async () => {
    const w = world({ accounts: [account('a1')], loggedIn: { a1: true }, script: { '/cfg/a1': [{ result: ERROR_USAGE('error') }] } })
    await w.fetcher.get('/cfg/a1')
    expect(w.events).toEqual([])
    expect((await w.sync.status('a1')).login).toBe('signedIn')
  })

  it('a signed-out account is signed out, whatever was refused before', async () => {
    const w = world({ accounts: [account('a1')], script: { '/cfg/a1': [{ result: ERROR_USAGE('error'), refused: true }] } })
    await w.fetcher.get('/cfg/a1')
    expect((await w.sync.status('a1')).login).toBe('signedOut')
  })

  it('an in-app change clears the expired mark, and its refetch can set it again', async () => {
    const w = world({
      accounts: [account('a1')],
      loggedIn: { a1: true },
      script: { '/cfg/a1': [{ result: ERROR_USAGE('error'), refused: true }, { result: ERROR_USAGE('error') }, { result: ERROR_USAGE('error'), refused: true }] }
    })
    await w.fetcher.get('/cfg/a1')
    await w.sync.changed('a1') // its refetch answers an ordinary failure
    expect((await w.sync.status('a1')).login).toBe('signedIn')
    await w.sync.changed('a1') // and this one is refused again
    expect((await w.sync.status('a1')).login).toBe('expired')
  })

  it('a credentials file written outside the app produces the signal; the first look only records it', async () => {
    const w = world({ accounts: [account('a1'), account('a2')] })
    w.mtimes.a1 = 100
    w.mtimes.a2 = null
    await w.sync.poll()
    expect(w.events).toEqual([])

    w.mtimes.a2 = 200 // `claude /login` in a terminal
    await w.sync.poll()
    expect(w.events).toEqual(['a2'])

    w.mtimes.a1 = null // logged out in a terminal
    await w.sync.poll()
    expect(w.events).toEqual(['a2', 'a1'])

    await w.sync.poll() // nothing moved
    expect(w.events).toEqual(['a2', 'a1'])
  })

  it('its own change does not come back from the poll as an outside change', async () => {
    const w = world({ accounts: [account('a1')] })
    w.mtimes.a1 = null
    await w.sync.poll()
    w.mtimes.a1 = 300 // the in-app sign-in wrote it
    await w.sync.changed('a1')
    await w.sync.poll()
    expect(w.events).toEqual(['a1'])
  })

  it('start polls every CREDENTIALS_POLL_MS until stopped', async () => {
    vi.useFakeTimers()
    const w = world({ accounts: [account('a1')] })
    w.mtimes.a1 = 1
    w.sync.start()
    await vi.advanceTimersByTimeAsync(CREDENTIALS_POLL_MS)
    w.mtimes.a1 = 2
    await vi.advanceTimersByTimeAsync(CREDENTIALS_POLL_MS)
    expect(w.events).toEqual(['a1'])
    w.sync.stop()
    w.mtimes.a1 = 3
    await vi.advanceTimersByTimeAsync(CREDENTIALS_POLL_MS * 2)
    expect(w.events).toEqual(['a1'])
  })

  it('a change for an id no longer registered is a no-op', async () => {
    const w = world({ accounts: [account('a1')] })
    await w.sync.changed('gone')
    expect(w.events).toEqual([])
  })
})
