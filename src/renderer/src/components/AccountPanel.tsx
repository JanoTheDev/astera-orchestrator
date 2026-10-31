import type { Account } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { useAccountStatus } from '../hooks/useAccountStatus'
import { openView } from './shell/navigation'
import { AccountList } from './AccountRow'
import { useAccountCenter } from './accountModals'
import { Badge, Button, EmptyState, ICONS, Icon, Toolbar } from './ui'

/** The activity bar's accounts popover (DESIGN-W13 §3): the account rows with the active one marked, one toolbar (add,
 *  import a folder, find signed-in accounts) and "Manage accounts…" to Settings › Accounts & usage. The dialogs are the
 *  ones Settings opens too (accountModals.tsx). `onClose` closes the popover before Settings opens. */
export function AccountPanel({ accounts, onClose }: { accounts: Account[]; onClose?: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const status = useAccountStatus(accounts)
  const center = useAccountCenter({ accounts, loginMap: status.loginMap, autoDetect: true })

  const manage = (): void => {
    onClose?.()
    openView('settings', 'accounts')
  }

  return (
    <section className="account-panel" aria-label={t('account.panel.title')}>
      <header className="acct-head">
        <h2 className="acct-head__title">
          {t('account.panel.title')} <Badge>{accounts.length}</Badge>
        </h2>
        <Toolbar label={t('account.panel.title')} items={center.tools} />
      </header>
      {accounts.length > 0 ? (
        <AccountList accounts={accounts} status={status} switchBlock={center.switchBlock} onAction={center.act} />
      ) : (
        <EmptyState
          icon={ICONS.users}
          title={t('account.panel.empty')}
          action={
            <Button variant="primary" icon={<Icon name="add" />} onClick={center.openAdd}>
              {t('accounts.add')}
            </Button>
          }
        >
          {t('account.empty.body')}
        </EmptyState>
      )}
      <footer className="acct-foot">
        <Button variant="ghost" size="sm" icon={<Icon name="settings" size={14} />} onClick={manage}>
          {t('account.manage')}
        </Button>
      </footer>
      {center.dialogs}
    </section>
  )
}
