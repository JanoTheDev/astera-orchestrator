// T3 (account center sync): one "this account's login changed" signal for the accounts popover and
// Settings › Accounts & usage.
//
// Before this, each surface found out on its own: a sign-out faked a window `focus` event, an in-app
// sign-in found out nothing at all (the paste-the-code flow never loses focus), a login made in a terminal
// showed only after the window was refocused, and a refused token left the row saying "signed in" over a
// dimmed old meter. Every one of those now goes through `changed` or `answer` below, and the renderer
// hears one push, `accounts:status-changed`, and re-probes that account (hooks/useAccountStatus.ts).
//
// Sources of the signal:
// - `changed(id)`: in-app sign-in (main/accountLogin.ts onFinished), sign-out, add, import, and an email
//   change noticed by core.accountEmail. It also forgets the account's cached usage and fetches once.
// - `poll()`: each account's credentials file (core/accounts/loginStatus.ts CREDENTIALS_FILE), by mtime.
//   Stat only — the token is never read here. Catches `claude /login` in a terminal and a logout there.
//   A running session's own token refresh rewrites the file too, which costs one extra usage request for
//   that account per refresh (about hourly); that is the price of not reading the file.
// - `answer(configDir, …)`: every usage answer the shared fetcher cache stores (main/accountUsage.ts
//   onAnswer). A refused credential marks the account `expired`; the next good answer clears the mark.
//
// `expired` is the panel's view only. Rolling and dispatch keep asking `AccountRegistry.loginStatus`,
// which this does not change: deciding to switch accounts on a refused usage request is not this
// module's call.
import type { Account } from '../core/types'
import type { AccountUsageService } from './accountUsage'

/** The row's login state. `expired`: the credentials are on disk but the endpoint refused them. */
export type AccountLoginStatus = 'signedIn' | 'signedOut' | 'expired'

export interface AccountStatusAnswer {
  login: AccountLoginStatus
  email: string | null
}

/** How often the credentials files are stat'ed. A login made in a terminal shows within this. */
export const CREDENTIALS_POLL_MS = 30_000

export interface AccountSyncDeps {
  accounts: { list(): Account[]; loginStatus(id: string): Promise<boolean> }
  /** core.accountEmail: also notices an email change, which comes back here through `changed`. */
  email: (id: string) => Promise<string | null>
  usage: Pick<AccountUsageService, 'refetch'>
  send: (channel: 'accounts:status-changed', payload: { accountId: string }) => void
  /** The account's credentials file mtime (ms), null when there is none. Never throws. */
  credentialsMtime: (account: Account) => Promise<number | null>
}

export interface AccountSync {
  status(id: string): Promise<AccountStatusAnswer>
  changed(id: string): Promise<void>
  answer(configDir: string, a: { status: 'ok' | 'unavailable' | 'error'; refused: boolean }): void
  poll(): Promise<void>
  start(): void
  stop(): void
}

export function createAccountSync(deps: AccountSyncDeps): AccountSync {
  // The configDirs whose credential the usage endpoint last refused. In memory: a restart asks again.
  const refused = new Set<string>()
  // The credentials file mtime last seen per account id. An id absent here has not been looked at yet, so
  // its first look only records (an app start is not a login change).
  const seen = new Map<string, number | null>()
  let timer: NodeJS.Timeout | null = null
  let polling = false

  const find = (id: string): Account | undefined => deps.accounts.list().find((a) => a.id === id)
  const signal = (configDir: string): void => {
    for (const a of deps.accounts.list()) if (a.configDir === configDir) deps.send('accounts:status-changed', { accountId: a.id })
  }

  async function changed(id: string): Promise<void> {
    const account = find(id)
    if (!account) return
    refused.delete(account.configDir)
    // Our own write is not an outside change: the next poll compares against what is there now.
    seen.set(id, await deps.credentialsMtime(account))
    deps.send('accounts:status-changed', { accountId: id })
    await deps.usage.refetch(account.configDir).catch(() => {})
  }

  async function poll(): Promise<void> {
    if (polling) return
    polling = true
    try {
      for (const a of deps.accounts.list()) {
        const mtime = await deps.credentialsMtime(a)
        const looked = seen.has(a.id)
        const before = seen.get(a.id)
        seen.set(a.id, mtime)
        if (looked && before !== mtime) await changed(a.id)
      }
    } finally {
      polling = false
    }
  }

  return {
    async status(id) {
      const account = find(id)
      const [loggedIn, email] = await Promise.all([deps.accounts.loginStatus(id), deps.email(id)])
      const login: AccountLoginStatus = !loggedIn ? 'signedOut' : account && refused.has(account.configDir) ? 'expired' : 'signedIn'
      return { login, email }
    },
    changed,
    answer(configDir, a) {
      if (a.refused) {
        if (refused.has(configDir)) return
        refused.add(configDir)
        signal(configDir)
      } else if (a.status === 'ok' && refused.delete(configDir)) {
        signal(configDir)
      }
    },
    poll,
    start() {
      if (timer) return
      void poll().catch(() => {})
      timer = setInterval(() => void poll().catch(() => {}), CREDENTIALS_POLL_MS)
      timer.unref?.()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    }
  }
}
