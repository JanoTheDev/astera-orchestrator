// The MCP & skills finder's pure parts (Settings › Integrations): which accounts an install goes to, which
// values a server still needs, where an installed entry came from, and the repo list's validation. The
// components beside this file only draw what these answer.
import type { Account, ExtensionInstallResult, McpInput, McpInstalled, McpRecipe, SkillInstalled } from '../../../../core/types'
import { PROVIDERS, providerOf, type Provider } from '../../../../core/providers/meta'

/** How long the search box waits after the last key before it asks. */
export const SEARCH_DEBOUNCE_MS = 350

/** Astera's own MCP entry: managed in Settings › CLI, never removable here (core/extensions/mcpConfig.ts). */
export const ASTERA_MCP = 'astera'

/** Where an installed entry came from: Astera's own, installed by the finder (the only ones removable here), or the
 *  person's own. Skills carry it on disk (SkillOrigin). MCP configs carry no marker, so the finder remembers its own
 *  MCP installs in this renderer's storage (FINDER_MCP_KEY); a server it did not record is the person's. */
export type Origin = 'astera' | 'finder' | 'user'

/** localStorage key of the MCP servers the finder installed, as `accountId` + NUL + `name` entries. */
export const FINDER_MCP_KEY = 'astera.finder.mcpInstalls'
const entry = (accountId: string, name: string): string => `${accountId}\0${name}`

export const mcpOrigin = (s: McpInstalled, owned: ReadonlySet<string>): Origin =>
  s.name.toLowerCase() === ASTERA_MCP ? 'astera' : owned.has(entry(s.accountId, s.name)) ? 'finder' : 'user'
export const removable = (o: Origin): boolean => o === 'finder'

/** The finder's MCP record read from storage; an unreadable or malformed value is an empty record. */
export function readOwned(storage: Pick<Storage, 'getItem'> | undefined): Set<string> {
  try {
    const v: unknown = JSON.parse(storage?.getItem(FINDER_MCP_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeOwned(storage: Pick<Storage, 'setItem'> | undefined, owned: ReadonlySet<string>): void {
  try {
    storage?.setItem(FINDER_MCP_KEY, JSON.stringify([...owned]))
  } catch {
    /* storage unavailable: the install is not remembered, so its row reads as the person's and is not removable */
  }
}

/** `owned` plus the accounts `name` was just installed in. */
export const withInstalled = (owned: ReadonlySet<string>, accountIds: readonly string[], name: string): Set<string> =>
  new Set([...owned, ...accountIds.map((id) => entry(id, name))])

/** `owned` without one server (it was removed). */
export function withoutInstalled(owned: ReadonlySet<string>, accountId: string, name: string): Set<string> {
  const next = new Set(owned)
  next.delete(entry(accountId, name))
  return next
}

/** `owned` keeping only servers still installed: one removed outside Astera and later set up again by hand is the
 *  person's, not the finder's. */
export const prunedOwned = (owned: ReadonlySet<string>, installed: readonly McpInstalled[]): Set<string> => {
  const present = new Set(installed.map((s) => entry(s.accountId, s.name)))
  return new Set([...owned].filter((e) => present.has(e)))
}

/** The accounts of each provider, in the order the person keeps them. */
export function accountsByProvider(accounts: readonly Account[]): Record<Provider, Account[]> {
  const out = Object.fromEntries(PROVIDERS.map((p) => [p, [] as Account[]])) as Record<Provider, Account[]>
  for (const a of accounts) out[providerOf(a)].push(a)
  return out
}

/** The install dialog starts with every account picked: both clients take MCP servers and skills. */
export const defaultPick = (accounts: readonly Account[]): Set<string> => new Set(accounts.map((a) => a.id))

/** A provider's box: checked when all its accounts are picked, mixed when some are, off without accounts. */
export function providerPick(ids: readonly string[], picked: ReadonlySet<string>): { checked: boolean; indeterminate: boolean; disabled: boolean } {
  const n = ids.filter((id) => picked.has(id)).length
  return { checked: ids.length > 0 && n === ids.length, indeterminate: n > 0 && n < ids.length, disabled: ids.length === 0 }
}

/** `picked` with all of `ids` on, or all off when they all were. */
export function toggleProvider(ids: readonly string[], picked: ReadonlySet<string>): Set<string> {
  const next = new Set(picked)
  const all = ids.every((id) => picked.has(id))
  for (const id of ids) {
    if (all) next.delete(id)
    else next.add(id)
  }
  return next
}

/** The env vars (stdio) or headers (http) a recipe asks for. */
export const inputsOf = (r: McpRecipe): McpInput[] => (r.kind === 'stdio' ? r.env : r.headers)

/** Each input's starting value: its default when the registry gives one. */
export const initialValues = (inputs: readonly McpInput[]): Record<string, string> =>
  Object.fromEntries(inputs.map((i) => [i.name, i.default ?? '']))

/** Required inputs still empty. */
export const missingInputs = (inputs: readonly McpInput[], values: Record<string, string>): string[] =>
  inputs.filter((i) => i.required && !(values[i.name] ?? '').trim()).map((i) => i.name)

/** Only the values that were filled in: an empty optional input is left out instead of written as ''. */
export const filledValues = (values: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''))

/** Whether Install can go: at least one account, nothing required missing. */
export const canInstall = (picked: ReadonlySet<string>, missing: readonly string[]): boolean => picked.size > 0 && missing.length === 0

/** An install's outcome in two lists, failures with their account's label. */
export function splitResults(r: ExtensionInstallResult, labelOf: (id: string) => string): { ok: string[]; failed: { label: string; message: string }[] } {
  const ok: string[] = []
  const failed: { label: string; message: string }[] = []
  for (const x of r.results) {
    if (x.ok) ok.push(labelOf(x.accountId))
    else failed.push({ label: labelOf(x.accountId), message: x.message })
  }
  return { ok, failed }
}

/** Installed entries grouped by account, in the accounts' order; an account with none still gets its group. */
export function byAccount<T extends { accountId: string; name: string }>(items: readonly T[], accounts: readonly Account[]): { account: Account; items: T[] }[] {
  return accounts.map((account) => ({
    account,
    items: items.filter((i) => i.accountId === account.id).sort((a, b) => a.name.localeCompare(b.name))
  }))
}

/** Whether `name` is already in any of `accountIds` (the backend refuses a duplicate, so the row says so first). */
export const installedIn = (items: readonly { accountId: string; name: string }[], name: string): Set<string> =>
  new Set(items.filter((i) => i.name === name).map((i) => i.accountId))

// The same rule as core/extensions/skillsCatalog.ts `isRepo` (that file is not renderer-importable).
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

export type RepoProblem = 'format' | 'duplicate' | null

/** Why `input` cannot be added to the repo list, or null. A pasted GitHub URL is read as its owner/repo. */
export function repoProblem(input: string, existing: readonly string[]): RepoProblem {
  const r = normaliseRepo(input)
  if (!REPO.test(r) || r.split('/').some((p) => p === '.' || p === '..')) return 'format'
  return existing.some((e) => e.toLowerCase() === r.toLowerCase()) ? 'duplicate' : null
}

export const normaliseRepo = (input: string): string =>
  input.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/+$/, '').replace(/\.git$/i, '')

