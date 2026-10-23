// W6-F project switcher, as the top bar's button (W9-B; DESIGN-W11 §8): "● <project> ▾" opens a searchable menu: All
// projects, then every project with its running tabs (a count only when there are some), a dot while one waits for the
// owner, its Ctrl+Alt+N key and a check on the open one, each row with its own new-window and settings actions on
// hover, then the W7-B project tools. switcherItems stays the one list of actions; the popover only lays it out.
import { useRef, useState } from 'react'
import type { Attention, SessionInfo } from '../../../../core/types'
import { OTHER_WORKSPACE, workspaceSummaries, type WorkspaceProject } from '../../state/workspaceTree'
import { switcherName } from '../../state/projectScope'
import * as sticky from '../../lib/stickyProject'
import { Button, Icon, IconButton, Input, Kbd, Popover, Tooltip, type MenuItem } from '../ui'
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
  /** The folder useJobs dropped because it is gone, and the root the app falls back to (currentProject). */
  droppedRoot?: string | null
  fallbackRoot?: string | null
  t: Translate
}

/** The selection the switcher shows: a project whose folder was dropped is not shown; the fallback project is, or
 *  All projects when the fallback is no project in the tree. */
export function shownSelection(p: SwitcherProps): string | null {
  const picked = p.tree.find((r) => r.id === p.selectedId)
  if (!picked || !p.droppedRoot || picked.path !== p.droppedRoot) return p.selectedId
  if (!p.fallbackRoot || p.fallbackRoot === p.droppedRoot) return null
  return p.tree.find((r) => r.path === p.fallbackRoot)?.id ?? null
}

/** The menu's rows: All projects, each project (its key on the first nine), then the project tools. */
export function switcherItems(p: SwitcherProps): MenuItem[] {
  const rows = workspaceSummaries(p.tree, p.byWorkspace, p.sessions, p.attention)
  const tools = p.toolsDisabledReason !== undefined
  const { t } = p
  return [
    { id: 'all', label: <span className={`tb-sw-row${p.selectedId === null ? ' tb-sw-selected' : ''}`}><span className="tb-sw-name">{t('wall.scope.all')}</span></span>, onSelect: () => p.onSelect(null) },
    ...rows.map((r, i): MenuItem => ({
      id: r.id,
      label: (
        <span className={`tb-sw-row${r.id === p.selectedId ? ' tb-sw-selected' : ''}`}>
          <span className={`tb-sw-dot${r.waiting ? ' tb-sw-waiting' : ''}`} aria-label={r.waiting ? t('shell.switcher.needsInput') : undefined} />
          <span className="tb-sw-name">{r.id === OTHER_WORKSPACE ? t('shell.switcher.other') : r.name}</span>
          {/* zero is hidden by shell.css, not dropped, so every row keeps the same columns */}
          <span className="tb-sw-count" data-zero={r.running === 0 ? '' : undefined} aria-label={t('shell.switcher.running', { n: r.running })}>
            {r.running}
          </span>
          {i < 9 && <Kbd className="tb-sw-key">{`Ctrl+Alt+${i + 1}`}</Kbd>}
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

/** The menu's search: a project stays when its name holds the query, ignoring case and outer spaces. */
export function matchesProject(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || name.toLowerCase().includes(q)
}

/** The button and its searchable panel. On the house Popover: outside click and Esc close (Esc refocuses the button),
 *  ArrowUp/Down/Home/End move over the `data-roving` controls (the search field first, then each row and its actions).
 *  In the field Home/End keep the caret and Enter opens the first match; Tab closes the panel. */
export function ProjectSwitcher(given: SwitcherProps): React.JSX.Element {
  const p = { ...given, selectedId: shownSelection(given) }
  const { t } = p
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const label = switcherName(p.selectedId, p.tree, p.selectedId ? sticky.readName(p.selectedId) : null)
  const name = label.kind === 'all' ? t('wall.scope.all') : label.kind === 'other' ? t('shell.switcher.other') : label.kind === 'name' ? label.name : t('shell.switcher.label')
  const rows = workspaceSummaries(p.tree, p.byWorkspace, p.sessions, p.attention)
  const waiting = rows.some((r) => r.waiting)

  const setShown = (next: boolean): void => {
    setOpen(next)
    if (!next) setQuery('')
  }
  const pick = (it: MenuItem | undefined): void => {
    if (!it || it.disabled) return
    setShown(false)
    root.current?.querySelector<HTMLElement>('.tb-switcher')?.focus()
    it.onSelect()
  }
  const items = open ? switcherItems(p) : []
  const byId = new Map(items.map((it) => [it.id, it]))
  const shown = rows.filter((r) => matchesProject(r.id === OTHER_WORKSPACE ? t('shell.switcher.other') : r.name, query))
  const onSearchKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Home' || e.key === 'End') e.stopPropagation() // the caret's, not the list's
    else if (e.key === 'Enter') pick(byId.get(shown[0]?.id ?? ''))
  }
  const row = (it: MenuItem, extra?: React.ReactNode): React.JSX.Element => {
    const current = it.id === 'all' ? p.selectedId === null : it.id === p.selectedId
    return (
      <div key={it.id} className="tb-sw-item">
        <Button variant="ghost" data-roving="" tabIndex={-1} disabled={it.disabled} aria-current={current || undefined} className="tb-sw-main" onClick={() => pick(it)}>
          {it.label}
          {current && <Icon name="check" size={14} className="tb-sw-check" />}
        </Button>
        {extra}
      </div>
    )
  }

  return (
    <div ref={root} className="tb-sw" onKeyDown={(e) => e.key === 'Tab' && open && setShown(false)}>
      <Popover
        open={open}
        onOpenChange={setShown}
        label={t('shell.switcher.label')}
        panelClassName="tb-sw-pop"
        trigger={(tp) => (
          <Tooltip content={p.toolsDisabledReason ? `${t('shell.switcher.overline')} · ${p.toolsDisabledReason}` : t('shell.switcher.overline')}>
            <Button {...tp} variant="ghost" size="sm" className="tb-switcher" aria-label={label.kind === 'pending' ? name : `${t('shell.switcher.label')}: ${name}`}>
              <span className={`tb-sw-dot${waiting ? ' tb-sw-waiting' : label.kind === 'name' ? ' tb-sw-on' : ''}`} aria-label={waiting ? t('shell.switcher.waiting') : undefined} />
              <span className="tb-switcher-name">{name}</span>
              <Icon name="chevronDown" size={14} />
            </Button>
          </Tooltip>
        )}
      >
        <label className="tb-sw-search">
          <Icon name="search" size={14} />
          <Input
            data-roving=""
            value={query}
            placeholder={t('shell.switcher.search')}
            aria-label={t('shell.switcher.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
        </label>
        <div className="tb-sw-list">
          {byId.get('all') && row(byId.get('all')!)}
          <div className="tb-sw-sep" role="separator" />
          {shown.length === 0 && <div className="tb-sw-empty">{t('shell.switcher.noMatch')}</div>}
          {shown.map((r) => {
            const win = byId.get(`window:${r.id}`)
            const set = byId.get(`settings:${r.id}`)
            const it = byId.get(r.id)
            if (!it) return null
            return row(
              it,
              (win || set) && (
                <span className="tb-sw-actions">
                  {win && <IconButton size="sm" data-roving="" tabIndex={-1} icon={<Icon name="external" size={14} />} label={String(win.label)} onClick={() => pick(win)} />}
                  {set && (
                    <IconButton
                      size="sm"
                      data-roving=""
                      tabIndex={-1}
                      icon={<Icon name="settings" size={14} />}
                      label={String(set.label)}
                      disabled={set.disabled}
                      title={set.disabled ? p.toolsDisabledReason : String(set.label)}
                      onClick={() => pick(set)}
                    />
                  )}
                </span>
              )
            )
          })}
          <div className="tb-sw-sep" role="separator" />
          {['new', 'add'].map((id) => byId.get(id)).map((it) => it && row(it))}
        </div>
      </Popover>
    </div>
  )
}
