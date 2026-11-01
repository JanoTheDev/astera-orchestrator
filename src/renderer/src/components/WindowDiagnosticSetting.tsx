import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Switch } from './ui'
import { SettingItem } from './settings/SettingItem'

/** The Windows window diagnostic's on/off (core/settings/windowDiagnostic.ts), off by default: StallWatchSetting's toggle. */
export function WindowDiagnosticSetting(): React.JSX.Element {
  const { t } = useI18n()
  const [on, setOn] = useState<boolean | null>(null)

  useEffect(() => {
    void window.api.settings.getWindowDiagnostic().then(setOn, () => setOn(false))
  }, [])

  const toggle = (next: boolean): void => {
    setOn(next) // optimistic, reverted on failure
    void window.api.settings.setWindowDiagnostic(next).catch((err) => {
      setOn(!next)
      toast.error(t('settings.windowDiagnostic.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <SettingItem title={t('settings.windowDiagnostic.label')} hint={t('settings.windowDiagnostic.hint')} control={<Switch aria-label={t('settings.windowDiagnostic.label')} checked={on ?? false} disabled={on === null} onChange={toggle} />} />
  )
}
