// W6-F project switcher, as the top bar's button (W9-B; DESIGN-W11 §8): "● <project> ▾" opens a searchable menu: All
// projects, then every project with its running tabs (a count only when there are some), a dot while one waits for the
// owner, its Ctrl+Alt+N key and a check on the open one, each row with its own new-window and settings actions on
// hover, then the W7-B project tools. switcherItems stays the one list of actions; the popover only lays it out.
import { useEffect, useId, useRef, useState } from 'react'
import { AppWindow, Check, ChevronDown, Search, Settings2 } from 'lucide-react'
import type { Attention, SessionInfo } from '../../../../core/types'
import { OTHER_WORKSPACE, workspaceSummaries, type WorkspaceProject } from '../../state/workspaceTree'
import { switcherName } from '../../state/projectScope'
import * as sticky from '../../lib/stickyProject'
import { Button, IconButton, Tooltip, type MenuItem } from '../ui'
import { rovingKeyDown } from '../ui/Nav'
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

/** The menu's search: a project stays when its name holds the query, ignoring case and outer spaces. */
export function matchesProject(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || name.toLowerCase().includes(q)
}

export function ProjectSwitcher(p: SwitcherProps): React.JSX.Element {
  const { t } = p
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const menuId = useId()
  const label = switcherName(p.selectedId, p.tree, p.selectedId ? sticky.readName(p.selectedId) : null)
  const name = label.kind === 'all' ? t('wall.scope.all') : label.kind === 'other' ? t('shell.switcher.other') : label.kind === 'name' ? label.name : t('shell.switcher.label')
  const rows = workspaceSummaries(p.tree, p.byWorkspace, p.sessions, p.attention)
  const waiting = rows.some((r) => r.waiting)

  useEffect(() => {
    if (!open) return
    search.current?.focus()
    const outside = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const close = (): void => {
    setOpen(false)
    button.current?.focus()
  }
  const pick = (it: MenuItem | undefined): void => {
    if (!it || it.disabled) return
    close()
    it.onSelect()
  }
  const items = open ? switcherItems(p) : []
  const byId = new Map(items.map((it) => [it.id, it]))
  const shown = rows.filter((r) => matchesProject(r.id === OTHER_WORKSPACE ? t('shell.switcher.other') : r.name, query))
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Tab') setOpen(false)
    else if (e.target === search.current && e.key === 'Enter') pick(byId.get(shown[0]?.id ?? ''))
    // Home/End stay with the search field's caret
    else if (e.target !== search.current || e.key === 'ArrowDown' || e.key === 'ArrowUp') rovingKeyDown(list.current, e, 'vertical')
  }
  const row = (it: MenuItem, extra?: React.ReactNode): React.JSX.Element => (
    <div key={it.id} className="tb-sw-item">
      <button type="button" role="menuitem" data-roving="" tabIndex={-1} disabled={it.disabled} className="tb-sw-main" onClick={() => pick(it)}>
        {it.label}
        {(it.id === 'all' ? p.selectedId === null : it.id === p.selectedId) && <Check size={14} className="tb-sw-check" aria-hidden="true" />}
      </button>
      {extra}
    </div>
  )

  return (
    <div ref={root} className="tb-sw">
      <Tooltip content={p.toolsDisabledReason ? `${t('shell.switcher.overline')} · ${p.toolsDisabledReason}` : t('shell.switcher.overline')}>
        <Button
          ref={button}
          variant="ghost"
          size="sm"
          className="tb-switcher"
          aria-label={t('shell.switcher.label')}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(!open)}
        >
          <span className={`tb-sw-dot${waiting ? ' tb-sw-waiting' : label.kind === 'name' ? ' tb-sw-on' : ''}`} aria-label={waiting ? t('shell.switcher.waiting') : undefined} />
          <span className="tb-switcher-name">{name}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </Tooltip>
      {open && (
        <div className="tb-sw-pop" onKeyDown={onKeyDown}>
          <label className="tb-sw-search">
            <Search size={14} aria-hidden="true" />
            <input ref={search} type="text" value={query} placeholder={t('shell.switcher.search')} aria-label={t('shell.switcher.search')} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div ref={list} id={menuId} role="menu" aria-label={t('shell.switcher.label')} className="tb-sw-list">
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
                    {win && <IconButton size="sm" data-roving="" tabIndex={-1} icon={<AppWindow size={14} />} label={String(win.label)} onClick={() => pick(win)} />}
                    {set && (
                      <IconButton
                        size="sm"
                        data-roving=""
                        tabIndex={-1}
                        icon={<Settings2 size={14} />}
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
        </div>
      )}
    </div>
  )
}
