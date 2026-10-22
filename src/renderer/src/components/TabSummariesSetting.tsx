import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { Switch } from './ui'

/** W9-I: the app setting `tabSummaries` (core/settings/tabSummaries.ts): a short card when a tab ends. Only the Host
 *  reads it, so the value lives here, as ActivityDigestSetting's does; the toggle is AutoCloseTabsSetting's. */
export function TabSummariesSetting(): React.JSX.Element {
  const { t } = useI18n()
  const [on, setOn] = useState<boolean | null>(null) // null = first read in flight
  useEffect(() => {
    void window.api.settings.getTabSummaries().then(setOn, () => setOn(true))
  }, [])
  const toggle = (next: boolean): void => {
    setOn(next) // optimistic, reverted on failure
    void window.api.settings.setTabSummaries(next).catch((err) => {
      setOn(!next)
      toast.error(t('settings.tabSummaries.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }
  return (
    <div>
      <label className="settings-row">
        <span>{t('settings.tabSummaries.label')}</span>
        <Switch checked={on ?? false} disabled={on === null} onChange={toggle} />
      </label>
      <span className="settings-hint">{t('settings.tabSummaries.hint')}</span>
    </div>
  )
}
