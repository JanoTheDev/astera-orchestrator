// T6: the note under a cap Astera lowered itself, with the button that gives the person's own limit back.
import { useEffect, useState } from 'react'
import type { AutoLimits } from '../../../core/types'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Button } from './ui'
import { autoLimitNote } from './autoLimitNote'

const REFRESH_MS = 30_000

/** The auto-limits file, re-read every 30 s while the page is open (a cheap IPC read) and after a restore. */
export function useAutoLimits(): { auto: AutoLimits; refresh: () => void } {
  const [auto, setAuto] = useState<AutoLimits>({ history: [] })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    const read = (): void => void window.api.settings.getAutoLimits().then((a) => live && setAuto(a), () => {})
    read()
    const id = setInterval(read, REFRESH_MS)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [tick])
  return { auto, refresh: () => setTick((n) => n + 1) }
}

export function AutoLimitHint({ kind }: { kind: 'workers' | 'heavy' }): React.JSX.Element | null {
  const { t } = useI18n()
  const { auto, refresh } = useAutoLimits()
  const note = autoLimitNote(auto, kind, t)
  const checks = kind === 'heavy' && auto.checksAsHeavy
  if (!note && !checks) return null
  const restore = (): void => {
    window.api.settings.restoreAutoLimits().then(refresh, (err) =>
      toast.error(t('settings.autoLimit.restoreFailed', { detail: err instanceof Error ? err.message : String(err) }))
    )
  }
  return (
    <>
      {note && (
        <span className="settings-hint">
          {note}{' '}
          <Button size="sm" onClick={restore}>
            {t('settings.autoLimit.restore')}
          </Button>
        </span>
      )}
      {checks && <span className="settings-hint">{t('settings.autoLimit.checksWait')}</span>}
    </>
  )
}
