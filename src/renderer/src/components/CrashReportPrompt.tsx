// T27: the one place a crash report can leave the machine, and only through the person's Send. It shows the report
// exactly as the issue would carry it; Send has main open the GitHub issue page in the browser (main builds the URL
// from the file, crash.send), Do not send keeps it on this computer, Never ask turns the prompt off (setting
// crashReports). Each report is offered once: main marks it when it hands it over.
import { useEffect, useState } from 'react'
import type { CrashOffer, RENDERER_KINDS } from '../../../core/crash/report'
import { Button, Modal } from './ui'
import { ErrorDetails } from './ErrorScreen'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { newestCrashLowering } from './autoLimitNote'
import { openSettings } from './shell/navigation'
import './search/errorScreen.css'
import './sessionDialog.css'

/** What the renderer sends about its own error: name and stack, never the message (it can carry a token). */
export function errorShapeOf(
  kind: (typeof RENDERER_KINDS)[number],
  err: unknown
): { kind: (typeof RENDERER_KINDS)[number]; name: string; stack: string } {
  return err instanceof Error ? { kind, name: err.name, stack: err.stack ?? '' } : { kind, name: typeof err, stack: '' }
}

/** Hands an error to main; the offer, or null for a repeat or a failure. Never rejects: a rejection here would
 *  be an unhandled rejection, reported again. */
export const reportRendererError = (kind: (typeof RENDERER_KINDS)[number], err: unknown): Promise<CrashOffer | null> =>
  window.api.crash.report(errorShapeOf(kind, err)).catch(() => null)

/** `onNever` closes after Never ask; defaults to `onClose` (a queue passes one that drops the rest too). */
export function CrashReportPrompt({
  offer,
  onClose,
  onNever
}: {
  offer: CrashOffer
  onClose: () => void
  onNever?: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Modal
      title={t('crash.prompt.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              void window.api.settings.setCrashReports('never').catch(() => {})
              ;(onNever ?? onClose)()
            }}
          >
            {t('crash.prompt.never')}
          </Button>
          <Button onClick={onClose}>{t('crash.prompt.dontSend')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              void window.api.crash.send(offer.id).catch(() => false)
              onClose()
            }}
          >
            {t('crash.prompt.send')}
          </Button>
        </>
      }
    >
      <div className="sd-body">
        <p className="sd-text">{t('crash.prompt.intro')}</p>
        <ErrorDetails label={t('crash.prompt.reportLabel')} text={`${offer.title}\n\n${offer.body}`} defaultOpen />
        <p className="sd-hint">{t('crash.prompt.kept')}</p>
      </div>
    </Modal>
  )
}

/** Mounted once in shell/Overlays: offers reports left by a crash before this start, and the window's own errors
 *  as they happen (while the setting is ask), one at a time. */
export function CrashReportHost(): React.JSX.Element | null {
  const [queue, setQueue] = useState<CrashOffer[]>([])

  useEffect(() => {
    let live = true
    const add = (offers: CrashOffer[]): void => {
      if (live && offers.length > 0) setQueue((q) => [...q, ...offers])
    }
    void window.api.crash.pending().then(add, () => {})
    // An ErrorEvent with no Error (a ResizeObserver loop notice, a script from elsewhere) carries nothing to report
    const onError = (e: ErrorEvent): void => {
      if (e.error instanceof Error) void reportRendererError('error', e.error).then((o) => add(o?.ask ? [o] : []))
    }
    const onRejection = (e: PromiseRejectionEvent): void => {
      void reportRendererError('unhandledrejection', e.reason).then((o) => add(o?.ask ? [o] : []))
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      live = false
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  const offer = queue[0]
  if (!offer) return null
  return (
    <CrashReportPrompt
      key={offer.id}
      offer={offer}
      onClose={() => setQueue((q) => q.slice(1))}
      onNever={() => setQueue([])}
    />
  )
}

const SEEN_KEY = 'astera.autoLimits.crashSeen'

/** T6: at start, one toast when a crash or out-of-memory lowering is newer than the one the person last saw. */
export function AutoLimitsCrashNotice(): null {
  const { t } = useI18n()
  useEffect(() => {
    void window.api.settings.getAutoLimits().then((auto) => {
      const at = newestCrashLowering(auto)
      let seen: string | null = null
      try {
        seen = localStorage.getItem(SEEN_KEY)
      } catch {
        /* no storage: show it, as the person has not been told */
      }
      if (!at || (seen !== null && seen >= at)) return
      try {
        localStorage.setItem(SEEN_KEY, at)
      } catch {
        /* shown again next start */
      }
      toast.info(t('settings.autoLimit.crashToast'), { action: { label: t('settings.autoLimit.openSettings'), onClick: () => openSettings('agents') } })
    }, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per start
  }, [])
  return null
}
