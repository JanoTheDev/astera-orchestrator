import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { Account, Provider } from '../../../core/types'
import { PROVIDERS } from '../../../core/providers/meta'
import { defaultAccountIdOf } from '../../../core/accounts/defaultAccount'
import { useCachedRead } from '../lib/readCache'
import { followAccountUsage, refreshAccountUsage } from './useAccountUsage'

/** T3: the account list as the workbench holds it — subscribed to `accounts:changed` before the first
 *  `accounts.list()` is asked, and that first answer dropped when a push landed before it, so a slow startup
 *  read can never put an older list back over a newer pushed one. Returns the stop. */
export function followAccountsList(o: {
  ask: () => Promise<Account[]>
  on: (cb: (accounts: Account[]) => void) => () => void
  set: (accounts: Account[]) => void
}): () => void {
  return followAccountUsage<Account[]>(o)
}

/**
 * Login state and email per account, for every surface in the window (T3, account center sync).
 *
 * ## Hook API (what the account popover, Settings › Accounts & usage and the pickers read)
 *
 * `useAccountStatus(accounts)` returns:
 * - `loginStates: Record<id, AccountLoginState>` — the full state: `signedIn`, `signedOut`, `expired`
 *   (credentials on disk that the usage endpoint refused; draw it as "sign in again") or `unknown` (the
 *   probe failed and nothing was known before). An account is absent only until its first answer.
 * - `loginMap: Record<id, boolean>` — the same, flattened for the older readers: `signedIn` is true,
 *   `signedOut` and `expired` are false, `unknown` is left out (loginMapOf).
 * - `emailMap: Record<id, string | null>` — the login email; a failed probe keeps the last one.
 * - `defaultIdByProvider` — each provider's default account, derived from the list and `loginMap`.
 * - `refresh()` — re-probe every mounted account now and ask main for fresher usage figures (rate-limited
 *   there). The popover calls it on open; mounting a hook already re-probes accounts not asked in the
 *   last MOUNT_FRESH_MS, so a popover that mounts on open gets this for free.
 *
 * ## Where the answers come from
 *
 * One store for the window (createAccountStatusStore): one `accounts.status` ask per account however many
 * hooks are mounted, re-asked on main's `accounts:status-changed` push (an in-app sign-in or sign-out, an
 * add or import, an email change, a credentials file written outside the app, a refused or accepted
 * credential: main/accountSync.ts), on window focus, and every STATUS_POLL_MS while any hook is mounted.
 * Before this, each mounted copy probed on its own and only on focus or a new account list, so two
 * surfaces could disagree and an in-app sign-in showed nowhere until the window lost and regained focus.
 */

/** The row's login state; see the header. */
export type AccountLoginState = 'signedIn' | 'signedOut' | 'expired' | 'unknown'

/** What main answers per account (accounts.status). */
export interface AccountStatusAnswer {
  login: 'signedIn' | 'signedOut' | 'expired'
  email: string | null
}

export interface AccountStatusSnapshot {
  states: Record<string, AccountLoginState>
  emails: Record<string, string | null>
}

/** How often a mounted surface re-asks, for what no push reports (a Keychain login on macOS, say). */
export const STATUS_POLL_MS = 60_000
/** A hook mounting re-asks an account not asked within this — enough to absorb a burst of mounts. */
export const MOUNT_FRESH_MS = 2_000

/** The boolean view the older readers take; see the header. */
export function loginMapOf(states: Record<string, AccountLoginState>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const [id, s] of Object.entries(states)) {
    if (s === 'unknown') continue
    out[id] = s === 'signedIn'
  }
  return out
}

/** The window-wide store, without React or `window` so it runs in a node test. */
export function createAccountStatusStore(io: {
  status: (id: string) => Promise<AccountStatusAnswer>
  /** main's `accounts:status-changed` push. Returns the unsubscribe. */
  onChanged: (cb: (accountId: string) => void) => () => void
  onFocus: (cb: () => void) => () => void
  every: (ms: number, cb: () => void) => () => void
  refreshUsage?: () => void
  now?: () => number
}) {
  const now = io.now ?? Date.now
  let snap: AccountStatusSnapshot = { states: {}, emails: {} }
  const listeners = new Set<() => void>()
  const tracked = new Map<string, number>() // id -> how many mounted hooks show it
  const seq = new Map<string, number>() // id -> the newest ask's ticket
  const askedAt = new Map<string, number>()
  let mounts = 0
  let unwire: (() => void) | null = null

  const emit = (): void => listeners.forEach((l) => l())

  const probe = (id: string): void => {
    const ticket = (seq.get(id) ?? 0) + 1
    seq.set(id, ticket)
    askedAt.set(id, now())
    io.status(id).then(
      (a) => {
        if (seq.get(id) !== ticket) return // a newer ask is out: its answer is the one that lands
        snap = { states: { ...snap.states, [id]: a.login }, emails: { ...snap.emails, [id]: a.email } }
        emit()
      },
      () => {
        if (seq.get(id) !== ticket) return
        // We could not tell. The last known state stands; with none, "unknown", so the row still offers its
        // sign-in and sign-out items (components/accountActions.ts).
        if (snap.states[id] !== undefined) return
        snap = { ...snap, states: { ...snap.states, [id]: 'unknown' } }
        emit()
      }
    )
  }
  const probeAll = (): void => {
    for (const id of tracked.keys()) probe(id)
  }

  const wire = (): void => {
    const offs = [
      io.onChanged((id) => {
        if (tracked.has(id)) probe(id)
      }),
      io.onFocus(probeAll),
      io.every(STATUS_POLL_MS, probeAll)
    ]
    unwire = () => offs.forEach((off) => off())
  }

  return {
    get: (): AccountStatusSnapshot => snap,
    subscribe(l: () => void): () => void {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    /** A hook shows these accounts. Asks for each one not asked within MOUNT_FRESH_MS; returns the release. */
    track(ids: string[]): () => void {
      mounts += 1
      if (mounts === 1) wire()
      const t = now()
      for (const id of ids) {
        tracked.set(id, (tracked.get(id) ?? 0) + 1)
        if (t - (askedAt.get(id) ?? -Infinity) >= MOUNT_FRESH_MS) probe(id)
      }
      let released = false
      return () => {
        if (released) return
        released = true
        for (const id of ids) {
          const n = (tracked.get(id) ?? 1) - 1
          if (n > 0) tracked.set(id, n)
          else tracked.delete(id)
        }
        mounts -= 1
        if (mounts === 0) {
          unwire?.()
          unwire = null
        }
      }
    },
    /** Re-asks every mounted account now and asks main for fresher usage. */
    refresh(): void {
      probeAll()
      io.refreshUsage?.()
    }
  }
}

const statusStore = createAccountStatusStore({
  status: (id) => window.api.accounts.status(id),
  onChanged: (cb) => window.api.on('accounts:status-changed', (p) => cb(p.accountId)),
  onFocus: (cb) => {
    window.addEventListener('focus', cb)
    return () => window.removeEventListener('focus', cb)
  },
  every: (ms, cb) => {
    const timer = setInterval(cb, ms)
    return () => clearInterval(timer)
  },
  refreshUsage: refreshAccountUsage
})

/** The window-wide refresh, for a caller with no hook at hand (the sign-in dialog on success). */
export function refreshAccountStatus(): void {
  statusStore.refresh()
}

/** See the header for the API. Shared by the sidebar popover, Settings › Accounts and the account pickers. */
export function useAccountStatus(accounts: Account[]): {
  loginMap: Record<string, boolean>
  emailMap: Record<string, string | null>
  loginStates: Record<string, AccountLoginState>
  defaultIdByProvider: Record<Provider, string | null>
  refresh: () => void
} {
  // Keyed by the ids, not the array: a new array with the same accounts is not a reason to ask again.
  const key = accounts.map((a) => a.id).join('\n')
  useEffect(() => statusStore.track(key === '' ? [] : key.split('\n')), [key])
  const snap = useSyncExternalStore(statusStore.subscribe, statusStore.get, statusStore.get)
  const loginMap = useMemo(() => loginMapOf(snap.states), [snap.states])

  // The default account of each provider — the row that gets the `default` badge, and the account ⤓ copies
  // settings from. It is derived here rather than sent down from main because both inputs it needs (the
  // account list and the login state) are already in this hook, and it tracks a login the moment the map
  // above updates. null means that provider has no logged-in account yet. An expired login is not logged
  // in here (T3): a refused account no longer wears the default badge.
  const defaultIdByProvider = useMemo(() => {
    const loggedInIds = new Set(
      Object.entries(loginMap)
        .filter(([, on]) => on)
        .map(([id]) => id)
    )
    return Object.fromEntries(
      PROVIDERS.map((p) => [p, defaultAccountIdOf(p, accounts, loggedInIds)])
    ) as Record<Provider, string | null>
  }, [accounts, loginMap])

  return { loginMap, emailMap: snap.emails, loginStates: snap.states, defaultIdByProvider, refresh: statusStore.refresh }
}

/** The account list, shared by every reader in the window: shown at once from the cache, refreshed when main pushes
 *  a change. `ready` is true once a fetch has answered since the last change. */
export function useAccountsList(): { accounts: Account[] | undefined; ready: boolean } {
  const { data, stale } = useCachedRead('accounts:list', () => window.api.accounts.list(), { invalidateOn: ['accounts:changed'] })
  return { accounts: data, ready: data !== undefined && !stale }
}
