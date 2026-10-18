// W9-B: the top bar's working half (DESIGN.md §1), inside the window's title bar: "/" the project switcher, the page
// tabs, then search, New, the usage meter with its accounts popover, and Settings. Pages move only through
// navigation.ts, so a page prompt that replaces its handler changes what these tabs do too.
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Plus, Search, Settings } from 'lucide-react'
import { KEYED_PAGES, type PageId } from '../../../../core/ui/pages'
import { formatChord } from '../../../../core/keys/binding'
import { AccountPanel } from '../AccountPanel'
import { Button, Menu, Meter, Nav, type MenuItem, type NavItem } from '../ui'
import { openPage } from './navigation'
import { ProjectSwitcher } from './ProjectSwitcher'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'

const PAGE_LABEL: Record<PageId, string> = {
  agents: 'Agents',
  tasks: 'Tasks',
  plans: 'Plans',
  inbox: 'Inbox',
  worktrees: 'Worktrees',
  files: 'Files',
  settings: 'Settings',
  'more:history': 'History',
  'more:hiw': 'How It Works',
  'more:browser': 'Browser',
  'more:runs': 'Run configs'
}
const MORE_PAGES = ['more:history', 'more:hiw', 'more:browser', 'more:runs'] as const

export type TopBarProps = Pick<
  AppState,
  'accounts' | 'bindingsRef' | 'openWorkspaceProject' | 'page' | 'projectAnchor' | 'sessions' | 'setProjectDialog' |
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
  const { page } = p
  const navItems: NavItem<PageId>[] = KEYED_PAGES.map((id, i) => ({
    id,
    label: <span title={`Ctrl+${i + 1}`}>{PAGE_LABEL[id]}</span>,
    ...(id === 'inbox' && p.counts.waiting > 0 ? { count: p.counts.waiting } : {})
  }))
  const menuOf = (ids: readonly PageId[]): MenuItem[] => ids.map((id) => ({ id, label: PAGE_LABEL[id], onSelect: () => openPage(id) }))
  const onMore = page.startsWith('more:')
  const searchChord = p.bindingsRef.current['command.open']?.[0]
  const fiveHour = p.shellUsage?.session?.usedPercent
  return (
    <div className="tb-main" onDoubleClick={(e) => e.stopPropagation()}>
      <span className="tb-slash" aria-hidden="true">
        /
      </span>
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
        toolsDisabledReason={p.projectAnchor ? undefined : 'Open a tab first'}
      />
      <div className="tb-pages">
        <Nav label="Pages" items={navItems} current={page} onSelect={openPage} />
        <span className={onMore ? 'tb-more tb-more--active' : 'tb-more'}>
          <Menu
            label="More pages"
            items={menuOf(MORE_PAGES)}
            trigger={{ variant: 'ghost', size: 'sm', children: <>{onMore ? PAGE_LABEL[page] : 'More'} <ChevronDown size={12} aria-hidden="true" /></> }}
          />
        </span>
      </div>
      {/* Below 1024px the tabs fold into one menu (shell.css shows one of the two) */}
      <span className="tb-pages-narrow">
        <Menu
          label="Pages"
          items={menuOf([...KEYED_PAGES, ...MORE_PAGES]).map((it) =>
            it.id === 'inbox' && p.counts.waiting > 0 ? { ...it, label: `Inbox (${p.counts.waiting})` } : it
          )}
          trigger={{ variant: 'ghost', size: 'sm', children: <>{PAGE_LABEL[page]} <ChevronDown size={12} aria-hidden="true" /></> }}
        />
      </span>
      <span className="tb-spacer" />
      <button type="button" className="tb-search" onClick={p.onSearch}>
        <Search size={14} aria-hidden="true" />
        <span>Search or command</span>
        {searchChord && <kbd>{formatChord(searchChord)}</kbd>}
      </button>
      <Button variant="primary" size="sm" icon={<Plus size={12} aria-hidden="true" />} disabled={p.newDisabled} onClick={p.onNew}>
        New
      </Button>
      <span className="tb-divider" aria-hidden="true" />
      <UsageButton accounts={p.accounts} label={p.shellAccount?.label} percent={fiveHour} />
      <Button aria-label="Settings" title="Settings" icon={<Settings size={16} />} onClick={() => openPage('settings')} />
    </div>
  )
}

/** The usage Meter (the shown account's 5-hour window); it opens the accounts popover, whose rows carry the W7-F
 *  sign-in and remove actions (AccountPanel). */
function UsageButton({ accounts, label, percent }: { accounts: AppState['accounts']; label?: string; percent?: number }): React.JSX.Element {
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
        title={has ? `${label ?? ''} · 5-hour window ${Math.round(percent)}%` : 'Accounts and usage'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tb-usage-head">
          <span>{label ? `${label} · 5h` : '5h'}</span>
          <span>{has ? `${Math.round(percent)}%` : '–'}</span>
        </span>
        <Meter value={has ? percent : 0} className="tb-meter" />
      </button>
      {open && (
        <div className="tb-popover" role="dialog" aria-label="Accounts">
          <AccountPanel accounts={accounts} />
        </div>
      )}
    </div>
  )
}
