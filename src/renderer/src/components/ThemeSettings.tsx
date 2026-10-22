import { THEME_IDS, themeById, type ThemeId } from '../../../core/theme/themes'
import { useTheme } from '../lib/theme'
import { useI18n } from '../i18n/I18nProvider'
import { toast } from '../lib/toast'
import { useRef } from 'react'
import { Card, Icon } from './ui'
import { arrowFocus } from './settings/SettingRow'
import { createLatest } from '../lib/latest'

/** 테마는 색을 보고 고르는 것이라 드롭다운이 아니라 카드다. 각 카드가 자기 팔레트로 작은 미리보기를
 *  그린다 — 표면 세 층과 액센트, 그리고 그 테마의 서체. */
export function ThemeSettings(): React.JSX.Element {
  const { themeId, setThemeId } = useTheme()
  const { t } = useI18n()

  const latest = useRef(createLatest())
  const pick = (id: ThemeId): void => {
    const prev = themeId
    const ticket = latest.current.next()
    setThemeId(id) // 낙관적 — 즉시 보인다
    void window.api.settings.setTheme(id).catch((err) => {
      // Put back only when no later pick came (audit UI-14): reverting an older pick undid the newer one on screen.
      if (latest.current.isCurrent(ticket)) setThemeId(prev)
      toast.error(
        t('settings.theme.saveFailed', {
          detail: err instanceof Error ? err.message : String(err)
        })
      )
    })
  }

  return (
    <div className="settings-theme">
      <div className="settings-theme-head">
        <span className="settings-card-title">{t('settings.theme.label')}</span>
        <span className="settings-hint">{t('settings.theme.hint')}</span>
      </div>
      <div className="theme-grid" role="group" aria-label={t('settings.theme.label')} onKeyDown={arrowFocus('.theme-card', 'horizontal')}>
        {THEME_IDS.map((id) => {
          const th = themeById(id)
          // System previews both halves: night on the left, day on the right.
          const day = themeById('day')
          const on = id === themeId
          return (
            <Card
              key={id}
              className={`theme-card${on ? ' on' : ''}`}
              aria-pressed={on}
              onClick={() => pick(id)}
              style={{
                // 카드는 자기 테마의 값으로 그린다 — 앱 테마를 따라가면 미리보기가 아니다
                background:
                  id === 'system' ? `linear-gradient(90deg, ${th.colors.bg} 50%, ${day.colors.bg} 50%)` : th.colors.bg,
                borderColor: th.colors.line,
                color: th.colors.text
              }}
            >
              <span className="theme-card-bars" aria-hidden="true">
                <i style={{ background: th.colors.panel }} />
                <i style={{ background: th.colors.elevated }} />
                <i style={{ background: th.colors.accent }} />
                {id === 'system' && <i style={{ background: day.colors.accent }} />}
              </span>
              <span className="theme-card-name">
                {id === 'system' ? t('settings.theme.system') : th.name}
                {on && <Icon name="check" size={14} />}
              </span>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
