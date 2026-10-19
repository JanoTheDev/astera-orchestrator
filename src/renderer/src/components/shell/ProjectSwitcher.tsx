// W6-F project switcher, as the top bar's text button (W9-B, DESIGN.md §1): "<project> ⇅" opens a menu with every
// project's running tabs, a dot while one waits for the owner, its Ctrl+Alt+N key, and the W7-B project tools.
import { ArrowUpDown } from 'lucide-react'
import type { Attention, SessionInfo } from '../../../../core/types'
import { OTHER_WORKSPACE, workspaceSummaries, type WorkspaceProject } from '../../state/workspaceTree'
import { switcherName } from '../../state/projectScope'
import * as sticky from '../../lib/stickyProject'
import { Menu, type MenuItem } from '../ui'
import type { Translate } from '../checkText'

export interface SwitcherProps {
  tree: WorkspaceProject[]
  /** workspaceSessionIds: each workspace's session ids. */
  byWorkspace: ReadonlyMap<string, ReadonlySet<string>>
  sessions: SessionInfo[]
  attention: Readonly<Record<string, Attention>>
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** W7-B: new / add project and a project's settings. */
  onNew: () => void
  onAdd: () => void
  onSettings: (id: string) => void
  /** W9-K: opens the project in a window of its own (or focuses the one it has). */
  onOpenWindow?: (id: string) => void
  /** Why the project tools are off (no tab open to anchor the commands), or undefined. */
  toolsDisabledReason?: string
  t: Translate
}

/** The menu's rows: All tabs, each project (its key on the first nine), then the project tools. */
export function switcherItems(p: SwitcherProps): MenuItem[] {
  const rows = workspaceSummaries(p.tree, p.byWorkspace, p.sessions, p.attention)
  const tools = p.toolsDisabledReason !== undefined
  const { t } = p
  return [
    { id: 'all', label: <span className="tb-sw-row">{t('shell.switcher.allTabs')}</span>, onSelect: () => p.onSelect(null) },
    ...rows.map((r, i): MenuItem => ({
      id: r.id,
      label: (
        <span className={`tb-sw-row${r.id === p.selectedId ? ' tb-sw-selected' : ''}`}>
          <span className={`tb-sw-dot${r.waiting ? ' tb-sw-waiting' : ''}`} aria-label={r.waiting ? t('shell.switcher.needsInput') : undefined} />
          <span className="tb-sw-name">{r.id === OTHER_WORKSPACE ? t('shell.switcher.other') : r.name}</span>
          <span className="tb-sw-count" aria-label={t('shell.switcher.running', { n: r.running })}>
            {r.running}
          </span>
          {i < 9 && <kbd className="tb-sw-key">Ctrl+Alt+{i + 1}</kbd>}
        </span>
      ),
      onSelect: () => p.onSelect(r.id)
    })),
    // W9-K: each project opens in a window of its own; "Other" is no project and gets none
    ...(p.onOpenWindow
      ? rows
          .filter((r) => r.id !== OTHER_WORKSPACE)
          .map((r): MenuItem => ({ id: `window:${r.id}`, label: t('shell.switcher.openWindow', { name: r.name }), onSelect: () => p.onOpenWindow?.(r.id) }))
      : []),
    // W7-B: the project's settings page; "Other" is no project
    ...rows
      .filter((r) => r.id !== OTHER_WORKSPACE)
      .map((r): MenuItem => ({ id: `settings:${r.id}`, label: t('shell.switcher.settings', { name: r.name }), disabled: tools, onSelect: () => p.onSettings(r.id) })),
    { id: 'new', label: t('shell.switcher.new'), disabled: tools, onSelect: p.onNew },
    { id: 'add', label: t('settings.projects.add'), disabled: tools, onSelect: p.onAdd }
  ]
}

export function ProjectSwitcher(p: SwitcherProps): React.JSX.Element {
  const { t } = p
  const label = switcherName(p.selectedId, p.tree, p.selectedId ? sticky.readName(p.selectedId) : null)
  const name = label.kind === 'all' ? t('wall.scope.all') : label.kind === 'other' ? t('shell.switcher.other') : label.kind === 'name' ? label.name : t('shell.switcher.label')
  const waiting = workspaceSummaries(p.tree, p.byWorkspace, p.sessions, p.attention).some((r) => r.waiting)
  return (
    <Menu
      label={t('shell.switcher.label')}
      items={switcherItems(p)}
      trigger={{
        variant: 'ghost',
        size: 'sm',
        className: 'tb-switcher',
        title: p.toolsDisabledReason,
        children: (
          <>
            {name}
            {waiting && <span className="tb-sw-dot tb-sw-waiting" aria-label={t('shell.switcher.waiting')} />}
            <ArrowUpDown size={12} aria-hidden="true" />
          </>
        )
      }}
    />
  )
}
