import { useEffect, useMemo, useState } from 'react'
import type { Account } from '../../../core/types'
import { PROVIDER_META, providerOf } from '../../../core/providers/meta'
import { duplicateLoginGroups } from '../../../core/accounts/duplicateLogins'
import { useAccountStatus } from '../hooks/useAccountStatus'
import { useAccountUsage } from '../hooks/useAccountUsage'
import { AccountRow, usePausedIds } from './AccountRow'
import { AccountSignInDialog } from './AccountSignIn'
import { accountActions, type AccountActionId } from './accountActions'
import { useActiveSession } from '../lib/activeSession'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Button, Card, Checkbox, ConfirmDialog, EmptyState, ICONS, Icon, Modal } from './ui'

/** The Accounts tab of the settings modal. It holds the delete and import-settings flows moved over from
 *  the sidebar. The sidebar (AccountPanel) is left with only listing and adding accounts. */
export function AccountSettings({ accounts }: { accounts: Account[] }): React.JSX.Element {
  const { t, tm } = useI18n()
  const { loginMap, loginStates, emailMap, defaultIdByProvider } = useAccountStatus(accounts)
  const usage = useAccountUsage()
  // Which row has its usage detail open — the same one-at-a-time rule as the sidebar panel.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Account | null>(null)
  const [syncTarget, setSyncTarget] = useState<Account | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [signInTarget, setSignInTarget] = useState<Account | null>(null)
  const [signOutTarget, setSignOutTarget] = useState<Account | null>(null)
  const paused = usePausedIds()
  const { switchBlock, switchTab } = useTabSwitch(accounts, loginMap)
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

  const act = (a: Account, id: AccountActionId): void => {
    if (id === 'signIn' || id === 'signInAgain') setSignInTarget(a)
    else if (id === 'signOut') setSignOutTarget(a)
    else if (id === 'switch') void switchTab(a)
    else if (id === 'merge') {
      const dup = sameLoginAs.get(a.id)
      if (dup) setMergeTarget(dup)
    } else if (id === 'remove') setRemoveTarget(a)
  }

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
          const dup = sameLoginAs.get(a.id)
          return (
          <AccountRow
            key={a.id}
            account={a}
            loggedIn={loginMap[a.id]}
            email={emailMap[a.id]}
            isDefault={defaultId === a.id}
            usage={usage[a.configDir]}
            note={dup ? t('account.merge.sameLogin', { label: dup.keep.label }) : undefined}
            actions={accountActions({ loggedIn: loginStates[a.id], switchBlock: switchBlock(a), mergeable: Boolean(dup) })}
            onAction={(id) => act(a, id)}
            paused={paused.has(a.id)}
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
      {mergeTarget && <MergeAccountsDialog keep={mergeTarget.keep} drop={mergeTarget.drop} onClose={() => setMergeTarget(null)} />}
      {removeTarget && <RemoveAccountDialog account={removeTarget} onClose={() => setRemoveTarget(null)} />}
      {signInTarget && <AccountSignInDialog account={signInTarget} onClose={() => setSignInTarget(null)} />}
      {signOutTarget && <SignOutDialog account={signOutTarget} onClose={() => setSignOutTarget(null)} />}
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
      // 로그아웃은 main 이 제거 뒤에, 제거 전에 잡아 둔 계정으로 한다(accounts.remove 의 logout 옵션).
      const r = await window.api.accounts.remove(account.id, { logout: logoutToo })
      if (r && !r.ok) {
        toast.error(t('account.remove.inUse', { titles: r.titles.join(', ') }))
        return
      }
      if (r?.logout && !r.logout.ok) {
        toast.error(t('account.logout.failed', { detail: tm(r.logout.message ?? null) ?? '' }))
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

/** "Use for this tab" for a list of rows: moves the session tab the top bar speaks for onto an account. `switchBlock` says
 *  why the item is off for an account, null when it works, undefined when the account is the one the tab already runs on. */
export function useTabSwitch(
  accounts: Account[],
  loginMap: Record<string, boolean>
): { switchBlock: (a: Account) => string | null | undefined; switchTab: (a: Account) => Promise<void> } {
  const { t } = useI18n()
  const tab = useActiveSession()
  const tabAccount = tab ? accounts.find((a) => a.id === tab.accountId) : undefined
  const [switching, setSwitching] = useState(false)

  const switchTab = async (a: Account): Promise<void> => {
    if (!tab || switching) return
    setSwitching(true)
    try {
      const r = await window.api.rolling.switchTo(tab.id, a.id)
      if (r.outcome === 'switched' || r.outcome === 'same') toast.success(t('account.switch.done', { label: a.label }))
      else if (r.outcome === 'busy') toast.info(t('account.switch.busy'))
      else toast.error(t('account.switch.failed', { detail: r.reason ?? '' }))
    } catch (err) {
      toast.error(t('account.switch.failed', { detail: err instanceof Error ? err.message : String(err) }))
    } finally {
      setSwitching(false)
    }
  }

  const switchBlock = (a: Account): string | null | undefined => {
    if (!tab || !tabAccount) return t('account.switch.noTab')
    if (providerOf(a) !== providerOf(tabAccount))
      return t('account.switch.otherProvider', { provider: PROVIDER_META[providerOf(tabAccount)].displayName })
    if (a.id === tab.accountId) return undefined
    if (loginMap[a.id] !== true) return t('account.status.notLoggedIn')
    return switching ? t('account.switch.busy') : null
  }
  return { switchBlock, switchTab }
}

/** Confirms signing an account out (the CLI's own logout, which removes its credentials). The account stays registered. */
export function SignOutDialog({ account, onClose }: { account: Account; onClose: () => void }): React.JSX.Element {
  const { t, tm } = useI18n()
  const [busy, setBusy] = useState(false)
  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const r = await window.api.accounts.logout(account.id)
      if (r.ok) toast.success(t('account.signOut.done', { label: account.label }))
      else toast.error(t('account.signOut.failed', { detail: tm(r.message ?? null) ?? '' }))
    } catch (err) {
      toast.error(t('account.signOut.failed', { detail: err instanceof Error ? err.message : String(err) }))
    } finally {
      // The login check re-runs when the window regains focus; ask it now so the row does not keep its old state.
      window.dispatchEvent(new Event('focus'))
      setBusy(false)
      onClose()
    }
  }
  return (
    <ConfirmDialog
      title={t('account.signOut.title', { label: account.label })}
      confirmLabel={busy ? t('account.signOut.processing') : t('account.signOut.button')}
      cancelLabel={t('common.cancel')}
      closeLabel={t('common.close')}
      danger
      onConfirm={() => void confirm()}
      onCancel={() => !busy && onClose()}
    >
      <p className="acct-note">{t('account.signOut.confirm', { label: account.label })}</p>
    </ConfirmDialog>
  )
}
