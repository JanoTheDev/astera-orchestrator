// Settings as an editor tab (DESIGN-W13 §12): a search field and the "Show advanced" switch on top, a table of contents
// on the left that scrolls the right side, every visible group stacked under its heading. openSettings(group, anchor)
// scrolls to the row and briefly highlights it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, ICONS, Icon, Input, Switch, Tree, type IconName, type TreeItem } from '../ui'
import { useAdvancedMode } from '../../state/useAdvancedMode'
import type { SettingsDialogProps } from '../shell/SettingsDialog'
import { GROUP_LABEL, SETTINGS_GROUPS, SETTINGS_ROWS, filterSettings, groupsShown, type SettingsGroupId } from './settingsIndex'
import { anchorRevealGroup } from './settingsAnchor'
import { ShowAdvancedContext, type GroupProps } from './SettingRow'
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

/** How long a row openSettings landed on stays highlighted. */
const FLASH_MS = 1600

export function SettingsPage(p: SettingsDialogProps & { onClose: () => void }): React.JSX.Element {
  const { settingsTab, setSettingsTab, settingsAnchor, setSettingsAnchor, t } = p
  const [query, setQuery] = useState('')
  const [advanced, setAdvanced] = useAdvancedMode()
  // The groups an openSettings anchor revealed this visit: their advanced rows show, Advanced mode stays off.
  const [revealed, setRevealed] = useState<ReadonlySet<SettingsGroupId>>(new Set())
  const content = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => (query.trim() ? filterSettings(SETTINGS_ROWS, query, t) : null), [query, t])
  const only = useMemo(() => (hits ? new Set(hits.map((h) => h.anchor)) : null), [hits])
  const visible = useMemo(() => {
    const shown = groupsShown(advanced, only)
    if (only === null) revealed.forEach((g) => shown.add(g))
    return shown
  }, [advanced, only, revealed])

  const scrollToGroup = (g: SettingsGroupId): void => {
    content.current?.querySelector<HTMLElement>(`[data-group="${g}"]`)?.scrollIntoView({ block: 'start' })
  }

  // The TOC follows the scroll: the group whose heading passed the top is the current one.
  useEffect(() => {
    const el = content.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        const g = top?.target.getAttribute('data-group')
        if (g) setSettingsTab(g as SettingsGroupId)
      },
      { root: el, rootMargin: '0px 0px -75% 0px' }
    )
    el.querySelectorAll('[data-group]').forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [visible, setSettingsTab])

  // openSettings(group, anchor): the search would hide the row, so it is cleared first; an advanced row's group is
  // revealed for this visit (Advanced mode stays as it is); the scroll waits a frame for the rows to render. A bare
  // group scrolls to its heading.
  useEffect(() => {
    if (!settingsAnchor) return
    setQuery('')
    const reveal = anchorRevealGroup(settingsAnchor)
    if (reveal) setRevealed((prev) => new Set(prev).add(reveal))
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
  }, [settingsAnchor, setSettingsAnchor])

  const toc: TreeItem[] = SETTINGS_GROUPS.filter((g) => visible.has(g)).map((g) => ({
    id: g,
    depth: 0,
    label: t(GROUP_LABEL[g]),
    icon: <Icon name={GROUP_ICON[g]} size={16} />
  }))

  return (
    <div className="settings-editor" role="region" aria-label={t('settings.title')}>
      <div className="settings-editor__head">
        <label className="settings-page__search">
          <Icon name="search" size={14} />
          <Input
            type="search"
            value={query}
            placeholder={t('settings.search.placeholder')}
            aria-label={t('settings.search.placeholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                setQuery('')
              }
            }}
          />
        </label>
        <label className="settings-editor__advanced">
          <Switch checked={advanced} onChange={setAdvanced} aria-label={t('settings.basic.showAdvanced')} />
          <span>{t('settings.basic.showAdvanced')}</span>
        </label>
      </div>
      <div className="settings-editor__body">
        <nav className="settings-editor__toc" aria-label={t('settings.title')}>
          <Tree
            label={t('settings.title')}
            rows={toc}
            selectedId={settingsTab}
            onSelect={(id) => {
              setSettingsTab(id as SettingsGroupId)
              scrollToGroup(id as SettingsGroupId)
            }}
          />
        </nav>
        <div ref={content} className="settings-content settings-editor__content">
          {hits && hits.length === 0 && (
            <EmptyState icon={ICONS.search} title={t('settings.search.emptyTitle')}>
              {t('settings.search.empty', { query: query.trim() })}
            </EmptyState>
          )}
          {/* Every group keeps its place in the tree, shown or not, so Integrations' Slack row is never remounted. */}
          {SETTINGS_GROUPS.map((g) => {
            const shown = visible.has(g)
            const View = GROUP_VIEW[g]
            return (
              <section key={g} className="settings-editor__group" data-group={g} hidden={!shown}>
                {shown && <h2 className="settings-editor__group-label">{t(GROUP_LABEL[g])}</h2>}
                <ShowAdvancedContext.Provider value={advanced || only !== null || revealed.has(g)}>
                  <View {...p} shown={shown} only={only} />
                </ShowAdvancedContext.Provider>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
