import { useEffect, useRef, useState } from 'react'
import type { Account } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { backdropProps } from '../lib/backdrop'

/** W7-F (#82): signs one account in. Astera runs the CLI's own login for the account's folder (main/accountLogin.ts)
 *  and shows the link it prints, with "Open in browser", "Copy" and a box for the code the CLI may ask for. Closes by
 *  itself once the login probe says the folder is logged in. Closing it early cancels the CLI's login. */
export function AccountSignInDialog({ account, onClose }: { account: Account; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [state, setState] = useState<{ url: string | null; asksCode: boolean }>({ url: null, asksCode: false })
  const [code, setCode] = useState('')
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
    const finish = (): void => {
      if (!alive || closed.current) return
      closed.current = true
      onClose()
    }
    window.api.accounts.login(account.id).then(
      (r) => {
        if (!alive || closed.current) return
        if (r.ok) toast.success(t('account.signIn.done', { label: account.label }))
        else if (r.reason === 'timeout') toast.error(t('account.signIn.timeout'))
        else if (r.reason !== 'cancelled') toast.error(t('account.signIn.failed', { detail: r.message ?? '' }))
        finish()
      },
      (err) => {
        if (!alive || closed.current) return
        toast.error(t('account.signIn.failed', { detail: err instanceof Error ? err.message : String(err) }))
        finish()
      }
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
  }, [account.id])

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
    <div className="modal-backdrop" {...backdropProps(close)}>
      <div className="modal account-signin" onClick={(e) => e.stopPropagation()}>
        <h2>{t('account.signIn.title', { label: account.label })}</h2>
        {state.url === null ? (
          <p className="modal-hint">{t('account.signIn.starting')}</p>
        ) : (
          <>
            <p className="modal-hint">{t('account.signIn.body')}</p>
            <a
              className="account-signin-url"
              href={state.url}
              onClick={(e) => {
                e.preventDefault()
                void window.api.system.openExternal(state.url!)
              }}
            >
              {state.url}
            </a>
            <div className="row">
              <button className="primary" type="button" onClick={() => void window.api.system.openExternal(state.url!)}>
                {t('account.signIn.open')}
              </button>
              <button type="button" onClick={() => void copy(state.url!)}>
                {t('account.signIn.copy')}
              </button>
            </div>
          </>
        )}
        {state.asksCode && (
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault()
              void sendCode()
            }}
          >
            <label>{t('account.signIn.codeLabel')}</label>
            <div className="row">
              <input type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} />
              <button type="submit" disabled={!code.trim()}>
                {t('account.signIn.codeSubmit')}
              </button>
            </div>
          </form>
        )}
        <div className="row right">
          <button type="button" onClick={close}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
