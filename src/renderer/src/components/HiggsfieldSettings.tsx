import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { useSetting } from '../hooks/useSetting'
import { hfAccountTitle, hfWorkspaceLabel } from '../../../core/higgsfield/display'
import { Button, ConfirmDialog, Input, Select } from './ui'

type HfList = Awaited<ReturnType<typeof window.api.higgsfield.list>>
type HfAccountRow = HfList['accounts'][number]
type HfLoginState = Awaited<ReturnType<typeof window.api.higgsfield.loginState>>

/** The Higgsfield pane of the settings modal: the accounts Astera keeps, the one every agent
 *  `higgsfield` call runs under, and how to add, import, log in and remove them. The current account is
 *  shown at the top of this tab only (Astera has no app-wide status bar). A login runs alongside the
 *  other buttons: its row offers the login link to copy (for a private window) and a cancel. */
export function HiggsfieldSettings(): React.JSX.Element {
  const { t } = useI18n()
  const [readData, setData] = useSetting('higgsfieldList', () =>
    window.api.higgsfield.list().catch((err) => {
      toast.error(String(err))
      throw err
    })
  )
  const data = readData ?? null
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [readLogin, setLogin] = useSetting<HfLoginState>('higgsfieldLogin', () => window.api.higgsfield.loginState(), null)
  const login = readLogin
  // true while this pane awaits login(): its answer reloads the list. A login found running when the
  // pane opened is followed by polling alone.
  const awaitingLogin = useRef(false)
  const [removeTarget, setRemoveTarget] = useState<HfAccountRow | null>(null)
  // The workspace chosen in each row's picker (account id -> workspace id); the first one until changed.
  const [picked, setPicked] = useState<Record<string, string>>({})

  const reload = useCallback(async (): Promise<void> => {
    try {
      setData(await window.api.higgsfield.list())
    } catch (err) {
      toast.error(String(err))
    }
  }, [])

  const loginId = login?.id ?? null
  useEffect(() => {
    if (loginId === null) return
    const timer = setInterval(() => {
      window.api.higgsfield.loginState().then((s) => {
        if (s) setLogin(s)
        else if (!awaitingLogin.current) {
          setLogin(null)
          void reload()
        }
      }, () => {})
    }, 1000)
    return () => clearInterval(timer)
  }, [loginId, reload])

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setBusy(false)
    }
    await reload()
  }

  const addFrom = (how: 'add' | 'importCurrent') => async (): Promise<void> => {
    const name = label.trim()
    if (name === '') return
    await act(async () => {
      await window.api.higgsfield[how](name)
      setLabel('')
    })
  }

  // Not through act(): the other buttons stay usable while the browser is open.
  const startLogin = async (a: HfAccountRow): Promise<void> => {
    if (login !== null || awaitingLogin.current) return
    awaitingLogin.current = true
    setLogin({ id: a.id, url: null })
    try {
      const r = await window.api.higgsfield.login(a.id)
      if (r.reason === 'timeout') toast.error(t('higgsfield.loginTimeout'))
      else if (!r.ok && r.reason !== 'cancelled') toast.error(r.message ?? t('higgsfield.loginFailed'))
    } catch (err) {
      toast.error(String(err))
    } finally {
      awaitingLogin.current = false
      setLogin(null)
    }
    await reload()
  }

  const cancelLogin = async (): Promise<void> => {
    try {
      await window.api.higgsfield.cancelLogin()
    } catch (err) {
      toast.error(String(err))
    }
    // A login this pane did not start: nothing else will put the row back.
    if (!awaitingLogin.current) {
      setLogin(null)
      await reload()
    }
  }

  const copyLoginUrl = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('higgsfield.urlCopied'))
    } catch (err) {
      toast.error(String(err))
    }
  }

  const confirmRemove = async (): Promise<void> => {
    const target = removeTarget
    if (!target) return
    setRemoveTarget(null)
    await act(() => window.api.higgsfield.remove(target.id))
  }

  const current = data?.accounts.find((a) => a.current)
  // From the list too: a login started before this pane opened shows before the first poll answers.
  const loggingInId = loginId ?? data?.accounts.find((a) => a.loggingIn)?.id ?? null

  return (
    <div className="settings-accounts">
      {data?.cliIssue && (
        <div className="settings-warn-box" role="alert">{t('higgsfield.binaryMissing', { path: data.cliIssue.path })}</div>
      )}
      {data !== null && !data.cliFound && <span className="settings-hint">{t('higgsfield.cliMissing')}</span>}
      {current && <div className="settings-field-label">{t('higgsfield.current', { label: current.label })}</div>}
      <span className="settings-hint">{t('higgsfield.hint')}</span>
      <ul>
        {data?.accounts.map((a) => {
          const isLoggingIn = loggingInId === a.id
          const url = isLoggingIn ? login?.url ?? null : null
          return (
            <li key={a.id} className="account-row">
              <span className="account-label">{hfAccountTitle(a.label, a.email)}</span>
              {isLoggingIn ? (
                <span className="badge">{t('higgsfield.loggingIn')}</span>
              ) : a.needsLogin ? (
                <span className="badge">{t('higgsfield.needsLogin')}</span>
              ) : a.needsWorkspace ? (
                <span className="badge">{t('higgsfield.needsWorkspace')}</span>
              ) : (
                <span className="badge ok">
                  {a.credits === null ? t('higgsfield.creditsUnknown') : t('higgsfield.credits', { n: a.credits })}
                </span>
              )}
              <span className="account-row-actions">
                <Button size="sm" disabled={busy || a.current || a.needsLogin} onClick={() => void act(() => window.api.higgsfield.setCurrent(a.id))}>
                  {t('higgsfield.use')}
                </Button>
                {isLoggingIn ? (
                  <>
                    <Button size="sm" disabled={url === null} onClick={() => { if (url !== null) void copyLoginUrl(url) }}>
                      {t('higgsfield.copyUrl')}
                    </Button>
                    <Button size="sm" onClick={() => void cancelLogin()}>{t('higgsfield.cancelLogin')}</Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy || !data.cliFound || data.cliIssue !== null || loggingInId !== null}
                    onClick={() => void startLogin(a)}
                  >
                    {t('higgsfield.login')}
                  </Button>
                )}
                <Button variant="danger" size="sm" disabled={busy || isLoggingIn} onClick={() => setRemoveTarget(a)}>
                  {t('higgsfield.remove')}
                </Button>
              </span>
              {isLoggingIn && <span className="settings-hint account-row-hint">{t('higgsfield.loginHint')}</span>}
              {!isLoggingIn && a.needsWorkspace && (a.workspaces?.length ?? 0) > 0 && (
                <span className="account-row-hint account-row-actions">
                  <Select
                    ariaLabel={t('higgsfield.workspace')}
                    value={picked[a.id] ?? a.workspaces![0].id}
                    onChange={(v) => setPicked((p) => ({ ...p, [a.id]: v }))}
                    items={a.workspaces!.map((w) => ({ value: w.id, label: hfWorkspaceLabel(w, (n) => t('higgsfield.credits', { n })) }))}
                  />
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void act(() => window.api.higgsfield.setWorkspace(a.id, picked[a.id] ?? a.workspaces![0].id))}
                  >
                    {t('higgsfield.pickWorkspace')}
                  </Button>
                </span>
              )}
            </li>
          )
        })}
        {data !== null && data.accounts.length === 0 && <li className="empty">{t('higgsfield.none')}</li>}
      </ul>
      <div className="settings-row">
        <Input
          type="text"
          
          value={label}
          placeholder={t('higgsfield.label')}
          aria-label={t('higgsfield.label')}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addFrom('add')()
          }}
        />
        <Button variant="primary" disabled={busy || label.trim() === ''} onClick={() => void addFrom('add')()}>
          {t('higgsfield.add')}
        </Button>
        <Button disabled={busy || label.trim() === ''} onClick={() => void addFrom('importCurrent')()}>
          {t('higgsfield.import')}
        </Button>
      </div>
      <span className="settings-hint">{t('higgsfield.importNote')}</span>
      {removeTarget && (
        <ConfirmDialog
          title={t('higgsfield.remove')}
          confirmLabel={t('higgsfield.remove')}
          cancelLabel={t('common.cancel')}
          closeLabel={t('common.close')}
          danger
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoveTarget(null)}
        >
          <p>{t('higgsfield.removeConfirm', { label: removeTarget.label })}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
