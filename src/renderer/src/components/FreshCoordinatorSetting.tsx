import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Input } from './ui'

/** Context use (%) at which a plan's coordinator is replaced (core/settings/freshCoordinator.ts), 0 for off. Saved on
 *  blur, as MaxWorkersSetting is; a value that is not a whole number from 0 to 100 goes back to what was saved. */
export function FreshCoordinatorSetting(): React.JSX.Element {
  const { t } = useI18n()
  const [saved, setSaved] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    void window.api.settings.getFreshCoordinatorContextPct().then((n) => {
      setSaved(n)
      setDraft(String(n))
    })
  }, [])

  const commit = (): void => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isInteger(n) || n < 0 || n > 100) {
      setDraft(saved === null ? '' : String(saved))
      return
    }
    if (n === saved) return
    const was = saved
    setSaved(n)
    void window.api.settings.setFreshCoordinatorContextPct(n).catch((err) => {
      setSaved(was)
      setDraft(was === null ? '' : String(was))
      toast.error(t('settings.freshCoordinator.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <div>
      <label className="settings-row">
        <span>{t('settings.freshCoordinator.label')}</span>
        <Input
          type="number"
          min={0}
          max={100}
          value={draft}
          disabled={saved === null}
          aria-label={t('settings.freshCoordinator.label')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      </label>
      <span className="settings-hint">{t('settings.freshCoordinator.hint')}</span>
    </div>
  )
}
