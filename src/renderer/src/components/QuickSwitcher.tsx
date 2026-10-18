import { useMemo, useState } from 'react'
import { useI18n } from '../i18n/I18nProvider'
import { backdropProps } from '../lib/backdrop'
import { filterSwitcherTabs, type SwitcherTab } from '../lib/tabSwitcher'

/** W7-F (#84): the quick tab switcher (`tabs.switcher`, Ctrl+Shift+P). Type to filter by tab, plan or Task name
 *  (filterSwitcherTabs), arrows move, Enter selects, Esc closes. */
export function QuickSwitcher({
  tabs,
  activeTabId,
  onSelect,
  onClose
}: {
  tabs: SwitcherTab[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const shown = useMemo(() => filterSwitcherTabs(tabs, query), [tabs, query])
  const pick = (tab: SwitcherTab | undefined): void => {
    if (!tab) return
    onSelect(tab.tabId)
    onClose()
  }
  return (
    <div className="modal-backdrop" {...backdropProps(onClose)}>
      <div className="modal tab-switcher" role="dialog" aria-label={t('shortcut.tabs.switcher')} onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder={t('tabs.switcher.placeholder')}
          onChange={(e) => {
            setQuery(e.target.value)
            setAt(0)
          }}
          onKeyDown={(e) => {
            e.stopPropagation() // the app's own keys stay out of the filter
            if (e.key === 'Escape') onClose()
            else if (e.key === 'Enter') pick(shown[at])
            else if (e.key === 'ArrowDown') setAt((i) => Math.min(i + 1, shown.length - 1))
            else if (e.key === 'ArrowUp') setAt((i) => Math.max(i - 1, 0))
            else return
            e.preventDefault()
          }}
        />
        <ul className="tab-switcher-list" role="listbox">
          {shown.length === 0 && <li className="tab-switcher-empty">{t('tabs.switcher.empty')}</li>}
          {shown.map((tab, i) => (
            <li
              key={tab.tabId}
              role="option"
              aria-selected={i === at}
              className={`tab-switcher-row${i === at ? ' selected' : ''}${tab.tabId === activeTabId ? ' active' : ''}`}
              ref={i === at ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
              onMouseEnter={() => setAt(i)}
              onClick={() => pick(tab)}
            >
              <span className="tab-switcher-title">{tab.label ?? tab.title}</span>
              <span className="tab-switcher-meta">
                {[tab.label ? tab.title : '', tab.taskTitle, tab.planName, tab.projectName].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
