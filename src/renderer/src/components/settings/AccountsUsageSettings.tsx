// W9-E: Accounts & usage (DESIGN §7) — accounts (the old accounts tab), and the usage guard with subagents per tab
// (it lived in the agent tab).
import { AccountSettings } from '../AccountSettings'
import { UsageGuardSettings } from '../usage/UsageGuardSettings'
import { SettingRow, type GroupProps } from './SettingRow'

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
      </div>
    </>
  )
}
