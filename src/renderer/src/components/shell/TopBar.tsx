// W9-B: the top bar's working half (DESIGN-W11 §8), inside the window's title bar: the project switcher, a hairline,
// the page tabs, then search, the usage meter with its accounts popover, New, and Settings. Pages move only through
// navigation.ts, so a page prompt that replaces its handler changes what these tabs do too.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Search, Settings } from 'lucide-react'
import { KEYED_PAGES, type PageId } from '../../../../core/ui/pages'
import { formatChord } from '../../../../core/keys/binding'
import type { MessageKey } from '../../../../core/i18n'
import { AccountPanel } from '../AccountPanel'
import { Button, IconButton, Kbd, Menu, Meter, Nav, type MenuItem, type NavItem } from '../ui'
import { openPage } from './navigation'
import { ProjectSwitcher } from './ProjectSwitcher'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'

const PAGE_LABEL: Record<PageId, MessageKey> = {
  agents: 'shell.page.agents',
  tasks: 'pages.tasks.title',
  plans: 'pages.plans.title',
  inbox: 'shell.page.inbox',
  worktrees: 'worktrees.title',
  files: 'shell.page.files',
  settings: 'settings.title',
  'more:history': 'history.panel.title',
  'more:hiw': 'hiw.title',
  'more:browser': 'shell.page.browser',
  'more:runs': 'shell.page.runs'
}
const MORE_PAGES = ['more:history', 'more:hiw', 'more:browser', 'more:runs'] as const

export type TopBarProps = Pick<
  AppState,
  'accounts' | 'bindingsRef' | 'openWorkspaceProject' | 'page' | 'projectAnchor' | 'sessions' | 'setProjectDialog' | 't' |
  'workspaceIds' | 'workspaceProjectId' | 'workspaceTree'
> &
  Pick<ShellState, 'attention' | 'counts' | 'shellAccount' | 'shellUsage'> & {
    /** Opens the search and command box (W9-D). */
    onSearch: () => void
    /** Opens New (W9-E). */
    onNew: () => void
    newDisabled: boolean
  }

export function TopBar(p: TopBarProps): React.JSX.Element {
  const { page, t } = p
  const navItems: NavItem<PageId>[] = KEYED_PAGES.map((id, i) => ({
    id,
    label: <span title={`Ctrl+${i + 1}`}>{t(PAGE_LABEL[id])}</span>,
    ...(id === 'inbox' && p.counts.waiting > 0 ? { count: p.counts.waiting } : {})
  }))
  const menuOf = (ids: readonly PageId[]): MenuItem[] => ids.map((id) => ({ id, label: t(PAGE_LABEL[id]), onSelect: () => openPage(id) }))
  const onMore = page.startsWith('more:')
  const searchChord = p.bindingsRef.current['command.open']?.[0]
  const fiveHour = p.shellUsage?.session?.usedPercent
  return (
    <div className="tb-main" onDoubleClick={(e) => e.stopPropagation()}>
      <ProjectSwitcher
        tree={p.workspaceTree}
        byWorkspace={p.workspaceIds}
        sessions={p.sessions}
        attention={p.attention}
        selectedId={p.workspaceProjectId}
        onSelect={p.openWorkspaceProject}
        onNew={() => p.setProjectDialog('new')}
        onAdd={() => p.setProjectDialog('add')}
        onSettings={(id) => p.setProjectDialog({ settings: id })}
        onOpenWindow={(id) => window.api.win.openNew(id)} // W9-K
        toolsDisabledReason={p.projectAnchor ? undefined : t('settings.projects.noAnchor')}
        t={t}
      />
      <span className="tb-divider" aria-hidden="true" />
      <div className="tb-pages">
        <Nav label={t('shell.pages')} items={navItems} current={page} onSelect={openPage} />
        <span className={onMore ? 'tb-more tb-more--active' : 'tb-more'}>
          <Menu
            label={t('shell.morePages')}
            items={menuOf(MORE_PAGES)}
            trigger={{ variant: 'ghost', size: 'sm', children: <>{onMore ? t(PAGE_LABEL[page]) : t('shell.more')} <ChevronDown size={12} aria-hidden="true" /></> }}
          />
        </span>
      </div>
      {/* Below 1024px the tabs fold into one menu (shell.css shows one of the two) */}
      <span className="tb-pages-narrow">
        <Menu
          label={t('shell.pages')}
          items={menuOf([...KEYED_PAGES, ...MORE_PAGES]).map((it) =>
            it.id === 'inbox' && p.counts.waiting > 0 ? { ...it, label: t('shell.inboxCount', { n: p.counts.waiting }) } : it
          )}
          trigger={{ variant: 'ghost', size: 'sm', children: <>{t(PAGE_LABEL[page])} <ChevronDown size={12} aria-hidden="true" /></> }}
        />
      </span>
      <span className="tb-spacer" />
      <button type="button" className="tb-search" onClick={p.onSearch}>
        <Search size={14} aria-hidden="true" />
        <span>{t('shell.search')}</span>
        {searchChord && <Kbd>{formatChord(searchChord)}</Kbd>}
      </button>
      <UsageButton t={t} accounts={p.accounts} label={p.shellAccount?.label} percent={fiveHour} />
      <Button variant="primary" size="sm" icon={<Plus size={14} aria-hidden="true" />} disabled={p.newDisabled} onClick={p.onNew}>
        {t('new.title')}
      </Button>
      <IconButton label={t('settings.title')} icon={<Settings size={16} />} active={page === 'settings'} onClick={() => openPage('settings')} />
    </div>
  )
}

/** The usage Meter (the shown account's 5-hour window); it opens the accounts popover, whose rows carry the W7-F
 *  sign-in and remove actions (AccountPanel). */
function UsageButton({ accounts, label, percent, t }: { accounts: AppState['accounts']; label?: string; percent?: number; t: AppState['t'] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const has = typeof percent === 'number'
  return (
    <div className="tb-usage" ref={root}>
      <button
        type="button"
        className="tb-usage-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={has ? t('shell.usage.title', { label: label ?? '', percent: Math.round(percent) }) : t('settings.group.accounts')}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tb-usage-label">{label ? t('shell.usage.head', { label }) : t('shell.usage.headNone')}</span>
        <Meter value={has ? percent : 0} className="tb-meter" />
        <span className="tb-usage-pct">{has ? `${Math.round(percent)}%` : '–'}</span>
      </button>
      {open && (
        <div className="tb-popover" role="dialog" aria-label={t('settings.tab.accounts')}>
          <AccountPanel accounts={accounts} />
        </div>
      )}
    </div>
  )
}
