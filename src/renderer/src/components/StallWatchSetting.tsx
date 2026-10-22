import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Switch } from './ui'

/** The stall watchdog's on/off (core/settings/stallWatch.ts), on by default: AlertSoundSetting's optimistic toggle. */
export function StallWatchSetting(): React.JSX.Element {
  const { t } = useI18n()
  const [on, setOn] = useState<boolean | null>(null)

  useEffect(() => {
    void window.api.settings.getStallWatch().then(setOn, () => setOn(true))
  }, [])

  const toggle = (next: boolean): void => {
    setOn(next) // optimistic, reverted on failure
    void window.api.settings.setStallWatch(next).catch((err) => {
      setOn(!next)
      toast.error(t('settings.stallWatch.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <div className="settings-group">
      <label className="settings-row">
        <span>{t('settings.stallWatch.label')}</span>
        <Switch checked={on ?? true} disabled={on === null} onChange={toggle} />
      </label>
      <span className="settings-hint">{t('settings.stallWatch.hint')}</span>
    </div>
  )
}
