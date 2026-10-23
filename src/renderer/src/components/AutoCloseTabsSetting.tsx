import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Switch } from './ui'
import { SettingItem } from './settings/SettingItem'

/** W7-F (#84): the app setting `autoCloseEndedPlanTabs` (lib/tabAutoClose.ts). App owns the value, because its
 *  auto-close effect reads it; this is AlertSoundSetting's optimistic toggle on that value. */
export function AutoCloseTabsSetting({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }): React.JSX.Element {
  const { t } = useI18n()
  const toggle = (next: boolean): void => {
    onChange(next) // optimistic, reverted on failure
    void window.api.settings.setAutoCloseEndedPlanTabs(next).catch((err) => {
      onChange(!next)
      toast.error(t('settings.autoCloseTabs.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }
  return (
    <SettingItem title={t('settings.autoCloseTabs.label')} hint={t('settings.autoCloseTabs.hint')} control={<Switch aria-label={t('settings.autoCloseTabs.label')} checked={on} onChange={toggle} />} />
  )
}
