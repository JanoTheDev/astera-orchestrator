// W9-E: the Settings page (DESIGN §2 "Settings", §7): groups on the left with a search field, the group's rows on the
// right. W11 (DESIGN-W11 §9): PageHeader with Back as leading, a 200px icon nav, the content at 720px in cards. A search shows every matching row under its group's label. openSettings(group, anchor) scrolls to the row
// and briefly highlights it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, EmptyState, ICONS, Icon, Input, PageHeader, type IconName } from '../ui'
import { useAdvancedMode } from '../../state/useAdvancedMode'
import type { SettingsDialogProps } from '../shell/SettingsDialog'
import { GROUP_LABEL, SETTINGS_GROUPS, SETTINGS_ROWS, filterSettings, groupHasBasic, type SettingsGroupId } from './settingsIndex'
import { ShowAdvancedContext, arrowFocus, type GroupProps } from './SettingRow'
import { GeneralSettings } from './GeneralSettings'
import { AccountsUsageSettings } from './AccountsUsageSettings'
import { AgentsSettings } from './AgentsSettings'
import { ProjectsSettings } from './ProjectsSettings'
import { IntegrationsSettings } from './IntegrationsSettings'
import { NotificationsSettings } from './NotificationsSettings'
import { AdvancedSettings } from './AdvancedSettings'
import { AboutSettings } from './AboutSettings'
import './settingsPage.css'

const GROUP_VIEW: Record<SettingsGroupId, (p: GroupProps) => React.JSX.Element | null> = {
  general: GeneralSettings,
  accounts: AccountsUsageSettings,
  agents: AgentsSettings,
  projects: ProjectsSettings,
  integrations: IntegrationsSettings,
  notifications: NotificationsSettings,
  advanced: AdvancedSettings,
  about: AboutSettings
}

const GROUP_ICON: Record<SettingsGroupId, IconName> = {
  general: 'filter',
  accounts: 'users',
  agents: 'agent',
  projects: 'projects',
  integrations: 'integrations',
  notifications: 'notifications',
  advanced: 'advanced',
  about: 'info'
}

function GroupIcon({ g }: { g: SettingsGroupId }): React.JSX.Element {
  return <Icon name={GROUP_ICON[g]} />
}

/** Up/Down/Home/End move focus between the side nav's group buttons (one Tab stop each, in order). */
const navKeyDown = arrowFocus('.settings-nav-item')

/** How long a row openSettings landed on stays highlighted. */
const FLASH_MS = 1600

export function SettingsPage(p: SettingsDialogProps & { onClose: () => void }): React.JSX.Element {
  const { settingsTab, setSettingsTab, settingsAnchor, setSettingsAnchor, t, onClose } = p
  const [query, setQuery] = useState('')
  const [advanced] = useAdvancedMode()
  // T19: the groups whose "Show advanced settings" link was pressed (simple mode only)
  const [revealed, setRevealed] = useState<ReadonlySet<SettingsGroupId>>(new Set())
  const reveal = (g: SettingsGroupId, on = true): void =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (on) next.add(g)
      else next.delete(g)
      return next
    })
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
    // an advanced row would not be drawn, so its group opens first
    const target = SETTINGS_ROWS.find((r) => r.anchor === settingsAnchor)
    if (target?.level === 'advanced') reveal(target.group)
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
    <div
      ref={root}
      className="settings-page"
      role="region"
      aria-label={t('settings.title')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <PageHeader
        className="settings-page__head"
        title={t('settings.title')}
        leading={
          <Button variant="ghost" size="sm" icon={<Icon name="back" size={14} />} onClick={onClose}>
            {t('settings.back')}
          </Button>
        }
      />
      <div className="settings-page__body">
        <nav className="settings-page__nav" aria-label={t('settings.title')} onKeyDown={navKeyDown}>
          <label className="settings-page__search">
            <Icon name="search" size={14} />
            <Input
              type="search"
              value={query}
              placeholder={t('settings.search.placeholder')}
              aria-label={t('settings.search.placeholder')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {SETTINGS_GROUPS.filter((g) => advanced || groupHasBasic(g) || revealed.has(g) || settingsTab === g).map((g) => {
            return (
              <Button
                key={g}
                variant="ghost"
                icon={<GroupIcon g={g} />}
                className={`settings-nav-item ${!hits && settingsTab === g ? 'active' : ''} ${hits && !hitGroups.has(g) ? 'settings-nav-item--none' : ''}`}
                aria-current={!hits && settingsTab === g ? 'page' : undefined}
                onClick={() => {
                  setQuery('')
                  setSettingsTab(g)
                }}
              >
                {t(GROUP_LABEL[g])}
              </Button>
            )
          })}
        </nav>
        <div ref={content} className="settings-content settings-page__content">
          {hits && hits.length === 0 && (
            <EmptyState icon={ICONS.search} title={t('settings.search.emptyTitle')}>
              {t('settings.search.empty', { query: query.trim() })}
            </EmptyState>
          )}
          {/* Every group keeps its place in the tree, shown or not, so Integrations' Slack row is never remounted. */}
          {SETTINGS_GROUPS.map((g) => {
            const shown = hits ? hitGroups.has(g) : settingsTab === g
            const View = GROUP_VIEW[g]
            const showAdvanced = advanced || revealed.has(g)
            return (
              <section key={g} className="settings-page__group" hidden={!shown}>
                {shown && <h2 className="settings-page__group-label">{t(GROUP_LABEL[g])}</h2>}
                <ShowAdvancedContext.Provider value={showAdvanced}>
                  <View {...p} shown={shown} only={only} />
                </ShowAdvancedContext.Provider>
                {shown && !advanced && !hits && (
                  <Button variant="ghost" size="sm" className="settings-page__more" onClick={() => reveal(g, !revealed.has(g))}>
                    {t(revealed.has(g) ? 'settings.basic.hideAdvanced' : 'settings.basic.showAdvanced')}
                  </Button>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
