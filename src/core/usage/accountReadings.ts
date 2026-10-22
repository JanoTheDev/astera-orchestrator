// W6-G: each account's latest rate limits, from the statusLine payloads its sessions' capture script wrote
// (`<profile>/statusline/<sid>.json`, StatusLineManager). The windows are the account's, whichever of its sessions
// reported them, so the newest file wins. The usage guard (core/orchestration/usageGuard.ts) reads this in the Host
// and in the app.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AccountReading } from '../orchestration/usageGuard'
import { parseStatusLinePayload } from './statusline'
import type { Account, RateLimitUsage } from '../types'
import { providerOf } from '../providers/meta'
import { READING_MAX_AGE_MS } from '../accounts/autoAccountOrder'
import type { AccountUsage } from '../rolling/retry'

export async function readAccountReadings(
  statuslineDir: string,
  sessions: ReadonlyArray<{ id: string; accountId: string | null | undefined }>
): Promise<Map<string, AccountReading>> {
  const newest = new Map<string, { at: number; reading: AccountReading }>()
  await Promise.all(
    sessions.map(async (s) => {
      if (!s.accountId) return
      const file = path.join(statuslineDir, `${s.id}.json`)
      try {
        const [text, st] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)])
        const u = parseStatusLinePayload(JSON.parse(text))
        if (!u || (!u.session && !u.weekly)) return
        const had = newest.get(s.accountId)
        if (!had || st.mtimeMs > had.at)
          newest.set(s.accountId, { at: st.mtimeMs, reading: { session: u.session, weekly: u.weekly, at: st.mtimeMs } })
      } catch {
        // no payload yet, or one being rewritten: this session tells nothing
      }
    })
  )
  return new Map([...newest].map(([id, v]) => [id, v.reading]))
}

/** A live reading that still answers for its account: no older than READING_MAX_AGE_MS and with its weekly window
 *  (a statusLine that only carries `five_hour` says nothing about the weekly limit). Anything else is fetched. */
function liveIsEnough(r: AccountReading | undefined, nowMs: number): boolean {
  return !!r && r.weekly !== null && (r.at === undefined || nowMs - r.at <= READING_MAX_AGE_MS)
}

/** Per window, the fresher of the live and the fetched reading: the fetched one unless the live one is still fresh and
 *  has that window. */
function fresherOf(live: AccountReading | undefined, fetched: AccountReading, nowMs: number): AccountReading {
  const liveFresh = !!live && (live.at === undefined || nowMs - live.at <= READING_MAX_AGE_MS)
  const pick = (k: 'session' | 'weekly'): AccountReading['session'] =>
    liveFresh && live![k] ? live![k] : (fetched[k] ?? live?.[k] ?? null)
  return { session: pick('session'), weekly: pick('weekly'), at: fetched.at }
}

/** T2 (automatic accounts): `live` plus, for each claude account whose live statusLine reading is missing, older than
 *  ten minutes or without its weekly window (T5a), the account-usage fetcher's windows (RateLimitFetcher, cached by
 *  usageCache.ts), the fresher of the two winning per window, so the guard and the automatic order see idle accounts
 *  instead of "unknown" and an idle session's old snapshot does not hide a weekly 100%. A failed or unavailable fetch
 *  adds nothing: what was known stays. Codex accounts are left out (their fetcher lives in the app). */
export async function withFetchedReadings(
  live: ReadonlyMap<string, AccountReading>,
  accounts: readonly Account[],
  fetch: (configDir: string) => Promise<RateLimitUsage>,
  nowMs: number = Date.now()
): Promise<Map<string, AccountReading>> {
  const out = new Map(live)
  await Promise.all(
    accounts.map(async (a) => {
      if (providerOf(a) !== 'claude' || liveIsEnough(out.get(a.id), nowMs)) return
      try {
        const u = await fetch(a.configDir)
        if (u.status === 'ok' && (u.session || u.weekly))
          out.set(a.id, fresherOf(out.get(a.id), { session: u.session, weekly: u.weekly, at: nowMs }, nowMs))
      } catch {
        // the fetch tells nothing about this account
      }
    })
  )
  return out
}

/** T5a: readings for `accountIds` fit to rank on — what is missing, stale or without its weekly window is fetched
 *  first (withFetchedReadings, through RateLimitFetcher and its cache). */
export async function readingsFresh(
  accountIds: readonly string[],
  d: {
    live: ReadonlyMap<string, AccountReading>
    accounts: readonly Account[]
    fetch: (configDir: string) => Promise<RateLimitUsage>
    nowMs?: number
  }
): Promise<Map<string, AccountReading>> {
  const ids = new Set(accountIds)
  const all = await withFetchedReadings(d.live, d.accounts.filter((a) => ids.has(a.id)), d.fetch, d.nowMs)
  return new Map([...all].filter(([id]) => ids.has(id)))
}

/** T5a: what a roll judges its target by (rolling/retry.ts AccountUsage), kept current for the coordinators, whose
 *  limit verdict is synchronous: `refresh` (the rolling tick, and once at start) reads every session's statusLine,
 *  fetches through readingsFresh what is missing, stale or weekly-less, and counts the live sessions per account;
 *  `current` hands the last result, or null before the first one. Overlapping refreshes share one read. */
export function createAccountUsageSource(d: {
  statuslineDir: string
  sessions(): ReadonlyArray<{ id: string; accountId: string | null | undefined }>
  accounts(): Promise<readonly Account[]>
  fetch(configDir: string): Promise<RateLimitUsage>
  pauseAt(): Promise<number>
  nowMs?(): number
}): { refresh(): Promise<void>; current(): AccountUsage | null } {
  let last: AccountUsage | null = null
  let inFlight: Promise<void> | null = null
  const read = async (): Promise<void> => {
    const sessions = d.sessions()
    const [live, accounts, pauseAt] = await Promise.all([readAccountReadings(d.statuslineDir, sessions), d.accounts(), d.pauseAt()])
    const readings = await readingsFresh(
      accounts.map((a) => a.id),
      { live, accounts, fetch: d.fetch, nowMs: d.nowMs?.() ?? Date.now() }
    )
    const liveSessions = new Map<string, number>()
    for (const s of sessions) if (s.accountId) liveSessions.set(s.accountId, (liveSessions.get(s.accountId) ?? 0) + 1)
    last = { readings, pauseAt, liveSessions }
  }
  return {
    refresh() {
      inFlight ??= read().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    current: () => last
  }
}
