// W6-F project switcher, as the top bar's text button (W9-B, DESIGN.md §1): "<project> ⇅" opens a menu with every
// project's running tabs, a dot while one waits for the owner, its Ctrl+Alt+N key, and the W7-B project tools.
import { ArrowUpDown } from 'lucide-react'
import type { Attention, SessionInfo } from '../../../../core/types'
import { OTHER_WORKSPACE, workspaceSummaries, type WorkspaceProject } from '../../state/workspaceTree'
import { Menu, type MenuItem } from '../ui'

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
}

/** The menu's rows: All tabs, each project (its key on the first nine), then the project tools. */
export function switcherItems(p: SwitcherProps): MenuItem[] {
  const rows = workspaceSummaries(p.tree, p.byWorkspace, p.sessions, p.attention)
  const tools = p.toolsDisabledReason !== undefined
  return [
    { id: 'all', label: <span className="tb-sw-row">All tabs</span>, onSelect: () => p.onSelect(null) },
    ...rows.map((r, i): MenuItem => ({
      id: r.id,
      label: (
        <span className={`tb-sw-row${r.id === p.selectedId ? ' tb-sw-selected' : ''}`}>
          <span className={`tb-sw-dot${r.waiting ? ' tb-sw-waiting' : ''}`} aria-label={r.waiting ? 'needs input' : undefined} />
          <span className="tb-sw-name">{r.name}</span>
          <span className="tb-sw-count" aria-label={`${r.running} running`}>
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
          .map((r): MenuItem => ({ id: `window:${r.id}`, label: `Open ${r.name} in new window`, onSelect: () => p.onOpenWindow?.(r.id) }))
      : []),
    // W7-B: the project's settings page; "Other" is no project
    ...rows
      .filter((r) => r.id !== OTHER_WORKSPACE)
      .map((r): MenuItem => ({ id: `settings:${r.id}`, label: `${r.name} settings…`, disabled: tools, onSelect: () => p.onSettings(r.id) })),
    { id: 'new', label: '+ New project', disabled: tools, onSelect: p.onNew },
    { id: 'add', label: 'Add project', disabled: tools, onSelect: p.onAdd }
  ]
}

export function ProjectSwitcher(p: SwitcherProps): React.JSX.Element {
  const name = p.selectedId === null ? 'All projects' : p.selectedId === OTHER_WORKSPACE ? 'Other' : (p.tree.find((x) => x.id === p.selectedId)?.name ?? 'All projects')
  const waiting = workspaceSummaries(p.tree, p.byWorkspace, p.sessions, p.attention).some((r) => r.waiting)
  return (
    <Menu
      label="Switch project"
      items={switcherItems(p)}
      trigger={{
        variant: 'ghost',
        size: 'sm',
        className: 'tb-switcher',
        title: p.toolsDisabledReason,
        children: (
          <>
            {name}
            {waiting && <span className="tb-sw-dot tb-sw-waiting" aria-label="a project needs input" />}
            <ArrowUpDown size={12} aria-hidden="true" />
          </>
        )
      }}
    />
  )
}
