import { useEffect, useRef, useState } from 'react'
import type { Account, Provider } from '../../../core/types'
import { PROVIDERS, PROVIDER_META, providerOf } from '../../../core/providers/meta'
import { toast } from '../lib/toast'
import { useI18n } from '../i18n/I18nProvider'
import { useAccountStatus, useAccountsList } from '../hooks/useAccountStatus'
import { useAccountUsage } from '../hooks/useAccountUsage'
import { ProviderBadge } from './ProviderBadge'
import { AccountRow, usePausedIds } from './AccountRow'
import { accountActions, type AccountActionId } from './accountActions'
import { AccountSignInDialog } from './AccountSignIn'
import { RemoveAccountDialog, SignOutDialog, useTabSwitch } from './AccountSettings'
import { Badge, Button, Chip, EmptyState, Field, ICONS, Icon, Input, Modal, Tabs, Checkbox, Toolbar } from './ui'

interface DetectItem {
  configDir: string
  loggedIn: boolean
  label: string
  selected: boolean
  provider: Provider
}

/** CLI kind selector for the add and import account modals */
function ProviderPicker({
  value,
  onChange
}: {
  value: Provider
  onChange: (p: Provider) => void
}): React.JSX.Element {
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

export function AccountPanel({ accounts }: { accounts: Account[] }): React.JSX.Element {
  const { t, tm } = useI18n()
  const { loginMap, loginStates, emailMap, defaultIdByProvider } = useAccountStatus(accounts)
  const usage = useAccountUsage()
  // Which row has its usage detail open. One at a time, so the answer belongs to the list
  // rather than to each row. Keyed by account id — configDir can be shared by two accounts.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addLabel, setAddLabel] = useState('')
  const [addCopySettings, setAddCopySettings] = useState(true)
  const [addProvider, setAddProvider] = useState<Provider>('claude')
  const [adding, setAdding] = useState(false)
  const [importDir, setImportDir] = useState<string | null>(null)
  const [importLabel, setImportLabel] = useState('')
  const [importProvider, setImportProvider] = useState<Provider>('claude')
  const [detectItems, setDetectItems] = useState<DetectItem[] | null>(null)
  // A ref, not only state: two clicks (or Enter and a click) in one frame both see the state still false.
  const importing = useRef(false)
  const [importBusy, setImportBusy] = useState(false)
  const autoDetectDone = useRef(false)
  // W7-F (#82): the account being signed in, and the one whose removal is being confirmed.
  const [signInTarget, setSignInTarget] = useState<Account | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Account | null>(null)
  const [signOutTarget, setSignOutTarget] = useState<Account | null>(null)
  const paused = usePausedIds()
  const { switchBlock, switchTab } = useTabSwitch(accounts, loginMap)

  const act = (a: Account, id: AccountActionId): void => {
    if (id === 'signIn' || id === 'signInAgain') setSignInTarget(a)
    else if (id === 'signOut') setSignOutTarget(a)
    else if (id === 'switch') void switchTab(a)
    else if (id === 'remove') setRemoveTarget(a)
  }

  const { accounts: listed, ready } = useAccountsList()
  useEffect(() => {
    // Only an answer fetched this open counts: a cached empty list may be out of date, and the guard keeps
    // StrictMode's second effect run (main.tsx) from opening the detect dialog twice.
    if (!ready || autoDetectDone.current) return
    autoDetectDone.current = true
    if (listed?.length === 0) void runDetect(true)
  }, [ready, listed])

  const runDetect = async (isAuto: boolean): Promise<void> => {
    try {
      const candidates = await window.api.accounts.detect()
      if (isAuto && candidates.length === 0) return // the automatic trigger only opens when there are candidates
      setDetectItems(
        candidates.map((c) => ({
          configDir: c.configDir,
          loggedIn: c.loggedIn,
          label: c.suggestedLabel,
          selected: true,
          provider: c.provider
        }))
      )
    } catch (err) {
      console.warn('Account auto-detection failed', err)
      if (!isAuto)
        toast.error(
          t('account.detect.failed', { detail: err instanceof Error ? err.message : String(err) })
        )
    }
  }

  const toggleDetectItem = (idx: number): void => {
    setDetectItems((items) => items?.map((it, i) => (i === idx ? { ...it, selected: !it.selected } : it)) ?? null)
  }

  const setDetectLabel = (idx: number, label: string): void => {
    setDetectItems((items) => items?.map((it, i) => (i === idx ? { ...it, label } : it)) ?? null)
  }

  const importSelected = async (): Promise<void> => {
    if (!detectItems || importing.current) return
    importing.current = true
    setImportBusy(true)
    let failCount = 0
    for (const item of detectItems.filter((it) => it.selected)) {
      try {
        await window.api.accounts.import({
          label: item.label.trim(),
          configDir: item.configDir,
          provider: item.provider
        })
      } catch {
        failCount++
      }
    }
    importing.current = false
    setImportBusy(false)
    setDetectItems(null)
    if (failCount > 0) toast.error(t('account.import.someFailed', { count: failCount }))
  }

  const openAdd = (): void => {
    setAddLabel('')
    setAddCopySettings(true)
    setAddProvider('claude')
    setAddOpen(true)
  }

  const submitAdd = async (): Promise<void> => {
    const label = addLabel.trim()
    if (!label) return
    if (adding) return
    setAdding(true)
    try {
      const account = await window.api.accounts.create({ label, provider: addProvider })
      // Both providers import settings now. A brand-new account is never the default (it has no
      // credentials yet), so this always copies from an existing account rather than onto itself. If that
      // provider has nothing logged in there is no source, and syncSettings reports that.
      if (addCopySettings) {
        const r = await window.api.accounts.syncSettings(account.id)
        if (!r.ok) toast.error(t('account.add.syncFailed', { detail: tm(r.message ?? null) ?? '' }))
      }
      setAddOpen(false)
      // W7-F (#82): straight on to the sign-in link — an added account with no login was taken for a broken "+".
      setSignInTarget(account)
    } catch (err) {
      // Said, and the dialog stays for another try (audit UI-10).
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  const startImport = async (): Promise<void> => {
    const dir = await window.api.system.pickFolder()
    if (!dir) return
    // The provider is guessed from which of the two emails can be read — if it is wrong the user fixes it with the radio buttons
    const claudeEmail = await window.api.accounts.emailOfDir(dir)
    const codexEmail = claudeEmail ? null : await window.api.accounts.emailOfDir(dir, 'codex')
    setImportProvider(codexEmail ? 'codex' : 'claude')
    setImportLabel(claudeEmail ?? codexEmail ?? dir)
    setImportDir(dir)
  }

  const submitImport = async (): Promise<void> => {
    const label = importLabel.trim()
    if (!label || !importDir || importFormBusy) return
    setImportFormBusy(true)
    try {
      await window.api.accounts.import({ label, configDir: importDir, provider: importProvider })
      setImportDir(null)
    } catch (err) {
      // A folder gone or unreadable is said, not left unhandled (audit UI-10).
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setImportFormBusy(false)
    }
  }
  /** The import form's submit in flight (audit UI-10). */
  const [importFormBusy, setImportFormBusy] = useState(false)

  return (
    <section className="account-panel">
      <header className="acct-head">
        <h2 className="acct-head__title">
          {t('account.panel.title')} <Badge>{accounts.length}</Badge>
        </h2>
        <Toolbar
          label={t('account.panel.title')}
          items={[
            { id: 'add', icon: <Icon name="add" size={14} />, label: t('accounts.add'), onClick: openAdd },
            { id: 'import', icon: <Icon name="folderAdd" size={14} />, label: t('accounts.import'), onClick: () => void startImport() },
            { id: 'detect', icon: <Icon name="search" size={14} />, label: t('accounts.detect'), onClick: () => void runDetect(false) }
          ]}
        />
      </header>
      <ul className="acct-list">
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            loggedIn={loginMap[a.id]}
            email={emailMap[a.id]}
            isDefault={defaultIdByProvider[providerOf(a)] === a.id}
            usage={usage[a.configDir]}
            expanded={expandedId === a.id}
            onToggle={() => setExpandedId((cur) => (cur === a.id ? null : a.id))}
            actions={accountActions({ loggedIn: loginStates[a.id], switchBlock: switchBlock(a), mergeable: false })}
            onAction={(id) => act(a, id)}
            paused={paused.has(a.id)}
          >
            {/* W7-F (#82): sign in from the row itself. `false`, not undefined: no button before the login check has answered. */}
            {loginMap[a.id] === false && (
              <Button size="sm" variant="ghost" icon={<Icon name="login" size={14} />} onClick={() => setSignInTarget(a)}>
                {t('account.signIn.button')}
              </Button>
            )}
          </AccountRow>
        ))}
      </ul>
      {accounts.length === 0 && (
        <EmptyState
          icon={ICONS.users}
          title={t('account.panel.empty')}
          action={
            <Button variant="primary" icon={<Icon name="add" />} onClick={openAdd}>
              {t('accounts.add')}
            </Button>
          }
        >
          {t('account.empty.body')}
        </EmptyState>
      )}
      {addOpen && (
        <Modal
          title={t('account.add.title')}
          onClose={() => setAddOpen(false)}
          size="sm"
          closeLabel={t('common.close')}
          footer={
            <>
              <Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" type="submit" form="add-account-form" disabled={adding || !addLabel.trim()}>
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
                void submitAdd()
              }}
            >
              <ProviderPicker value={addProvider} onChange={setAddProvider} />
              <Field
                autoFocus
                label={t('account.field.label')}
                value={addLabel}
                placeholder={t('account.add.labelPlaceholder')}
                onChange={(e) => setAddLabel(e.target.value)}
              />
              {/* Shown for both providers — claude and codex each import from their own default account */}
              <Checkbox checked={addCopySettings} onChange={(v) => setAddCopySettings(v)} label={t('account.add.copySettingsLabel')} />
              {/* The login-procedure hint is per-CLI prose, so it is not folded behind a capability flag.
                  Same category as ProviderBadge's icon choice — adding a provider means writing new text. */}
              <p className="acct-note acct-note--faint">
                {addProvider === 'claude'
                  ? t('account.add.loginHintClaude')
                  : t('account.add.loginHintCodex')}
              </p>
            </form>
        </Modal>
      )}
      {signInTarget && <AccountSignInDialog account={signInTarget} onClose={() => setSignInTarget(null)} />}
      {signOutTarget && <SignOutDialog account={signOutTarget} onClose={() => setSignOutTarget(null)} />}
      {removeTarget && <RemoveAccountDialog account={removeTarget} onClose={() => setRemoveTarget(null)} />}
      {importDir && (
        <Modal
          title={t('account.import.title')}
          onClose={() => setImportDir(null)}
          size="sm"
          closeLabel={t('common.close')}
          footer={
            <>
              <Button onClick={() => setImportDir(null)}>{t('common.cancel')}</Button>
              <Button variant="primary" type="submit" form="import-account-form" disabled={!importLabel.trim()}>
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
                void submitImport()
              }}
            >
              <ProviderPicker
                value={importProvider}
                onChange={setImportProvider}
              />
              <Field
                autoFocus
                label={t('account.field.label')}
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
              />
            </form>
        </Modal>
      )}
      {detectItems && (
        <Modal
          title={t('account.detect.title')}
          onClose={() => setDetectItems(null)}
          closeLabel={t('common.close')}
          footer={
            <>
              <Button onClick={() => setDetectItems(null)}>{t('common.cancel')}</Button>
              {detectItems.length > 0 && (
                <Button
                  variant="primary"
                  disabled={
                    importBusy ||
                    !detectItems.some((it) => it.selected) ||
                    detectItems.some((it) => it.selected && !it.label.trim())
                  }
                  onClick={() => void importSelected()}
                >
                  {t('account.detect.importSelected')}
                </Button>
              )}
            </>
          }
        >
          <div className="acct-form">
            {detectItems.length === 0 ? (
              <EmptyState icon={ICONS.search} title={t('account.detect.empty')} />
            ) : (
              <ul className="acct-detect">
                {detectItems.map((item, idx) => (
                  <li key={item.configDir} className="acct-detect__row">
                    <Checkbox
                      checked={item.selected}
                      aria-label={item.label}
                      onChange={() => toggleDetectItem(idx)}
                    />
                    <ProviderBadge provider={item.provider} />
                    <div className="acct-detect__main">
                      <Input
                        aria-label={t('account.field.label')}
                        value={item.label}
                        onChange={(e) => setDetectLabel(idx, e.target.value)}
                      />
                      <span className="acct-detect__path">{item.configDir}</span>
                    </div>
                    <Chip tone={item.loggedIn ? 'ok' : 'warn'} dot>
                      {item.loggedIn ? t('account.status.loggedIn') : t('account.status.notLoggedIn')}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </section>
  )
}
