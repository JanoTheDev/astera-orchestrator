import { useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { HiggsfieldSettings } from './HiggsfieldSettings'
import { Tabs } from './ui'
import { pickPlatform, showsPicker, type CreativePlatform } from './creativeHub'

/** One entry per platform. Adding a platform is one line here plus its settings component. */
const PLATFORMS: readonly (CreativePlatform & { Settings: () => React.JSX.Element })[] = [
  { id: 'higgsfield', label: 'Higgsfield', Settings: HiggsfieldSettings }
]

export function CreativeHubSettings(): React.JSX.Element {
  const { t } = useI18n()
  const [chosen, setChosen] = useState<string | null>(null)
  const current = pickPlatform(PLATFORMS, chosen)
  return (
    <div className="settings-stack">
      {showsPicker(PLATFORMS) ? (
        <Tabs
          variant="segmented"
          label={t('creativeHub.platforms')}
          value={current?.id ?? ''}
          onChange={setChosen}
          items={PLATFORMS.map((p) => ({ id: p.id, label: p.label }))}
        />
      ) : (
        current && <div className="settings-row"><span>{current.label}</span></div>
      )}
      {current && <current.Settings key={current.id} />}
    </div>
  )
}
