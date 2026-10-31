import { useMemo, useState } from 'react'
import type { Account } from '../../../core/types'
import { providerOf } from '../../../core/providers/meta'
import { duplicateLoginGroups } from '../../../core/accounts/duplicateLogins'
import { useAccountStatus } from '../hooks/useAccountStatus'
import { AccountList } from './AccountRow'
import { useAccountCenter } from './accountModals'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Button, Card, EmptyState, ICONS, Icon, Modal } from './ui'

/** Settings › Accounts & usage, the account list (T4): the same rows as the activity bar's popover (AccountList), the
 *  same add / import / detect / sign-in / sign-out / unregister dialogs (accountModals.tsx), plus the flows only this
 *  page has: import the default account's settings into an account, and merge two accounts of one login. */
export function AccountSettings({ accounts }: { accounts: Account[] }): React.JSX.Element {
  const { t, tm } = useI18n()
  const status = useAccountStatus(accounts)
  const { loginMap, emailMap, defaultIdByProvider } = status
  const [syncTarget, setSyncTarget] = useState<Account | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [mergeTarget, setMergeTarget] = useState<{ keep: Account; drop: Account } | null>(null)

  // Accounts signed in as the same email: the kept one of each group, found for every account in it.
  const sameLoginAs = useMemo(() => {
    const loggedIn = new Set(Object.entries(loginMap).filter(([, on]) => on).map(([id]) => id))
    const byId = new Map(accounts.map((a) => [a.id, a]))
    const out = new Map<string, { keep: Account; drop: Account }>()
    for (const g of duplicateLoginGroups(accounts, (id) => emailMap[id], loggedIn)) {
      const keep = byId.get(g.keepId)
      for (const id of g.dropIds) {
        const drop = byId.get(id)
        if (keep && drop) out.set(id, { keep, drop })
      }
    }
    return out
  }, [accounts, loginMap, emailMap])

  const center = useAccountCenter({
    accounts,
    loginMap,
    onMerge: (a) => {
      const dup = sameLoginAs.get(a.id)
      if (dup) setMergeTarget(dup)
    }
  })

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
      {/* T4: the same three actions as the popover's toolbar, as worded buttons: this page has the room. */}
      <div className="acct-settings__bar" role="toolbar" aria-label={t('account.panel.title')}>
        {center.tools.map((it) => (
          <Button key={it.id} size="sm" icon={it.icon} onClick={it.onClick}>
            {it.label}
          </Button>
        ))}
      </div>
      {accounts.length > 0 ? (
        <>
          <span className="settings-hint">{t('settings.accounts.hint')}</span>
          <Card className="acct-card">
            <AccountList
              accounts={accounts}
              status={status}
              switchBlock={center.switchBlock}
              onAction={center.act}
              mergeableOf={(a) => sameLoginAs.has(a.id)}
              noteOf={(a) => {
                const dup = sameLoginAs.get(a.id)
                return dup ? t('account.merge.sameLogin', { label: dup.keep.label }) : undefined
              }}
              extraOf={(a) => {
                // Importing needs a source, and that source is this provider's default account. Hidden on the default
                // itself (it would be copying onto itself) and when the provider has no default yet, which means
                // nothing of that CLI is logged in.
                const defaultId = defaultIdByProvider[providerOf(a)]
                return defaultId !== null && defaultId !== a.id ? (
                  <Button size="sm" variant="ghost" title={t('account.sync.title')} onClick={() => setSyncTarget(a)}>
                    {t('account.sync.button')}
                  </Button>
                ) : null
              }}
            />
          </Card>
        </>
      ) : (
        <EmptyState
          icon={ICONS.users}
          title={t('account.panel.empty')}
          action={
            <Button icon={<Icon name="add" />} onClick={center.openAdd}>
              {t('accounts.add')}
            </Button>
          }
        >
          {t('account.empty.bodySettings')}
        </EmptyState>
      )}
      {center.dialogs}
      {mergeTarget && <MergeAccountsDialog keep={mergeTarget.keep} drop={mergeTarget.drop} onClose={() => setMergeTarget(null)} />}
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
                source: accounts.find((a) => a.id === defaultIdByProvider[providerOf(syncTarget)])?.label ?? '',
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

/** Confirms folding `drop` into `keep` (two accounts of one login). main re-checks that it is the same login and that no
 *  running session uses `drop` (ipc.ts accounts.merge); a refusal is said here, with the sessions that block it. */
function MergeAccountsDialog({ keep, drop, onClose }: { keep: Account; drop: Account; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [merging, setMerging] = useState(false)

  const confirmMerge = async (): Promise<void> => {
    if (merging) return
    setMerging(true)
    try {
      const r = await window.api.accounts.merge(keep.id, drop.id)
      if (r.ok) toast.success(t('account.merge.done', { keep: keep.label }))
      else if (r.reason === 'inUse') toast.error(t('account.merge.inUse', { drop: drop.label, titles: r.titles.join(', ') }))
      else toast.error(t('account.merge.failed'))
    } catch {
      toast.error(t('account.merge.failed'))
    } finally {
      setMerging(false)
      onClose()
    }
  }

  return (
    <Modal
      title={t('account.merge.title')}
      onClose={() => !merging && onClose()}
      size="sm"
      closeLabel={t('common.close')}
      footer={
        <>
          <Button disabled={merging} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={merging} onClick={() => void confirmMerge()}>
            {merging ? t('account.merge.processing') : t('account.merge.confirmButton', { keep: keep.label })}
          </Button>
        </>
      }
    >
      <div className="acct-form">
        <p className="acct-note">{t('account.merge.confirm', { keep: keep.label, drop: drop.label })}</p>
        <p className="acct-note">{t('account.merge.note', { keep: keep.label, drop: drop.label })}</p>
      </div>
    </Modal>
  )
}
