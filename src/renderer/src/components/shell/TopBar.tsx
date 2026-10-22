// W9-B: the top bar's working half (DESIGN-W11 §8), inside the window's title bar: the project switcher, a hairline,
// the page tabs, then search, the bell, the usage meter with its accounts popover, New, and Settings. T9: three tabs
// (Home, Plans, Files) and a More menu; All tasks is a view inside Plans and the Inbox sits behind the bell. Pages move
// only through navigation.ts, so a page prompt that replaces its handler changes what these tabs do too.
import { useState } from 'react'
import { KEYED_PAGES, MORE_MENU_PAGES, TAB_PAGES, tabOf, type PageId } from '../../../../core/ui/pages'
import { formatChord } from '../../../../core/keys/binding'
import type { MessageKey } from '../../../../core/i18n'
import { AccountPanel } from '../AccountPanel'
import { Button, Icon, IconButton, Kbd, Menu, Meter, Nav, Popover, type IconName, type MenuItem, type NavItem } from '../ui'
import { useAdvancedMode } from '../../state/useAdvancedMode'
import { openPage } from './navigation'
import { NotificationBell } from './NotificationBell'
import { ProjectSwitcher } from './ProjectSwitcher'
import type { AppState } from '../../state/appState'
import type { ShellState } from './useShell'

const PAGE_LABEL: Record<PageId, MessageKey> = {
  agents: 'shell.tab.home',
  tasks: 'shell.plans.viewTasks',
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
type MorePage = (typeof MORE_MENU_PAGES)[number]
/** Each More item's icon and its one-sentence "what is this" (also its tooltip). */
const MORE_ITEM: Record<MorePage, [IconName, MessageKey]> = {
  worktrees: ['repo', 'shell.moreDesc.worktrees'],
  'more:history': ['history', 'shell.moreDesc.history'],
  'more:runs': ['run', 'shell.moreDesc.runs'],
  'more:hiw': ['info', 'shell.moreDesc.hiw'],
  'more:browser': ['web', 'shell.moreDesc.browser']
}

/** T19: what the More menu lists in simple mode; Runs, How it works and Browser need Advanced mode. */
export const SIMPLE_MORE_PAGES: readonly MorePage[] = ['worktrees', 'more:history']

/** The More menu's rows: icon, plain name, one line saying what it is. */
export function moreItems(t: AppState['t'], advanced = true): MenuItem[] {
  return MORE_MENU_PAGES.filter((id) => advanced || SIMPLE_MORE_PAGES.includes(id)).map((id) => {
    const [glyph, desc] = MORE_ITEM[id]
    return {
      id,
      icon: <Icon name={glyph} />,
      label: (
        <span className="tb-more-item" title={t(desc)}>
          <span>{t(PAGE_LABEL[id])}</span>
          <span className="tb-more-desc">{t(desc)}</span>
        </span>
      ),
      onSelect: () => openPage(id)
    }
  })
}

export type TopBarProps = Pick<
  AppState,
  'accounts' | 'actionUi' | 'bindingsRef' | 'openWorkspaceProject' | 'page' | 'projectAnchor' | 'sessions' | 'setProjectDialog' | 'scopedData' | 'scopedTree' | 't' |
  'workspaceData' | 'workspaceIds' | 'workspaceProjectId' | 'workspaceTree'
> &
  Pick<ShellState, 'attention' | 'shellAccount' | 'shellUsage'> & {
    /** Opens the search and command box (W9-D). */
    onSearch: () => void
    /** Opens New (W9-E). */
    onNew: () => void
    newDisabled: boolean
  }

export function TopBar(p: TopBarProps): React.JSX.Element {
  const { page, t } = p
  const tab = tabOf(page)
  const [advanced] = useAdvancedMode()
  const navItems: NavItem<PageId>[] = TAB_PAGES.map((id) => ({
    id,
    label: <span title={`Ctrl+${KEYED_PAGES.indexOf(id) + 1}`}>{t(PAGE_LABEL[id])}</span>
  }))
  const onMore = (MORE_MENU_PAGES as readonly PageId[]).includes(page)
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
        {/* no tab lit on the Inbox, Settings or a More page: Nav's current is then a page none of its items is */}
        <Nav label={t('shell.pages')} items={navItems} current={tab ?? page} onSelect={openPage} />
        <span className={onMore ? 'tb-more tb-more--active' : 'tb-more'}>
          <Menu
            label={t('shell.morePages')}
            items={moreItems(t, advanced)}
            trigger={{ variant: 'ghost', size: 'sm', children: <>{onMore ? t(PAGE_LABEL[page]) : t('shell.more')} <Icon name="chevronDown" size={14} /></> }}
          />
        </span>
      </div>
      {/* Below 1024px the tabs fold into one menu (shell.css shows one of the two) */}
      <span className="tb-pages-narrow">
        <Menu
          label={t('shell.pages')}
          items={[...TAB_PAGES.map((id) => ({ id, label: t(PAGE_LABEL[id]), onSelect: () => openPage(id) })), 'separator', ...moreItems(t, advanced)]}
          trigger={{ variant: 'ghost', size: 'sm', children: <>{t(PAGE_LABEL[tab ?? page])} <Icon name="chevronDown" size={14} /></> }}
        />
      </span>
      <span className="tb-spacer" />
      <Button variant="ghost" size="sm" className="tb-search" icon={<Icon name="search" size={14} />} onClick={p.onSearch}>
        <span className="tb-search-text">{t('shell.search')}</span>
        {searchChord && <Kbd>{formatChord(searchChord)}</Kbd>}
      </Button>
      <NotificationBell {...p} />
      <UsageButton t={t} accounts={p.accounts} label={p.shellAccount?.label} percent={fiveHour} />
      <Button variant="primary" size="sm" icon={<Icon name="add" size={14} />} disabled={p.newDisabled} onClick={p.onNew}>
        {t('new.title')}
      </Button>
      <IconButton label={t('settings.title')} icon={<Icon name="settings" />} active={page === 'settings'} onClick={() => openPage('settings')} />
    </div>
  )
}

/** The usage Meter (the shown account's 5-hour window); it opens the accounts popover, whose rows carry the W7-F
 *  sign-in and remove actions (AccountPanel). */
function UsageButton({ accounts, label, percent, t }: { accounts: AppState['accounts']; label?: string; percent?: number; t: AppState['t'] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const has = typeof percent === 'number'
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t('settings.tab.accounts')}
      className="tb-usage"
      panelClassName="tb-popover"
      trigger={(tp) => (
        <Button
          variant="ghost"
          size="sm"
          className="tb-usage-btn"
          {...tp}
          title={has ? t('shell.usage.title', { label: label ?? '', percent: Math.round(percent) }) : t('settings.group.accounts')}
        >
          <span className="tb-usage-label">{label ? t('shell.usage.head', { label }) : t('shell.usage.headNone')}</span>
          <Meter value={has ? percent : 0} className="tb-meter" />
          <span className="tb-usage-pct">{has ? `${Math.round(percent)}%` : '–'}</span>
        </Button>
      )}
    >
      <AccountPanel accounts={accounts} />
    </Popover>
  )
}
