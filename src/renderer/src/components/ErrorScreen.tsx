import { useState } from 'react'
import { Button, EmptyState, ICONS, Icon } from './ui'
import { useI18n } from '../i18n/I18nProvider'
import './search/errorScreen.css'

/** The technical text behind a plain-words message: a collapsible mono block with Copy. Shared by the error screen and the
 *  crash report prompt (which opens it, because what leaves the computer must be readable first). */
export function ErrorDetails({
  label,
  text,
  defaultOpen
}: {
  label: string
  text: string
  defaultOpen?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    window.api.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <details className="err-details" open={defaultOpen}>
      <summary>{label}</summary>
      <pre className="err-screen__details" tabIndex={0} aria-label={label}>
        {text}
      </pre>
      <Button size="sm" icon={<Icon name={copied ? 'check' : 'copy'} size={14} />} onClick={copy}>
        {copied ? t('app.renderErrorCopied') : t('app.renderErrorCopy')}
      </Button>
    </details>
  )
}

/** What the user sees when a page crashes: an icon, one headline, one sentence, the details behind a disclosure, then
 *  Reload and Report. Report opens the crash report prompt (T27, ErrorBoundary passes `onReport`); without one it is disabled. */
export function ErrorScreen({ error, onReport }: { error: Error; onReport?: () => void }): React.JSX.Element {
  const { t } = useI18n()
  // Chromium's stack already begins with "Name: message": do not print that line twice
  const head = error.name + ': ' + error.message
  const details = error.stack?.startsWith(head) ? error.stack : [head, error.stack].filter(Boolean).join('\n')
  return (
    <div className="err-screen">
      <EmptyState
        role="alert"
        icon={ICONS.warning}
        title={t('app.renderError')}
        detail={<ErrorDetails label={t('app.renderErrorDetails')} text={details} />}
        action={
          <div className="err-screen__actions">
            <Button variant="primary" icon={<Icon name="refresh" />} onClick={() => window.location.reload()} autoFocus>
              {t('app.renderErrorReload')}
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
