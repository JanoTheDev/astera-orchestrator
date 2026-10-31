// T4 (account center redesign): the account dialogs and the actions that open them, shared by both account surfaces:
// the activity bar's popover (AccountPanel) and Settings › Accounts & usage (AccountSettings). One module, so adding,
// importing, detecting, signing in or out and unregistering work the same way from either place. Settings-only flows
// (merge two logins, import default settings) stay in AccountSettings.tsx.
import { useEffect, useRef, useState } from 'react'
import type { Account, Provider } from '../../../core/types'
import { PROVIDERS, PROVIDER_META, providerOf } from '../../../core/providers/meta'
import { toast } from '../lib/toast'
import { useActiveSession } from '../lib/activeSession'
import { useI18n } from '../i18n/I18nProvider'
import { ProviderBadge } from './ProviderBadge'
import { AccountSignInDialog } from './AccountSignIn'
import type { AccountActionId } from './accountActions'
import { Button, Checkbox, Chip, ConfirmDialog, EmptyState, Field, ICONS, Icon, Input, Modal, Tabs, type ToolbarItem } from './ui'

/** CLI kind selector for the add and import account modals */
function ProviderPicker({ value, onChange }: { value: Provider; onChange: (p: Provider) => void }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="ui-field">
      <span className="ui-field__label">{t('account.field.kind')}</span>
      <Tabs
        variant="segmented"
        label={t('account.field.kind')}
        value={value}
        onChange={(id) => onChange(id as Provider)}
        items={PROVIDERS.map((p) => ({ id: p, label: PROVIDER_META[p].displayName }))}
      />
    </div>
  )
}

/** Registers a new, empty account and hands it on to the sign-in (W7-F, #82: an added account with no login was taken
 *  for a broken "+"). */
function AddAccountModal({ onClose, onAdded }: { onClose: () => void; onAdded: (a: Account) => void }): React.JSX.Element {
  const { t, tm } = useI18n()
  const [label, setLabel] = useState('')
  const [copySettings, setCopySettings] = useState(true)
  const [provider, setProvider] = useState<Provider>('claude')
  const [adding, setAdding] = useState(false)

  const submit = async (): Promise<void> => {
    const name = label.trim()
    if (!name || adding) return
    setAdding(true)
    try {
      const account = await window.api.accounts.create({ label: name, provider })
      // Both providers import settings. A brand-new account is never the default (it has no credentials yet), so this
      // always copies from an existing account rather than onto itself. If that provider has nothing logged in there
      // is no source, and syncSettings reports that.
      if (copySettings) {
        const r = await window.api.accounts.syncSettings(account.id)
        if (!r.ok) toast.error(t('account.add.syncFailed', { detail: tm(r.message ?? null) ?? '' }))
      }
      onAdded(account)
    } catch (err) {
      // Said, and the dialog stays for another try (audit UI-10).
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  return (
    <Modal
      title={t('account.add.title')}
      onClose={onClose}
      size="sm"
      closeLabel={t('common.close')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="add-account-form" disabled={adding || !label.trim()}>
            {adding ? t('account.add.adding') : t('account.add.button')}
          </Button>
        </>
      }
    >
      <form
        id="add-account-form"
        className="acct-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <ProviderPicker value={provider} onChange={setProvider} />
        <Field
          autoFocus
          label={t('account.field.label')}
          value={label}
          placeholder={t('account.add.labelPlaceholder')}
          onChange={(e) => setLabel(e.target.value)}
        />
        {/* Shown for both providers: claude and codex each import from their own default account */}
        <Checkbox checked={copySettings} onChange={(v) => setCopySettings(v)} label={t('account.add.copySettingsLabel')} />
        {/* The login-procedure hint is per-CLI prose, so it is not folded behind a capability flag. Same category as
            ProviderBadge's icon choice: adding a provider means writing new text. */}
        <p className="acct-note acct-note--faint">
          {provider === 'claude' ? t('account.add.loginHintClaude') : t('account.add.loginHintCodex')}
        </p>
      </form>
    </Modal>
  )
}

interface ImportDraft {
  dir: string
  label: string
  provider: Provider
}

/** Registers a picked config folder as an account. The provider is guessed by the caller (importDraftOf). */
function ImportAccountModal({ draft, onClose }: { draft: ImportDraft; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [label, setLabel] = useState(draft.label)
  const [provider, setProvider] = useState<Provider>(draft.provider)
  // The submit in flight (audit UI-10).
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const name = label.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      await window.api.accounts.import({ label: name, configDir: draft.dir, provider })
      onClose()
    } catch (err) {
      // A folder gone or unreadable is said, not left unhandled (audit UI-10).
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={t('account.import.title')}
      onClose={onClose}
      size="sm"
      closeLabel={t('common.close')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="import-account-form" disabled={busy || !label.trim()}>
            {t('account.import.button')}
          </Button>
        </>
      }
    >
      <form
        id="import-account-form"
        className="acct-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <ProviderPicker value={provider} onChange={setProvider} />
        <Field autoFocus label={t('account.field.label')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <span className="acct-detect__path">{draft.dir}</span>
      </form>
    </Modal>
  )
}

interface DetectItem {
  configDir: string
  loggedIn: boolean
  label: string
  selected: boolean
  provider: Provider
}

/** The accounts found on this machine, each with a checkbox and an editable label; registers the selected ones. */
function DetectAccountsModal({ found, onClose }: { found: DetectItem[]; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [items, setItems] = useState(found)
  // A ref, not only state: two clicks (or Enter and a click) in one frame both see the state still false.
  const importing = useRef(false)
  const [busy, setBusy] = useState(false)
  const edit = (idx: number, patch: Partial<DetectItem>): void =>
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  const importSelected = async (): Promise<void> => {
    if (importing.current) return
    importing.current = true
    setBusy(true)
    let failCount = 0
    for (const item of items.filter((it) => it.selected)) {
      try {
        await window.api.accounts.import({ label: item.label.trim(), configDir: item.configDir, provider: item.provider })
      } catch {
        failCount++
      }
    }
    importing.current = false
    setBusy(false)
    onClose()
    if (failCount > 0) toast.error(t('account.import.someFailed', { count: failCount }))
  }

  return (
    <Modal
      title={t('account.detect.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          {items.length > 0 && (
            <Button
              variant="primary"
              disabled={busy || !items.some((it) => it.selected) || items.some((it) => it.selected && !it.label.trim())}
              onClick={() => void importSelected()}
            >
              {t('account.detect.importSelected')}
            </Button>
          )}
        </>
      }
    >
      <div className="acct-form">
        {items.length === 0 ? (
          <EmptyState icon={ICONS.search} title={t('account.detect.empty')} />
        ) : (
          <ul className="acct-detect">
            {items.map((item, idx) => (
              <li key={item.configDir} className="acct-detect__row">
                <Checkbox checked={item.selected} aria-label={item.label} onChange={() => edit(idx, { selected: !item.selected })} />
                <ProviderBadge provider={item.provider} />
                <div className="acct-detect__main">
                  <Input aria-label={t('account.field.label')} value={item.label} onChange={(e) => edit(idx, { label: e.target.value })} />
                  <span className="acct-detect__path">{item.configDir}</span>
                </div>
                <Chip tone={item.loggedIn ? 'ok' : 'warn'}>
                  <Icon name={item.loggedIn ? 'done' : 'lock'} size={14} />
                  {item.loggedIn ? t('account.status.loggedIn') : t('account.status.notLoggedIn')}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** The unregister flow with its confirmation and "Also log out", the same from both surfaces. */
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
      // main refuses while a running session uses the account (ipc.ts accountRemovalBlockers). The refusal names the
      // sessions, so the owner knows what to close. Logging out happens only after a removal that succeeded, in main,
      // with the account it held before the removal (accounts.remove's logout option): a refused removal must not
      // sign a live session out first.
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
        <p className="acct-note">{t('account.remove.confirm', { label: account.label })}</p>
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

/** Confirms signing an account out (the CLI's own logout, which removes its credentials). The account stays registered.
 *  No re-probe is asked here: accounts.logout fires main's `accounts:status-changed` push, which re-asks every surface's
 *  login state (hooks/useAccountStatus.ts). */
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

export interface AccountCenter {
  /** The surface's one toolbar: Add account, Import an account folder, Find signed-in accounts. */
  tools: ToolbarItem[]
  openAdd: () => void
  /** A row's menu pick (accountActions.ts). `rename` is the row's own; `merge` goes to the caller's `onMerge`. */
  act: (a: Account, id: AccountActionId) => void
  switchBlock: (a: Account) => string | null | undefined
  /** Every dialog this module owns that is open now. Render it once, after the list. */
  dialogs: React.ReactNode
}

/** Add, import, detect, sign in, sign out, unregister and "use for this tab", for one account surface.
 *  `autoDetect`: when the surface mounts with no accounts, look for signed-in ones and offer them (the popover; only
 *  opens when something was found). */
export function useAccountCenter(o: {
  accounts: Account[]
  loginMap: Record<string, boolean>
  autoDetect?: boolean
  onMerge?: (a: Account) => void
}): AccountCenter {
  const { t } = useI18n()
  const [addOpen, setAddOpen] = useState(false)
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null)
  const [detected, setDetected] = useState<DetectItem[] | null>(null)
  const [signInTarget, setSignInTarget] = useState<Account | null>(null)
  const [signOutTarget, setSignOutTarget] = useState<Account | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Account | null>(null)
  const { switchBlock, switchTab } = useTabSwitch(o.accounts, o.loginMap)

  const runDetect = async (isAuto: boolean): Promise<void> => {
    try {
      const candidates = await window.api.accounts.detect()
      if (isAuto && candidates.length === 0) return // the automatic run only opens when there are candidates
      setDetected(
        candidates.map((c) => ({ configDir: c.configDir, loggedIn: c.loggedIn, label: c.suggestedLabel, selected: true, provider: c.provider }))
      )
    } catch (err) {
      console.warn('Account auto-detection failed', err)
      if (!isAuto) toast.error(t('account.detect.failed', { detail: err instanceof Error ? err.message : String(err) }))
    }
  }

  // Driven by the list the surface draws (the `accounts` prop), so the check and the rows cannot disagree. Once per
  // mount; the ref also keeps StrictMode's second effect run (main.tsx) from opening the dialog twice.
  const autoDetectDone = useRef(false)
  const empty = o.accounts.length === 0
  useEffect(() => {
    if (!o.autoDetect || autoDetectDone.current) return
    autoDetectDone.current = true
    if (empty) void runDetect(true)
  }, []) // once per mount, on the list it mounted with

  const startImport = async (): Promise<void> => {
    const dir = await window.api.system.pickFolder()
    if (!dir) return
    // The provider is guessed from which of the two emails can be read; if it is wrong the owner fixes it in the form.
    const claudeEmail = await window.api.accounts.emailOfDir(dir)
    const codexEmail = claudeEmail ? null : await window.api.accounts.emailOfDir(dir, 'codex')
    setImportDraft({ dir, provider: codexEmail ? 'codex' : 'claude', label: claudeEmail ?? codexEmail ?? dir })
  }

  const openAdd = (): void => setAddOpen(true)

  const act = (a: Account, id: AccountActionId): void => {
    if (id === 'signIn' || id === 'signInAgain') setSignInTarget(a)
    else if (id === 'signOut') setSignOutTarget(a)
    else if (id === 'switch') void switchTab(a)
    else if (id === 'merge') o.onMerge?.(a)
    else if (id === 'remove') setRemoveTarget(a)
  }

  const tools: ToolbarItem[] = [
    { id: 'add', icon: <Icon name="add" size={14} />, label: t('accounts.add'), onClick: openAdd },
    { id: 'import', icon: <Icon name="folderAdd" size={14} />, label: t('accounts.import'), onClick: () => void startImport() },
    { id: 'detect', icon: <Icon name="search" size={14} />, label: t('accounts.detect'), onClick: () => void runDetect(false) }
  ]

  const dialogs = (
    <>
      {addOpen && (
        <AddAccountModal
          onClose={() => setAddOpen(false)}
          onAdded={(a) => {
            setAddOpen(false)
            setSignInTarget(a)
          }}
        />
      )}
      {importDraft && <ImportAccountModal key={importDraft.dir} draft={importDraft} onClose={() => setImportDraft(null)} />}
      {detected && <DetectAccountsModal found={detected} onClose={() => setDetected(null)} />}
      {signInTarget && <AccountSignInDialog account={signInTarget} onClose={() => setSignInTarget(null)} />}
      {signOutTarget && <SignOutDialog account={signOutTarget} onClose={() => setSignOutTarget(null)} />}
      {removeTarget && <RemoveAccountDialog account={removeTarget} onClose={() => setRemoveTarget(null)} />}
    </>
  )

  return { tools, openAdd, act, switchBlock, dialogs }
}
