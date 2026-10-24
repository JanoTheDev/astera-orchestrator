// W9-E: Accounts & usage (DESIGN §7) — accounts (the old accounts tab), and the usage guard with subagents per tab
// (it lived in the agent tab).
import { useEffect, useRef, useState } from 'react'
import { useSetting } from '../../hooks/useSetting'
import type { Account } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { AccountSettings } from '../AccountSettings'
import { UsageGuardSettings } from '../usage/UsageGuardSettings'
import { Card, Field } from '../ui'
import { SettingRow, type GroupProps } from './SettingRow'

const NO_CAPS: Record<string, number> = {}
const draftOf = (m: Record<string, number>): Record<string, string> =>
  Object.fromEntries(Object.entries(m).map(([id, n]) => [id, String(n)]))

/** T5b (decision 21): live Astera sessions per account at most; empty is no cap. Saved on blur, like the usage guard. */
function AccountMaxSessionsSetting({ accounts }: { accounts: Account[] }): React.JSX.Element {
  const { t } = useI18n()
  const [read, setSaved] = useSetting('accountMaxSessions', () => window.api.settings.getAccountMaxSessions())
  const saved = read ?? NO_CAPS
  const [draft, setDraft] = useState<Record<string, string>>(() => draftOf(saved))
  // Seeded once: from the cache on the first frame, else when the first read answers. Later changes come from this pane.
  const seeded = useRef(read !== undefined)
  useEffect(() => {
    if (read === undefined || seeded.current) return
    seeded.current = true
    setDraft(draftOf(read))
  }, [read])

  const commit = (id: string): void => {
    const raw = (draft[id] ?? '').trim()
    const n = Number(raw)
    const next = { ...saved }
    if (raw === '') delete next[id]
    else if (Number.isInteger(n) && n >= 1) next[id] = n
    else return setDraft((d) => ({ ...d, [id]: saved[id] === undefined ? '' : String(saved[id]) }))
    if (next[id] === saved[id]) return
    const was = saved
    setSaved(next)
    window.api.settings.setAccountMaxSessions(next).catch((err) => {
      setSaved(was)
      setDraft((d) => ({ ...d, [id]: was[id] === undefined ? '' : String(was[id]) }))
      toast.error(t('settings.usageGuard.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <Card className="acct-card acct-limits">
      <span className="acct-card__title">{t('settings.accountMaxSessions.label')}</span>
      <span className="settings-hint">{t('settings.accountMaxSessions.hint')}</span>
      {accounts.map((a) => (
        <Field
          key={a.id}
          kind="number"
          label={a.label}
          min={1}
          value={draft[a.id] ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, [a.id]: e.target.value }))}
          onBlur={() => commit(a.id)}
        />
      ))}
    </Card>
  )
}

export function AccountsUsageSettings({ shown, only, accounts }: GroupProps): React.JSX.Element | null {
  if (!shown) return null
  return (
    <>
      <SettingRow a="accounts" only={only}>
        <AccountSettings accounts={accounts} />
      </SettingRow>
      <div className="settings-stack">
        {/* W6-G */}
        <SettingRow a="usageGuard" only={only}>
          <UsageGuardSettings />
        </SettingRow>
        {/* T5b */}
        <SettingRow a="accountMaxSessions" only={only}>
          <AccountMaxSessionsSetting accounts={accounts} />
        </SettingRow>
      </div>
    </>
  )
}
