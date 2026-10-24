// W6-G: the two usage guard settings, beside the app-wide worker cap. Saved on blur like MaxWorkersSetting; a value out
// of range goes back to what was saved.
import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { toast } from '../../lib/toast'
import { Card, Field } from '../ui'

function NumberSetting(p: {
  label: string
  hint: string
  min: number
  max: number
  get(): Promise<number>
  set(n: number): Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const [saved, setSaved] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const { get } = p

  useEffect(() => {
    void get().then((n) => {
      setSaved(n)
      setDraft(String(n))
    })
  }, [get])

  const commit = (): void => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isInteger(n) || n < p.min || n > p.max) {
      setDraft(saved === null ? '' : String(saved))
      return
    }
    if (n === saved) return
    const was = saved
    setSaved(n)
    p.set(n).catch((err) => {
      setSaved(was)
      setDraft(was === null ? '' : String(was))
      toast.error(t('settings.usageGuard.saveFailed', { detail: err instanceof Error ? err.message : String(err) }))
    })
  }

  return (
    <div className="settings-group">
      <Field
        kind="number"
        label={p.label}
        hint={p.hint}
        min={p.min}
        max={p.max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    </div>
  )
}

const getSubagents = (): Promise<number> => window.api.settings.getMaxSubagentsPerSession()
const setSubagents = (n: number): Promise<void> => window.api.settings.setMaxSubagentsPerSession(n)
const getPauseAt = (): Promise<number> => window.api.settings.getUsagePauseAt()
const setPauseAt = (n: number): Promise<void> => window.api.settings.setUsagePauseAt(n)

export function UsageGuardSettings(): React.JSX.Element {
  const { t } = useI18n()
  return (
    <Card className="acct-card acct-limits">
      <NumberSetting
        label={t('settings.usageGuard.subagentsLabel')}
        hint={t('settings.usageGuard.subagentsHint')}
        min={1}
        max={10}
        get={getSubagents}
        set={setSubagents}
      />
      <NumberSetting
        label={t('settings.usageGuard.pauseAtLabel')}
        hint={t('settings.usageGuard.pauseAtHint')}
        min={1}
        max={100}
        get={getPauseAt}
        set={setPauseAt}
      />
    </Card>
  )
}
