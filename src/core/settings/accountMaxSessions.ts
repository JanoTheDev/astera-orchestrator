// T5b (decision 21): an optional cap on the live Astera sessions per account, app-settings.json
// `accountMaxSessions: { [accountId]: n }` (Settings › Accounts, advanced). Absent or empty = no cap; the ranking
// (accounts/autoAccountOrder.ts rankAccounts) marks an account at its cap `at-cap` and starts elsewhere.
import { readAppSettingsObject } from './settingsObject'

/** The setting as every reader narrows it: only whole numbers >= 1 count, anything else is "no cap". */
export function accountMaxSessionsOf(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [id, n] of Object.entries(value as Record<string, unknown>))
    if (typeof n === 'number' && Number.isInteger(n) && n >= 1) out[id] = n
  return out
}

/** The Host's read, per call: the app is the file's only writer. A missing or unreadable file is no cap. */
export async function readAccountMaxSessions(filePath: string): Promise<Record<string, number>> {
  return accountMaxSessionsOf((await readAppSettingsObject(filePath).catch(() => null))?.accountMaxSessions)
}
