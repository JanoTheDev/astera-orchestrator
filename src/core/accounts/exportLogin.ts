// One account's login material, for `astera machines migrate` (T12c, plan decision 18): the file a provider's CLI
// keeps its login in, and the target side that writes it into a new machine's account.
//
// **Which login moves (measured on claude 2.1.301):** claude refreshes its OAuth login with a rotating refresh token:
// the binary tracks `known_dead_refresh_token` and `refresh_token_cleared_on_disk`, and a refresh writes the new pair
// back. A `.credentials.json` copied to a second machine would be refreshed there, and the first refresh kills the
// other machine's token: the person would be logged out at home. So a Claude login is never copied: the controller
// runs `claude setup-token` (a long-lived token, one browser approval per account) and the target gets that token,
// with no refresh token at all. Codex's ChatGPT login rotates the same way (`refresh_token_reused`), and it has no
// long-lived token, so a Codex account is made on the target and signed in there once (`codex login --device-auth`).
// Not tested with a throw-away copy: the test itself would rotate, and so kill, the owner's real login.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Account, Provider } from '../types'
import type { ProviderDescriptor } from '../providers/descriptor'
import { AccountRegistry } from './registry'
import { isLoggedIn } from './loginCheck'

/** The file each provider's CLI reads its login from, in the account's config folder. */
export const LOGIN_FILE: Record<Provider, string> = { claude: '.credentials.json', codex: 'auth.json' }

/** A long-lived `claude setup-token` token as claude's own credentials file: an access token that lasts its year, no
 *  refresh token (nothing to rotate), and the one scope such a token has. */
export function setupTokenCredentials(token: string, now: number): string {
  return JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: null, expiresAt: now + 365 * 24 * 3600_000, scopes: ['user:inference'] } })
}

/** The token `claude setup-token` printed, in whatever its screen put around it. */
export function setupTokenOf(output: string): string | null {
  const all = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').match(/sk-ant-oat\d+-[A-Za-z0-9_-]{20,}/g)
  return all ? all[all.length - 1] : null
}

export interface WriteLoginDeps {
  platform: NodeJS.Platform
  /** Runs a program (icacls on Windows); its exit code. */
  run(file: string, args: string[]): Promise<number>
  /** The user owning the file on Windows (USERNAME). */
  user: string
  random(): string
}

/** Writes a login file owner-only: a 0600 temp file beside it, renamed over it; on Windows the file's inherited access
 *  is dropped for this user's alone. The temp file never outlives the call. */
export async function writeLoginFile(dir: string, name: string, content: string, d: WriteLoginDeps): Promise<void> {
  const final = path.join(dir, name)
  const tmp = path.join(dir, `.${name}.${d.random()}.tmp`)
  try {
    await fs.writeFile(tmp, content, { mode: 0o600, flag: 'wx' })
    if (d.platform === 'win32' && (await d.run('icacls', [tmp, '/inheritance:r', '/grant:r', `${d.user}:F`])) !== 0)
      throw new Error('icacls could not make the login file owner-only')
    await fs.rename(tmp, final)
    if (d.platform !== 'win32') await fs.chmod(final, 0o600)
  } finally {
    await fs.rm(tmp, { force: true })
  }
}

export interface ImportAccountDeps extends WriteLoginDeps {
  profileDir: string
  home: string
  descriptors: Record<Provider, ProviderDescriptor>
  registry?: AccountRegistry
}

/** `astera accounts import` on the target: the account the controller has, by label and provider (made when missing,
 *  so a second migration updates it instead of adding another), with `login` written as its login file when given. */
export async function importAccount(
  o: { label: string; color?: string; provider: Provider; login?: string },
  d: ImportAccountDeps
): Promise<{ account: Account; signedIn: boolean; created: boolean }> {
  const registry =
    d.registry ??
    new AccountRegistry(path.join(d.profileDir, 'accounts.json'), path.join(d.home, d.descriptors.claude.accountsRootName), path.join(d.home, d.descriptors.codex.accountsRootName))
  if (!d.registry) await registry.load()
  const existing = registry.list().find((a) => a.label === o.label && (a.provider ?? 'claude') === o.provider)
  const account = existing ?? (await registry.create({ label: o.label, provider: o.provider, ...(o.color ? { color: o.color } : {}) }))
  if (o.login !== undefined && o.login.trim() !== '') {
    await fs.mkdir(account.configDir, { recursive: true })
    await writeLoginFile(account.configDir, LOGIN_FILE[o.provider], o.login.trim(), d)
  }
  return { account, signedIn: await isLoggedIn(account, d.descriptors), created: !existing }
}
