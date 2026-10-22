import { useState } from 'react'
import { Button, EmptyState, ICONS, Icon } from './ui'
import { useI18n } from '../i18n/I18nProvider'
import './search/errorScreen.css'

/** What the user sees when a page crashes: what happened in plain words, Reload, Copy details, Report.
 *  Report opens the crash report prompt (T27, ErrorBoundary passes `onReport`); without one it is disabled. */
export function ErrorScreen({ error, onReport }: { error: Error; onReport?: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const details = [error.name + ': ' + error.message, error.stack].filter(Boolean).join('\n')
  const copy = (): void => {
    window.api.clipboard.writeText(details)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="err-screen">
      <EmptyState
        role="alert"
        icon={ICONS.warning}
        title={t('app.renderError')}
        detail={<pre className="err-screen__details" tabIndex={0} aria-label={t('app.renderErrorDetails')}>{details}</pre>}
        action={
          <div className="err-screen__actions">
            <Button variant="primary" icon={<Icon name="refresh" />} onClick={() => window.location.reload()} autoFocus>
              {t('app.renderErrorReload')}
            </Button>
            <Button icon={<Icon name={copied ? 'check' : 'copy'} />} onClick={copy}>
              {copied ? t('app.renderErrorCopied') : t('app.renderErrorCopy')}
            </Button>
            <Button variant="ghost" onClick={onReport} disabled={!onReport}>
              {t('app.renderErrorReport')}
            </Button>
          </div>
        }
      >
        {t('app.renderErrorWhat')}
      </EmptyState>
    </div>
  )
}
