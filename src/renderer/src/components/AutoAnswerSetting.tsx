import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'

/** T21: "Answer questions automatically" (orchestration/exec/autoAnswer.ts), on by default: StallWatchSetting's toggle. */
export function AutoAnswerSetting(): React.JSX.Element {
  const { t } = useI18n()
  const [on, setOn] = useState<boolean | null>(null)

  useEffect(() => {
    void window.api.settings.getAutoAnswer().then(setOn, () => setOn(true))
  }, [])

  const toggle = (next: boolean): void => {
    setOn(next) // optimistic, reverted on failure
    void window.api.settings.setAutoAnswer(next).catch((err) => {
      setOn(!next)
      toast.error(t('settings.autoAnswer.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <div className="settings-group">
      <label className="settings-row">
        <span>{t('settings.autoAnswer.label')}</span>
        <input type="checkbox" role="switch" className="ui-toggle" checked={on ?? true} disabled={on === null} onChange={(e) => toggle(e.target.checked)} />
      </label>
      <span className="settings-hint">{t('settings.autoAnswer.hint')}</span>
    </div>
  )
}
