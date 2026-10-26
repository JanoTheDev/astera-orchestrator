import { useEffect, useRef, useState } from 'react'
import type { Account } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Button, Field, Icon, Modal } from './ui'

/** W7-F (#82): signs one account in. Astera runs the CLI's own login for the account's folder (main/accountLogin.ts)
 *  and shows the link it prints, with "Open in browser", "Copy" and a box for the code the CLI may ask for. Closes by
 *  itself once the login probe says the folder is logged in. Closing it early cancels the CLI's login. */
export function AccountSignInDialog({ account, onClose }: { account: Account; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState<{ url: string | null; asksCode: boolean }>({ url: null, asksCode: false })
  const [code, setCode] = useState('')
  // A failed or timed-out login keeps the dialog open with its reason and Retry; each Retry is a new attempt.
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const closed = useRef(false)
  const close = (): void => {
    if (closed.current) return
    closed.current = true
    void window.api.accounts.cancelLogin().catch(() => {})
    onClose()
  }

  useEffect(() => {
    // Per run of this effect, not the shared ref: under StrictMode the first run's login answers "cancelled" after the
    // second run has started, and must not close the dialog the second run owns.
    let alive = true
    closed.current = false
    setError(null)
    setState({ url: null, asksCode: false })
    const fail = (message: string): void => {
      if (!alive || closed.current) return
      setError(message)
    }
    const finish = (): void => {
      if (!alive || closed.current) return
      closed.current = true
      onClose()
    }
    window.api.accounts.login(account.id).then(
      (r) => {
        if (!alive || closed.current) return
        if (r.ok) {
          toast.success(t('account.signIn.done', { label: account.label }))
          finish()
        } else if (r.reason === 'timeout') fail(t('account.signIn.timeout'))
        else if (r.reason === 'cancelled') finish()
        else fail(t('account.signIn.failed', { detail: r.message ?? '' }))
      },
      (err) => fail(t('account.signIn.failed', { detail: err instanceof Error ? err.message : String(err) }))
    )
    // The link arrives a moment after the CLI starts; the probe settles it, also for a browser-side login the CLI
    // itself does not notice at once.
    const timer = setInterval(() => {
      window.api.accounts.loginState().then((s) => { if (alive && s && s.id === account.id) setState({ url: s.url, asksCode: s.asksCode }) }, () => {})
      window.api.accounts.loginStatus(account.id).then((on) => {
        if (!on || !alive || closed.current) return
        toast.success(t('account.signIn.done', { label: account.label }))
        close()
      }, () => {})
    }, 1000)
    return () => {
      alive = false
      clearInterval(timer)
      void window.api.accounts.cancelLogin().catch(() => {})
    }
    // One login per open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, attempt])

  const copy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('account.signIn.copied'))
    } catch (err) {
      toast.error(String(err))
    }
  }

  const sendCode = async (): Promise<void> => {
    if (!code.trim()) return
    try {
      await window.api.accounts.loginCode(code)
      setCode('')
    } catch (err) {
      toast.error(String(err))
    }
  }

  return (
    <Modal
      title={t('account.signIn.title', { label: account.label })}
      onClose={close}
      size="sm"
      closeLabel={t('common.close')}
      footer={
        <>
          {error !== null && (
            <Button variant="primary" icon={<Icon name="refresh" />} onClick={() => setAttempt((n) => n + 1)}>
              {t('account.signIn.retry')}
            </Button>
          )}
          <Button onClick={close}>{t('common.cancel')}</Button>
        </>
      }
    >
      <div className="acct-form">
        {error !== null ? (
          <p className="acct-note acct-note--warn" role="alert">{error}</p>
        ) : state.url === null ? (
          <p className="acct-note acct-note--faint">{t('account.signIn.starting')}</p>
        ) : (
          <>
            <p className="acct-note acct-note--faint">{t('account.signIn.body')}</p>
            <a
              className="acct-signin-url"
              href={state.url}
              onClick={(e) => {
                e.preventDefault()
                void window.api.system.openExternal(state.url!)
              }}
            >
              {state.url}
            </a>
            <div className="acct-actions">
              <Button variant="primary" icon={<Icon name="external" />} onClick={() => void window.api.system.openExternal(state.url!)}>
                {t('account.signIn.open')}
              </Button>
              <Button icon={<Icon name="copy" />} onClick={() => void copy(state.url!)}>
                {t('account.signIn.copy')}
              </Button>
            </div>
          </>
        )}
        {error === null && state.asksCode && (
          <form
            className="acct-signin-code"
            onSubmit={(e) => {
              e.preventDefault()
              void sendCode()
            }}
          >
            <Field
              label={t('account.signIn.codeLabel')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" disabled={!code.trim()}>
              {t('account.signIn.codeSubmit')}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  )
}
