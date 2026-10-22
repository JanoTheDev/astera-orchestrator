import type { Account, AccountUsage } from '../../../core/types'
import type { SelectItem } from '../../../core/ui/select'

type Translate = (key: 'account.select.usage' | 'account.select.signedOut', params?: { session: number; weekly: number }) => string

/** The right-edge text of an account row: usage when known, "signed out" when the login probe answered
 *  false, nothing while either is still unknown. A signed-out account shows no usage (it is stale). */
export function accountMetaOf(
  a: Account,
  loginMap: Record<string, boolean>,
  usage: Record<string, AccountUsage>,
  t: Translate
): string | undefined {
  if (loginMap[a.id] === false) return t('account.select.signedOut')
  const u = usage[a.configDir]
  if (!u || (!u.session && !u.weekly)) return undefined
  return t('account.select.usage', { session: u.session?.usedPercent ?? 0, weekly: u.weekly?.usedPercent ?? 0 })
}

/** Rows for AccountSelect, without icons (those are JSX). `allLabel` adds the '' item at the front. */
export function accountSelectItems(o: {
  accounts: Account[]
  loginMap: Record<string, boolean>
  usage: Record<string, AccountUsage>
  t: Translate
  allLabel?: string
  suffixOf?: (a: Account) => string | null
}): SelectItem[] {
  return [
    ...(o.allLabel === undefined ? [] : [{ value: '', label: o.allLabel }]),
    ...o.accounts.map((a) => ({
      value: a.id,
      label: a.label + (o.suffixOf?.(a) ?? ''),
      meta: accountMetaOf(a, o.loginMap, o.usage, o.t)
    }))
  ]
}
