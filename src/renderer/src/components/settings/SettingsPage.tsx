// W9-E: the Settings page (DESIGN §2 "Settings", §7): groups on the left with a search field, the group's rows on the
// right. A search shows every matching row under its group's label. openSettings(group, anchor) scrolls to the row
// and briefly highlights it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { Button, EmptyState } from '../ui'
import type { SettingsDialogProps } from '../shell/SettingsDialog'
import { GROUP_LABEL, SETTINGS_GROUPS, SETTINGS_ROWS, filterSettings, type SettingsGroupId } from './settingsIndex'
import type { GroupProps } from './SettingRow'
import { GeneralSettings } from './GeneralSettings'
import { AccountsUsageSettings } from './AccountsUsageSettings'
import { AgentsSettings } from './AgentsSettings'
import { ProjectsSettings } from './ProjectsSettings'
import { IntegrationsSettings } from './IntegrationsSettings'
import { NotificationsSettings } from './NotificationsSettings'
import { AdvancedSettings } from './AdvancedSettings'
import './settingsPage.css'

const GROUP_VIEW: Record<SettingsGroupId, (p: GroupProps) => React.JSX.Element | null> = {
  general: GeneralSettings,
  accounts: AccountsUsageSettings,
  agents: AgentsSettings,
  projects: ProjectsSettings,
  integrations: IntegrationsSettings,
  notifications: NotificationsSettings,
  advanced: AdvancedSettings
}

/** How long a row openSettings landed on stays highlighted. */
const FLASH_MS = 1600

export function SettingsPage(p: SettingsDialogProps & { onClose: () => void }): React.JSX.Element {
  const { settingsTab, setSettingsTab, settingsAnchor, setSettingsAnchor, t, onClose } = p
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => (query.trim() ? filterSettings(SETTINGS_ROWS, query, t) : null), [query, t])
  const only = useMemo(() => (hits ? new Set(hits.map((h) => h.anchor)) : null), [hits])
  const hitGroups = useMemo(() => new Set(hits?.map((h) => h.group)), [hits])

  // Focus comes in for Esc, and goes back to where it was when the page closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    root.current?.focus()
    return () => opener?.focus()
  }, [])

  // openSettings(group, anchor): the search would hide the row, so it is cleared first; the scroll waits a frame for
  // the group to render.
  useEffect(() => {
    if (!settingsAnchor) return
    setQuery('')
    let timer: ReturnType<typeof setTimeout> | undefined
    const frame = requestAnimationFrame(() => {
      const row = content.current?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(settingsAnchor)}"]`)
      setSettingsAnchor(null)
      if (!row) return
      row.scrollIntoView({ block: 'start' })
      row.classList.add('settings-anchor--flash')
      timer = setTimeout(() => row.classList.remove('settings-anchor--flash'), FLASH_MS)
    })
    return () => {
      cancelAnimationFrame(frame)
      if (timer) clearTimeout(timer)
    }
  }, [settingsAnchor, settingsTab, setSettingsAnchor])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // A control that used Esc itself (an open Select, a search with text) has already said so.
    if (e.key !== 'Escape' || e.defaultPrevented) return
    e.preventDefault()
    if (query) setQuery('')
    else onClose()
  }

  return (
    <div ref={root} className="settings-page" role="region" aria-label={t('settings.title')} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="settings-page__head">
        <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} aria-hidden="true" />} onClick={onClose}>
          {t('settings.back')}
        </Button>
        <h2 className="settings-page__title">{t('settings.title')}</h2>
      </header>
      <div className="settings-page__body">
        <nav className="settings-page__nav" aria-label={t('settings.title')}>
          <label className="settings-page__search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={t('settings.search.placeholder')}
              aria-label={t('settings.search.placeholder')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {SETTINGS_GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              className={`settings-nav-item ${!hits && settingsTab === g ? 'active' : ''} ${hits && !hitGroups.has(g) ? 'settings-nav-item--none' : ''}`}
              aria-current={!hits && settingsTab === g ? 'page' : undefined}
              onClick={() => {
                setQuery('')
                setSettingsTab(g)
              }}
            >
              {t(GROUP_LABEL[g])}
            </button>
          ))}
        </nav>
        <div ref={content} className="settings-content settings-page__content">
          {hits && hits.length === 0 && <EmptyState icon={Search}>{t('settings.search.empty', { query: query.trim() })}</EmptyState>}
          {/* Every group keeps its place in the tree, shown or not, so Integrations' Slack row is never remounted. */}
          {SETTINGS_GROUPS.map((g) => {
            const shown = hits ? hitGroups.has(g) : settingsTab === g
            const View = GROUP_VIEW[g]
            return (
              <section key={g} className="settings-page__group" hidden={!shown}>
                {hits && shown && <h3 className="settings-page__group-label">{t(GROUP_LABEL[g])}</h3>}
                <View {...p} shown={shown} only={only} />
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
