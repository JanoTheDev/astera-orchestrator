import type { Account, AccountUsage, RateLimitUsage } from '../core/types'
import { providerOf } from '../core/providers/meta'
import { TTL_OK_MS, type UsageStoredListener } from '../core/usage/usageCache'
import type { AccountUsageStore } from './accountUsageStore'

/** The tick runs a little above the fetcher's own success TTL, so every tick is the first ask its cache
 *  will not serve (design doc §4). It used to be exactly the TTL, and timer jitter then landed a tick a
 *  hair early: the cache handed back the old entry and the real gap approached two TTLs (T3). Readings
 *  between ticks come from the shared cache's listener (below), so the tick is only the floor. */
export const TICK_MS = TTL_OK_MS + 15_000

/** T3: an explicit refresh (the account popover opening) reads through this max age instead of the
 *  success TTL, so the figure it shows was taken within the last minute. */
export const REFRESH_MAX_AGE_MS = 60_000
/** T3: and asks at most once per this gap per account, so opening the popover repeatedly does not hammer
 *  the endpoint. */
export const REFRESH_MIN_GAP_MS = 30_000

/** What both providers' fetchers look like from here. The two differ in where the token comes from and
 *  which endpoint is asked, and in nothing this module can see. `forget` and `onStored` are the shared
 *  cache's (core/usage/usageCache.ts); optional so a test double can be a bare `get`. */
export interface UsageFetcher {
  get(configDir: string, maxAgeMs?: number): Promise<RateLimitUsage>
  forget?(configDir: string, opts?: { keepBackOff?: boolean }): void
  onStored?(listener: UsageStoredListener): () => void
}

export interface AccountUsageDeps {
  accounts: { list(): Account[] }
  /** RateLimitFetcher, reused unchanged. It already carries the 5-minute success cache, the capped
   *  15-minute 429 back-off, and in-flight coalescing per configDir. */
  fetcher: UsageFetcher
  /** CodexUsageFetcher — the same policy against codex's own endpoint (core/usage/codexUsageFetcher.ts). Separate
   *  rather than one fetcher that branches, because the branch is about credentials and endpoints and
   *  belongs on the provider's side of the line, not here. */
  codexFetcher: UsageFetcher
  /** Structural, not the concrete class: the service only ever calls `get` and `remember` (below).
   *  Kept narrow for the same reason readAccessToken in core/usage/rateLimitFetcher.ts is a plain function rather than a
   *  private class method — a test can hand in an in-memory double instead of a real file, because
   *  the real store's `persist()` write cannot settle inside vi.advanceTimersByTimeAsync's bounded
   *  event-loop yields. */
  store: Pick<AccountUsageStore, 'get' | 'remember'>
  send: (channel: 'usage:accounts-updated', payload: Record<string, AccountUsage>) => void
  /** T3: every answer the shared cache stored for a registered account's folder, whoever asked for it.
   *  `refused` is a 401/403 on a token that should still be good (core/usage/rateLimitFetcher.ts
   *  refusedLogin) — main/accountSync.ts turns it into the row's "expired" state. */
  onAnswer?: (configDir: string, answer: { status: RateLimitUsage['status']; refused: boolean }) => void
  now?: () => number
}

export interface AccountUsageService {
  usage(): Record<string, AccountUsage>
  subscribe(): void
  unsubscribe(): void
  stop(): void
  tick(): Promise<void>
  /** T3: the popover opened. Asks every account not asked within REFRESH_MIN_GAP_MS, through
   *  REFRESH_MAX_AGE_MS, and pushes the map. Works whether or not anything is subscribed. */
  refresh(): Promise<void>
  /** T3: this folder's login changed (sign-in, sign-out, add, an email change, a credentials file written
   *  outside the app). Forgets the cached answer (a 429 back-off excepted), fetches once, pushes. */
  refetch(configDir: string): Promise<void>
}

/**
 * Per-account usage for the account rows (design doc §4). Owns nothing about display — it fetches,
 * remembers what succeeded, and pushes the map; the rows draw it.
 *
 * An idle account fails its request every time (§3), which looks like waste and is actually the
 * recovery path: the moment a session starts on that account, the CLI refreshes its token and the
 * next tick picks up a live figure. Without the repeat, an account would stay on its remembered
 * reading until the panel was remounted. That holds for both providers — `claude` and `codex` each
 * refresh the token of the account they are running on, and neither fetcher writes one.
 *
 * Both providers are asked. Codex was out of scope when this was written (§1) because the only
 * endpoint on hand was Anthropic's; codex has one of its own, answering the same two windows
 * (core/usage/codexUsageFetcher.ts), so a codex row now draws the same meter as a claude row.
 *
 * T3 (account center sync): the panel also hears every answer the shared fetcher cache stores, through
 * `onStored`, so a reading the limit gate (10 s) or the usage guard took reaches the row at once instead
 * of up to a tick later — the row and the "Paused" chip no longer read figures of different ages.
 */
export function createAccountUsage(deps: AccountUsageDeps): AccountUsageService {
  const now = deps.now ?? Date.now
  // The configDirs whose most recent attempt actually reached the API and produced a reading the
  // store kept. Everything else the store answers for is a remembered reading, and the row dims it.
  // "The last try failed" is the exact fact; comparing readAt against a clock would only be a guess
  // at it, and would make a row flicker as a reading crossed the boundary.
  const live = new Set<string>()
  let subscribers = 0
  let timer: NodeJS.Timeout | null = null
  let inFlight = false
  // The folders a tick or refresh of this service is fetching right now. Their answers are handled by
  // that round (and pushed once at its end); the cache listener handles everyone else's.
  const ownRound = new Set<string>()
  const lastRefresh = new Map<string, number>()

  /** Every registered account's configDir with the fetcher that can answer for it. The pairing is the
   *  point: the two endpoints take different credentials from different files, so a codex configDir
   *  must never reach the Anthropic fetcher or the other way round.
   *
   *  Deduplicated by configDir, because two registered accounts can share one and a directory has one
   *  usage figure. A directory shared across providers cannot happen — the two CLIs keep their own
   *  homes — so the first account's fetcher wins and there is nothing to reconcile. */
  const targets = (): Map<string, UsageFetcher> => {
    const out = new Map<string, UsageFetcher>()
    for (const a of deps.accounts.list()) {
      if (out.has(a.configDir)) continue
      out.set(a.configDir, providerOf(a) === 'codex' ? deps.codexFetcher : deps.fetcher)
    }
    return out
  }

  const usage = (): Record<string, AccountUsage> => {
    const out: Record<string, AccountUsage> = {}
    for (const configDir of targets().keys()) {
      // The store is the memory — a live reading was written to it on the tick that fetched it, so
      // there is no second in-memory map to keep in step with it. An account with nothing to show is
      // simply absent, which is what the row reads as "draw nothing" (§5).
      const entry = deps.store.get(configDir)
      if (!entry) continue
      out[configDir] = {
        session: entry.session,
        weekly: entry.weekly,
        readAt: entry.readAt,
        remembered: !live.has(configDir)
      }
    }
    return out
  }

  /** One answer into the store and the live set. 'ok' does not mean stored: remember() refuses a reading
   *  it cannot date (§3.2). Only an entry the store actually kept counts as live, or the row would draw an
   *  undimmed figure with nothing behind it. */
  const apply = async (configDir: string, result: RateLimitUsage | null): Promise<void> => {
    if (!result || result.status !== 'ok') {
      live.delete(configDir)
      return
    }
    await deps.store.remember(configDir, result)
    if (deps.store.get(configDir)) live.add(configDir)
    else live.delete(configDir)
  }

  /** Asks `dirs` (each with its fetcher), applies the answers, pushes the map once. */
  async function round(dirs: Array<[string, UsageFetcher]>, maxAgeMs?: number): Promise<void> {
    for (const [d] of dirs) ownRound.add(d)
    try {
      // Concurrent, one request per directory. Four accounts is at most four requests per five
      // minutes, only while a panel is on screen, and the limit is counted per account token — so
      // from any one account's side the load is identical to the existing one-per-five-minutes.
      const results = await Promise.all(
        dirs.map(
          async ([configDir, fetcher]) =>
            [configDir, await fetcher.get(configDir, maxAgeMs).catch(() => null)] as const
        )
      )
      for (const [configDir, result] of results) await apply(configDir, result)
    } finally {
      for (const [d] of dirs) ownRound.delete(d)
    }
    deps.send('usage:accounts-updated', usage())
  }

  async function tick(): Promise<void> {
    if (inFlight) return
    inFlight = true
    try {
      await round([...targets()])
    } finally {
      inFlight = false
    }
  }

  // The shared cache's listener: an answer someone else fetched (the limit gate, the usage guard, rolling's
  // account source) is applied and pushed at once. A folder no account uses is none of the panel's business.
  // Registered once per fetcher for the service's life; the cache outlives no one, both live in main.
  const onStored: UsageStoredListener = (configDir, result, info) => {
    if (!targets().has(configDir)) return
    deps.onAnswer?.(configDir, { status: result.status, refused: info.refused })
    if (ownRound.has(configDir)) return // that round applies it and pushes once at its end
    void apply(configDir, result)
      .then(() => deps.send('usage:accounts-updated', usage()))
      .catch(() => {}) // a send failure must not become an unhandled rejection (see ensureTimer)
  }
  deps.fetcher.onStored?.(onStored)
  if (deps.codexFetcher !== deps.fetcher) deps.codexFetcher.onStored?.(onStored)

  const ensureTimer = (): void => {
    // tick's own failures are already handled inside it (each fetch is caught per directory) — the
    // only thing that can still escape is deps.send throwing. .catch is the last backstop so that
    // cannot become an unhandled rejection, which can terminate the process.
    if (subscribers > 0 && timer === null) timer = setInterval(() => void tick().catch(() => {}), TICK_MS)
  }
  const dropTimer = (): void => {
    if (subscribers === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  return {
    usage,
    subscribe(): void {
      subscribers += 1
      ensureTimer()
      // The mount fetch (§4). Fired here rather than left to the first interval, which is five
      // minutes away — a panel that has just opened must not sit on a stale figure that long. The
      // fetcher's cache absorbs the cost when a second panel mounts moments later.
      // Same backstop as the interval's tick above (see ensureTimer) — a send failure here must not
      // become an unhandled rejection either.
      void tick().catch(() => {})
    },
    unsubscribe(): void {
      subscribers = Math.max(0, subscribers - 1)
      dropTimer()
    },
    stop(): void {
      subscribers = 0
      dropTimer()
    },
    tick,
    async refresh(): Promise<void> {
      const t = now()
      const due = [...targets()].filter(([d]) => t - (lastRefresh.get(d) ?? -Infinity) >= REFRESH_MIN_GAP_MS)
      if (due.length === 0) return
      for (const [d] of due) lastRefresh.set(d, t)
      await round(due, REFRESH_MAX_AGE_MS)
    },
    async refetch(configDir: string): Promise<void> {
      const fetcher = targets().get(configDir)
      if (!fetcher) return
      fetcher.forget?.(configDir, { keepBackOff: true })
      await round([[configDir, fetcher]])
    }
  }
}
