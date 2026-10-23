import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Switch } from './ui'
import { SettingItem } from './settings/SettingItem'

/** "Start Astera at login" (core/settings/startAtLogin.ts), on by default: AlertSoundSetting's optimistic toggle. */
export function StartAtLoginSetting(): React.JSX.Element {
  const { t } = useI18n()
  const [on, setOn] = useState<boolean | null>(null)

  useEffect(() => {
    void window.api.settings.getStartAtLogin().then(setOn, () => setOn(true))
  }, [])

  const toggle = (next: boolean): void => {
    setOn(next) // optimistic, reverted on failure
    void window.api.settings.setStartAtLogin(next).catch((err) => {
      setOn(!next)
      toast.error(t('settings.startAtLogin.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <SettingItem title={t('settings.startAtLogin.label')} hint={t('settings.startAtLogin.hint')} control={<Switch aria-label={t('settings.startAtLogin.label')} checked={on ?? true} disabled={on === null} onChange={toggle} />} />
  )
}
