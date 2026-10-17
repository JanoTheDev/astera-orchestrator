import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'

/** The app-wide Job worker cap (orchestrator W1-B). Empty is no cap. Saved on blur, so typing "12" does not save "1" on
 *  the way; a value that is not a whole number of 1 or more goes back to what was saved. */
export function MaxWorkersSetting(): React.JSX.Element {
  const { t } = useI18n()
  const [saved, setSaved] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void window.api.settings.getMaxConcurrentWorkers().then((n) => {
      setSaved(n)
      setDraft(n === null ? '' : String(n))
    })
  }, [])

  const commit = (): void => {
    const n = draft.trim() === '' ? null : Number(draft)
    if (n !== null && (!Number.isInteger(n) || n < 1)) {
      setDraft(saved === null ? '' : String(saved))
      return
    }
    if (n === saved) return
    setSaved(n)
    void window.api.settings.setMaxConcurrentWorkers(n).catch((err) => {
      setSaved(saved)
      setDraft(saved === null ? '' : String(saved))
      toast.error(t('settings.maxWorkers.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <div className="settings-group">
      <label className="settings-row">
        <span>{t('settings.maxWorkers.label')}</span>
        <input
          type="number"
          min={1}
          value={draft}
          aria-label={t('settings.maxWorkers.label')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      </label>
      <span className="settings-hint">{t('settings.maxWorkers.hint')}</span>
    </div>
  )
}
