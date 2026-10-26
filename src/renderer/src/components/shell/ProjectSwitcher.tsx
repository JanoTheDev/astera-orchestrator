// W6-F project switcher, as the top bar's button (W9-B; DESIGN-W11 §8): "● <project> ▾" opens a searchable menu.
// T11 redesign: "All projects" on top as a row of its own, then the Projects section (each workspace with its status dot,
// branch, running plans and open questions, a changes badge that opens Source Control, its Ctrl+Alt+N key, and its
// sub-projects nested under it), then the Actions section (new, add, new window, the open project's settings); each row also opens in a window of its own.
// switcherItems stays the one list of actions; the popover only lays it out.
import { useEffect, useRef, useState } from 'react'
import type { Attention, ProjectGitStatus, SessionInfo } from '../../../../core/types'
import type { Project } from '../../../../core/orchestration/types'
import {
  OTHER_WORKSPACE, projectStatusDot, workspaceSummaries, type SubProjectRef, type WorkspaceProject, type WorkspaceSummary
} from '../../state/workspaceTree'
import { switcherName } from '../../state/projectScope'
import * as sticky from '../../lib/stickyProject'
import { confirmModal } from '../../lib/confirm'
import { toast } from '../../lib/toast'
import { openActivity } from './navigation'
import { Badge, Button, Chip, Icon, IconButton, Input, Kbd, Menu, Popover, Tooltip, menuPointOf, type MenuItem } from '../ui'
import { PROJECT_CHIP, projectActions, projectStateOf, type ProjectState } from '../projects/projectMenu'
import type { Translate } from '../checkText'
import './projectSwitcher.css'

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
  /** W9-K: opens the project in a window of its own (or focuses the one it has); null opens an All window. */
  onOpenWindow?: (id: string | null) => void
  /** Why the project tools are off (no tab open to anchor the commands), or undefined. */
  toolsDisabledReason?: string
  t: Translate
}

/** T11: what the open menu reads besides the tree: each workspace's git line and its sub-projects. */
export interface SwitcherFacts {
  git?: Readonly<Record<string, ProjectGitStatus>>
  subProjects?: readonly SubProjectRef[]
  /** Each workspace folder's state (missing, no git repository), by path. */
  states?: Readonly<Record<string, ProjectState>>
}

/** The folder a row stands for: a sub-project shares its workspace's. */
const folderOf = (p: Pick<SwitcherProps, 'tree'>, r: Pick<WorkspaceSummary, 'id' | 'parentId'>): string => p.tree.find((x) => x.id === (r.parentId ?? r.id))?.path ?? ''

const rowName = (r: WorkspaceSummary, t: Translate): string => (r.id === OTHER_WORKSPACE ? t('shell.switcher.other') : r.name)

/** "2 plans · 1 question", or nothing while neither runs nor asks. */
export function countsText(r: Pick<WorkspaceSummary, 'plans' | 'questions'>, t: Translate): string {
  const parts = [
    r.plans === 1 ? t('shell.switcher.planOne') : r.plans > 1 ? t('shell.switcher.plans', { n: r.plans }) : '',
    r.questions === 1 ? t('shell.switcher.questionOne') : r.questions > 1 ? t('shell.switcher.questions', { n: r.questions }) : ''
  ]
  return parts.filter(Boolean).join(' · ')
}

function rowLabel(r: WorkspaceSummary, key: number | undefined, t: Translate, state: ProjectState = 'ok'): React.JSX.Element {
  const dot = projectStatusDot(r)
  const counts = countsText(r, t)
  const meta = r.branch !== undefined || r.behind > 0 || counts !== '' || state !== 'ok'
  return (
    <span className="tb-psw-row">
      <span className={`tb-psw-dot tb-psw-dot--${dot}`} role="img" aria-label={t(`shell.switcher.dot.${dot}`)} />
      <span className="tb-psw-text">
        <span className="tb-psw-name">{rowName(r, t)}</span>
        {meta && (
          <span className="tb-psw-meta">
            {r.branch !== undefined && (
              <span className="tb-psw-branch">
                <Icon name="branch" size={14} />
                <span className="tb-psw-branch-name">{r.branch}</span>
              </span>
            )}
            {r.behind > 0 && (
              <span className="tb-psw-behind" title={t('shell.switcher.behind', { n: r.behind })}>
                <Icon name="arrowDown" size={14} />
                {r.behind}
              </span>
            )}
            {counts !== '' && <span className="tb-psw-counts">{counts}</span>}
            {state !== 'ok' && (
              <Chip tone="warn">
                <Icon name={PROJECT_CHIP[state].icon} size={14} />
                {t(PROJECT_CHIP[state].key)}
              </Chip>
            )}
          </span>
        )}
      </span>
      {key !== undefined && <Kbd className="tb-sw-key">{`Ctrl+Alt+${key}`}</Kbd>}
    </span>
  )
}

/** The menu's rows: All projects; each workspace (its key on the first nine, as Ctrl+Alt+N counts the tree), its
 *  changes badge and its sub-projects; "Other"; then the actions. A sub-project shares its workspace's folder and
 *  sessions, so it opens that workspace. */
export function switcherItems(p: SwitcherProps, facts: SwitcherFacts = {}): MenuItem[] {
  const rows = workspaceSummaries(p.tree, p.byWorkspace, p.sessions, p.attention, facts)
  const tools = p.toolsDisabledReason !== undefined
  const { t } = p
  const current = p.tree.find((x) => x.id === p.selectedId)
  const slot = new Map(p.tree.slice(0, 9).map((x, i) => [x.id, i + 1]))
  return [
    { id: 'all', label: t('wall.scope.all'), icon: <Icon name="layoutGrid" size={14} />, onSelect: () => p.onSelect(null) },
    ...rows.flatMap((r): MenuItem[] => [
      { id: r.id, label: rowLabel(r, r.parentId === undefined ? slot.get(r.id) : undefined, t, facts.states?.[folderOf(p, r)]), onSelect: () => p.onSelect(r.parentId ?? r.id) },
      ...(r.dirty > 0 || r.unpushed > 0
        ? [{
            id: `changes:${r.id}`,
            label: t('shell.switcher.openChanges', { name: r.name }),
            onSelect: () => {
              p.onSelect(r.id)
              openActivity('scm')
            }
          }]
        : []),
      ...(p.onOpenWindow && r.id !== OTHER_WORKSPACE // "Other" is no project
        ? [{
            id: `window:${r.id}`,
            label: t('shell.switcher.openWindow', { name: r.name }),
            icon: <Icon name="external" size={14} />,
            onSelect: () => p.onOpenWindow?.(r.parentId ?? r.id)
          }]
        : [])
    ]),
    { id: 'new', label: t('shell.switcher.new'), icon: <Icon name="add" size={14} />, disabled: tools, onSelect: p.onNew },
    { id: 'add', label: t('settings.projects.add'), icon: <Icon name="folderAdd" size={14} />, disabled: tools, onSelect: p.onAdd },
    ...(p.onOpenWindow ? [{ id: 'newWindow', label: t('shell.switcher.newWindow'), icon: <Icon name="external" size={14} />, onSelect: () => p.onOpenWindow?.(null) }] : []),
    // W7-B: the open project's settings; All and "Other" are no project
    ...(current
      ? [{ id: 'settings', label: t('shell.switcher.settings', { name: current.name }), icon: <Icon name="settings" size={14} />, disabled: tools, onSelect: () => p.onSettings(current.id) }]
      : [])
  ]
}

/** The menu's search: a project stays when its name holds the query, ignoring case and outer spaces. */
export function matchesProject(name: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q === '' || name.toLowerCase().includes(q)
}

/** T11: the facts, read on every opening (projects.status keeps its answers a few seconds). The tree lists workspaces
 *  only, so the sub-projects come from projects-list, through the same door useWorkspaceData reads. */
function useSwitcherFacts(open: boolean, tree: readonly WorkspaceProject[]): SwitcherFacts {
  const [facts, setFacts] = useState<SwitcherFacts>({})
  const paths = tree.map((x) => x.path).join('\n')
  useEffect(() => {
    if (!open || paths === '') return
    let alive = true
    const list = paths.split('\n')
    const stateOf = async (path: string): Promise<[string, ProjectState]> => {
      const exists = await window.api.system.pathExists(path).catch(() => undefined)
      const repo = exists === false ? undefined : (await window.api.worktrees.isGitRepo(path).catch(() => undefined))?.kind
      return [path, projectStateOf({ exists, repo })]
    }
    void Promise.all([
      window.api.projects.status(list).catch(() => ({})),
      Promise.all(list.map(stateOf)),
      window.api.orch.command(list[0], 'projects-list', {}).then(
        (r) => (r.status === 200 && Array.isArray(r.body) ? (r.body as Project[]) : []),
        () => []
      )
    ]).then(([git, states, projects]) => {
      if (!alive) return
      const subProjects = projects.flatMap((x) => (x.parentId === undefined ? [] : [{ id: x.id, name: x.name, parentId: x.parentId }]))
      setFacts({ git, subProjects, states: Object.fromEntries(states) })
    })
    return () => {
      alive = false
    }
  }, [open, paths])
  return facts
}

const openers = new Set<() => void>()
/** DESIGN-W13 §7: the status bar's project item opens the title bar's switcher. */
export const openProjectSwitcher = (): void => openers.forEach((f) => f())

/** The button and its searchable panel. On the house Popover: outside click and Esc close (Esc refocuses the button),
 *  ArrowUp/Down/Home/End move over the `data-roving` controls (the search field first, then each row and its badge).
 *  In the field Home/End keep the caret and Enter opens the first match; Tab closes the panel. */
export function ProjectSwitcher(p: SwitcherProps): React.JSX.Element {
  const { t } = p
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const show = (): void => setOpen(true)
    openers.add(show)
    return () => void openers.delete(show)
  }, [])
  const facts = useSwitcherFacts(open, p.tree)
  const label = switcherName(p.selectedId, p.tree, p.selectedId ? sticky.readName(p.selectedId) : null)
  const name = label.kind === 'all' ? t('wall.scope.all') : label.kind === 'other' ? t('shell.switcher.other') : label.kind === 'name' ? label.name : t('shell.switcher.label')
  const rows = workspaceSummaries(p.tree, p.byWorkspace, p.sessions, p.attention, facts)
  // the trigger's dot goes amber with any row's: a waiting session or an open question
  const waiting = rows.some((r) => projectStatusDot(r) === 'needsYou')

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
  const items = open ? switcherItems(p, facts) : []
  const byId = new Map(items.map((it) => [it.id, it]))
  const shown = rows.filter((r) => matchesProject(rowName(r, t), query))
  const onSearchKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Home' || e.key === 'End') e.stopPropagation() // the caret's, not the list's
    else if (e.key === 'Enter') pick(byId.get(shown[0]?.id ?? ''))
  }
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: Array<MenuItem | 'separator'> } | null>(null)
  // Right-click on a project row: Open, Open in new window, Settings, Reveal folder, Remove (projectMenu.ts says which stand).
  const rowMenu = (r: WorkspaceSummary): Array<MenuItem | 'separator'> => {
    const folder = folderOf(p, r)
    const id = r.parentId ?? r.id
    const label: Record<string, string> = {
      open: t('shell.projectMenu.open'), window: t('shell.projectMenu.window'), settings: t('shell.projectMenu.settings'),
      reveal: t('shell.projectMenu.reveal'), remove: t('shell.projectMenu.remove')
    }
    const icon = { open: 'folder', window: 'external', settings: 'settings', reveal: 'folder', remove: 'delete' } as const
    const run: Record<string, () => void> = {
      open: () => p.onSelect(id),
      window: () => p.onOpenWindow?.(id),
      settings: () => p.onSettings(r.id),
      reveal: () => void window.api.files.reveal(folder).catch((e) => toast.error(t('shell.projectMenu.revealFailed', { message: e instanceof Error ? e.message : String(e) }))),
      remove: () => void removeProject(r)
    }
    return projectActions({ state: facts.states?.[folder] ?? 'ok', canWindow: !!p.onOpenWindow, tools: p.toolsDisabledReason === undefined }).map((a) => ({
      id: a.id, label: label[a.id], icon: <Icon name={icon[a.id]} size={14} />, disabled: a.disabled, danger: a.id === 'remove', onSelect: run[a.id]
    }))
  }
  // The same unregistering as Project Settings' Remove: nothing on disk is touched.
  const removeProject = async (r: WorkspaceSummary): Promise<void> => {
    const ok = await confirmModal({ title: t('project.remove.title', { name: r.name }), body: t('project.remove.body'), confirmLabel: t('project.remove.confirm'), danger: true })
    if (!ok) return
    const res = await window.api.orch.command(p.tree[0]?.path ?? folderOf(p, r), 'projects-remove', { id: r.id }).catch(() => null)
    if (res?.status !== 200) return void toast.error((res?.body as { error?: string } | null)?.error ?? t('project.error.remove'))
    if (p.selectedId === r.id) p.onSelect(null)
  }
  const row = (it: MenuItem, opts: { current?: boolean; className?: string; extra?: React.ReactNode; menu?: WorkspaceSummary } = {}): React.JSX.Element => (
    <div
      key={it.id}
      className={`tb-sw-item${opts.className ? ` ${opts.className}` : ''}`}
      onContextMenu={opts.menu && ((e) => { e.preventDefault(); setMenu({ at: menuPointOf(e), items: rowMenu(opts.menu!) }) })}
    >
      <Button
        variant="ghost"
        data-roving=""
        tabIndex={-1}
        disabled={it.disabled}
        icon={it.icon}
        title={it.disabled ? p.toolsDisabledReason : undefined}
        aria-current={opts.current || undefined}
        className={`tb-sw-main${opts.current ? ' tb-sw-selected' : ''}`}
        onClick={(e) => pick((e.ctrlKey || e.metaKey ? byId.get(`window:${it.id}`) : undefined) ?? it)}
      >
        {it.label}
        {opts.current && <Icon name="check" size={14} className="tb-sw-check" />}
      </Button>
      {opts.extra}
    </div>
  )
  const changesBadge = (r: WorkspaceSummary): React.ReactNode => {
    const it = byId.get(`changes:${r.id}`)
    if (!it) return null
    return (
      <Tooltip content={String(it.label)}>
        <Button variant="ghost" size="sm" data-roving="" tabIndex={-1} className="tb-psw-changes" aria-label={String(it.label)} onClick={() => pick(it)}>
          {r.dirty > 0 && <Badge tone="info">{t('shell.switcher.changed', { n: r.dirty })}</Badge>}
          {r.unpushed > 0 && <Badge tone="warn">{t('shell.switcher.unpushed', { n: r.unpushed })}</Badge>}
        </Button>
      </Tooltip>
    )
  }
  const windowButton = (r: WorkspaceSummary): React.ReactNode => {
    const it = byId.get(`window:${r.id}`)
    return it && <IconButton size="sm" data-roving="" tabIndex={-1} className="tb-psw-window" icon={<Icon name="external" size={14} />} label={String(it.label)} onClick={() => pick(it)} />
  }
  const actions = ['new', 'add', 'newWindow', 'settings'].map((id) => byId.get(id)).filter((it): it is MenuItem => it !== undefined)

  return (
    <div ref={root} className="tb-sw" onKeyDown={(e) => e.key === 'Tab' && open && setShown(false)}>
      <Popover
        open={open}
        onOpenChange={setShown}
        label={t('shell.switcher.label')}
        panelClassName="tb-sw-pop tb-psw-pop"
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
          {byId.get('all') && row(byId.get('all')!, { current: p.selectedId === null, className: 'tb-psw-all' })}
          <div className="tb-psw-section" role="presentation">{t('shell.switcher.projects')}</div>
          {shown.length === 0 && <div className="tb-sw-empty">{t('shell.switcher.noMatch')}</div>}
          {shown.map((r) => {
            const it = byId.get(r.id)
            return it ? row(it, { current: r.id === p.selectedId, className: r.parentId !== undefined ? 'tb-psw-sub' : undefined, extra: <>{changesBadge(r)}{windowButton(r)}</>, menu: r.id === OTHER_WORKSPACE ? undefined : r }) : null
          })}
          <div className="tb-psw-section" role="presentation">{t('shell.switcher.actions')}</div>
          {actions.map((it) => row(it, { className: 'tb-psw-action' }))}
        </div>
      </Popover>
      {menu && <Menu at={menu.at} items={menu.items} label={t('shell.projectMenu.label')} onClose={() => setMenu(null)} />}
    </div>
  )
}
