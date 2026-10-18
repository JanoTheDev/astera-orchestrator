import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'

/** W6-B: the chime with a notice that needs the owner (lib/alertSound.ts), the app setting `alertSound`. */
export function AlertSoundSetting(): React.JSX.Element {
  const { t } = useI18n()
  const [on, setOn] = useState<boolean | null>(null) // null = first read in flight

  useEffect(() => {
    void window.api.settings.getAlertSound().then(setOn)
  }, [])

  const toggle = (next: boolean): void => {
    const was = on
    setOn(next) // optimistic, reverted on failure
    void window.api.settings.setAlertSound(next).catch((err) => {
      setOn(was)
      toast.error(t('settings.alertSound.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <div>
      <label className="settings-row">
        <span>{t('settings.alertSound.label')}</span>
        <input type="checkbox" checked={on ?? false} disabled={on === null} onChange={(e) => toggle(e.target.checked)} />
      </label>
      <span className="settings-hint">{t('settings.alertSound.hint')}</span>
    </div>
  )
}
