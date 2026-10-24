import { useEffect, useState } from 'react'
import type { Account } from '../../../core/types'
import { providerOf } from '../../../core/providers/meta'
import { useAccountStatus } from '../hooks/useAccountStatus'
import { useAccountUsage } from '../hooks/useAccountUsage'
import { AccountRow } from './AccountRow'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Button, Card, Checkbox, EmptyState, ICONS, Icon, IconButton, Modal } from './ui'

/** The Accounts tab of the settings modal. It holds the delete and import-settings flows moved over from
 *  the sidebar. The sidebar (AccountPanel) is left with only listing and adding accounts. */
export function AccountSettings({ accounts }: { accounts: Account[] }): React.JSX.Element {
  const { t, tm } = useI18n()
  const { loginMap, emailMap, defaultIdByProvider } = useAccountStatus(accounts)
  const usage = useAccountUsage()
  // Which row has its usage detail open — the same one-at-a-time rule as the sidebar panel.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Account | null>(null)
  const [syncTarget, setSyncTarget] = useState<Account | null>(null)
  const [syncing, setSyncing] = useState(false)

  const openRemove = (account: Account): void => setRemoveTarget(account)

  const confirmSync = async (): Promise<void> => {
    if (!syncTarget || syncing) return
    setSyncing(true)
    try {
      const r = await window.api.accounts.syncSettings(syncTarget.id)
      if (!r.ok) toast.error(t('account.sync.failed', { detail: tm(r.message ?? null) ?? '' }))
      else if (r.message) toast.info(t(r.message.key, r.message.params))
      else toast.success(t('account.sync.done'))
    } finally {
      setSyncing(false)
      setSyncTarget(null)
    }
  }

  return (
    <div className="acct-settings">
      <span className="settings-hint">{t('settings.accounts.hint')}</span>
      {accounts.length > 0 && (
      <Card className="acct-card">
      <ul className="acct-list">
        {accounts.map((a) => {
          const defaultId = defaultIdByProvider[providerOf(a)]
          return (
          <AccountRow
            key={a.id}
            account={a}
            loggedIn={loginMap[a.id]}
            email={emailMap[a.id]}
            isDefault={defaultId === a.id}
            usage={usage[a.configDir]}
            expanded={expandedId === a.id}
            onToggle={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
          >
            {/* Importing needs a source, and that source is this provider's default account. Hidden on the default
                itself (it would be copying onto itself) and when the provider has no default yet, which
                means nothing of that CLI is logged in. */}
            {defaultId !== null && defaultId !== a.id && (
              <Button size="sm" variant="ghost" title={t('account.sync.title')} onClick={() => setSyncTarget(a)}>
                {t('account.sync.button')}
              </Button>
            )}
            <IconButton
              size="sm"
              icon={<Icon name="delete" size={14} />}
              label={t('account.remove.button')}
              onClick={() => openRemove(a)}
            />
          </AccountRow>
          )
        })}
      </ul>
      </Card>
      )}
      {accounts.length === 0 && (
        <EmptyState icon={ICONS.users} title={t('account.panel.empty')}>
          {t('account.empty.bodySettings')}
        </EmptyState>
      )}
      {removeTarget && <RemoveAccountDialog account={removeTarget} onClose={() => setRemoveTarget(null)} />}
      {syncTarget && (
        <Modal
          title={t('account.sync.title')}
          onClose={() => !syncing && setSyncTarget(null)}
          size="sm"
          closeLabel={t('common.close')}
          footer={
            <>
              <Button disabled={syncing} onClick={() => setSyncTarget(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" disabled={syncing} onClick={() => void confirmSync()}>
                {syncing ? t('account.sync.confirming') : t('account.sync.confirm')}
              </Button>
            </>
          }
        >
          <div className="acct-form">
            <p className="acct-note">
              {t('account.sync.confirmBody', {
                source:
                  accounts.find((a) => a.id === defaultIdByProvider[providerOf(syncTarget)])?.label ??
                  '',
                label: syncTarget.label
              })}
            </p>
            {/* The two CLIs differ in kind, not degree: claude merges, codex overwrites the file. The
                codex case can lose settings, so it gets the warning style. */}
            {providerOf(syncTarget) === 'codex' ? (
              <p className="acct-note acct-note--warn">{t('account.sync.replaceNote')}</p>
            ) : (
              <p className="acct-note">{t('account.sync.mergeNote')}</p>
            )}
            <p className="acct-note acct-note--warn">{t('account.sync.appliesNextSession')}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** The unregister flow with its confirmation and "Also log out". Exported for the sidebar's rows (W7-F, #82), so the
 *  two places remove an account the same way. */
export function RemoveAccountDialog({ account, onClose }: { account: Account; onClose: () => void }): React.JSX.Element {
  const { t, tm } = useI18n()
  const [logoutToo, setLogoutToo] = useState(false)
  const [removing, setRemoving] = useState(false)
  // Finished worker sessions removal will close, named before the owner confirms (a dry run changes nothing).
  const [closing, setClosing] = useState<string[]>([])
  // Sessions still using the account. When any, removal is refused, so the dialog names them instead of the close line.
  const [blockers, setBlockers] = useState<string[]>([])
  useEffect(() => {
    void window.api.accounts.remove(account.id, { dryRun: true }).then(
      (r) => {
        if (!r) return
        if (r.ok) setClosing(r.closed ?? [])
        else setBlockers(r.titles)
      },
      () => {}
    )
  }, [account.id])

  const confirmRemove = async (): Promise<void> => {
    if (removing) return
    setRemoving(true)
    try {
      // 돌아가는 세션이 그 계정을 쓰고 있으면 main 이 거부한다(ipc.ts 의 accountRemovalBlockers).
      // 거부는 실패가 아니라 사용자가 몰랐던 사실을 알리는 것이므로, 어느 세션이 막고 있는지 이름을
      // 말한다 — 이름 없이 "쓰이는 중"만 말하면 사용자가 무엇을 닫아야 할지 알 수 없다.
      // 로그아웃은 제거가 성공한 뒤에만 한다: 거부된 제거가 살아 있는 세션의 로그인을 먼저 끊으면 안 된다.
      const r = await window.api.accounts.remove(account.id)
      if (r && !r.ok) {
        toast.error(t('account.remove.inUse', { titles: r.titles.join(', ') }))
        return
      }
      if (logoutToo) {
        const lo = await window.api.accounts.logout(account.id)
        if (!lo.ok) toast.error(t('account.logout.failed', { detail: tm(lo.message ?? null) ?? '' }))
      }
    } catch (e) {
      toast.error(t('account.remove.releaseFailed', { detail: e instanceof Error ? e.message : String(e) }))
    } finally {
      setRemoving(false)
      onClose()
    }
  }

  return (
    <Modal
      title={t('account.remove.title')}
      onClose={() => !removing && onClose()}
      size="sm"
      closeLabel={t('common.close')}
      footer={
        <>
          <Button disabled={removing} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" disabled={removing} onClick={() => void confirmRemove()}>
            {removing
              ? t('account.remove.processing')
              : logoutToo
                ? t('account.remove.confirmWithLogout')
                : t('account.remove.button')}
          </Button>
        </>
      }
    >
      <div className="acct-form">
        <p className="acct-note">
          {t('account.remove.confirm', { label: account.label })}
        </p>
        {blockers.length > 0 && (
          <p className="acct-note acct-note--warn">{t('account.remove.inUse', { titles: blockers.join(', ') })}</p>
        )}
        {blockers.length === 0 && closing.length > 0 && (
          <p className="acct-note">{t('account.remove.willClose', { count: closing.length, titles: closing.join(', ') })}</p>
        )}
        <Checkbox checked={logoutToo} onChange={(v) => setLogoutToo(v)} label={t('account.remove.logoutToo')} />
        {logoutToo && <p className="acct-note acct-note--warn">{t('account.remove.logoutWarning')}</p>}
      </div>
    </Modal>
  )
}
