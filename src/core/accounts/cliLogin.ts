// `astera accounts login --new [--label <name>]` (plan decision 14): signs a new Claude account in from a plain terminal,
// with no app. The same two halves as the app's "+" (main/accountLogin.ts): a fresh config folder registered in
// accounts.json by the registry the app uses, then the CLI's own login run with that folder's env. The login runs in
// this terminal, so it prints its own link to open on any device and reads the code pasted back; nothing here sees or
// keeps the link, which carries the OAuth state.
import path from 'node:path'
import type { Account, Provider } from '../types'
import { AccountRegistry } from './registry'
import { isLoggedIn } from './loginCheck'
import type { ProviderDescriptor } from '../providers/descriptor'

export interface CliLoginDeps {
  profileDir: string
  home: string
  descriptors: Record<Provider, ProviderDescriptor>
  /** Runs the CLI's login in this terminal with `env` added; its exit code. */
  run(command: string, args: string[], env: Record<string, string>): Promise<number>
  /** The registry over this profile's accounts.json. A seam for tests; the real one is the app's own. */
  registry?: AccountRegistry
}

export type CliLoginResult = { ok: true; account: Account } | { ok: false; message: string }

const PROVIDER: Provider = 'claude'

export async function loginNewAccount(o: { label?: string }, d: CliLoginDeps): Promise<CliLoginResult> {
  const label = o.label?.trim() || 'Claude'
  const desc = d.descriptors[PROVIDER]
  const registry =
    d.registry ??
    new AccountRegistry(
      path.join(d.profileDir, 'accounts.json'),
      path.join(d.home, d.descriptors.claude.accountsRootName),
      path.join(d.home, d.descriptors.codex.accountsRootName)
    )
  if (!d.registry) await registry.load()
  const account = await registry.create({ label, provider: PROVIDER })
  // A folder made by `create` is under the accounts root, never the ambient ~/.claude, so the env always names it.
  const code = await d.run(desc.cliFile, desc.loginArgs, { [desc.configDirEnv]: account.configDir })
  if (await isLoggedIn(account, d.descriptors)) return { ok: true, account }
  // Not signed in: the account is taken off again so no half-made account waits in the app. Its folder stays, as every
  // removal leaves it (registry.remove).
  await registry.remove(account.id)
  return { ok: false, message: `the ${desc.cliFile} login exited with ${code} and the account is not signed in; nothing was registered` }
}
