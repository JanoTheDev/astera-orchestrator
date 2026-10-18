// W9-H: the Agents page's wall (DESIGN.md §2): the console strip, the plan pills, the toolbar, the tiles and the
// Finished row. What goes where is wallModel.ts's; this file only draws it.
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { Chip, Tabs, EmptyState, cx, type ChipTone } from '../ui'
import { claimTerminal } from './consoleDock'
import {
  ALL_PLANS, NO_PLAN, pillCount, progressSegments, stripLabel,
  type PlanFilter, type PlanPill, type Scope, type StateFilter, type WallConsole
} from './wallModel'

/** More plans than this and the pills become a search box over a grouped list (DESIGN §2). */
const PILLS_MAX = 6

const stateTone = (c: WallConsole): ChipTone =>
  c.state === 'needs' ? (c.tone ?? 'warn') : c.state === 'working' ? 'info' : c.state === 'finished' ? 'neutral' : 'ok'

export function StateChip({ c }: { c: WallConsole }): React.JSX.Element {
  const { t } = useI18n()
  const word =
    c.state === 'needs'
      ? t(c.needs === 'permission' ? 'wall.state.permission' : c.needs === 'gate' ? 'wall.state.gate' : 'wall.state.question')
      : t(c.state === 'working' ? 'wall.state.working' : c.state === 'finished' ? 'wall.state.finished' : 'wall.state.idle')
  return (
    <Chip tone={stateTone(c)} dot>
      {word}
    </Chip>
  )
}

export function ConsoleStrip({
  consoles,
  mainId,
  selected,
  onAll,
  onOpen
}: {
  consoles: readonly WallConsole[]
  mainId: string | null
  /** The open console, or null for "All consoles". */
  selected: string | null
  onAll: () => void
  onOpen: (sessionId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const live = consoles.filter((c) => c.state !== 'finished')
  const items = [
    { id: '', label: t('wall.strip.all') },
    ...live.map((c) => ({
      id: c.sessionId,
      label: (
        <>
          <span className={cx('wall-dot', `wall-dot--${c.state}`, c.tone && `wall-dot--${c.tone}`)} aria-hidden="true" />
          {stripLabel(c, mainId)}
        </>
      )
    }))
  ]
  return (
    <div className="wall-strip">
      <Tabs items={items} value={selected ?? ''} onChange={(id) => (id === '' ? onAll() : onOpen(id))} label={t('wall.strip.label')} />
    </div>
  )
}

function PillBar({ p }: { p: PlanPill }): React.JSX.Element {
  return (
    <span className="wall-pill__bar" aria-hidden="true">
      {progressSegments(p.progress).map((s) => (
        <span key={s.category} className={`wall-pill__seg wall-pill__seg--${s.category}`} style={{ flexGrow: s.share }} />
      ))}
    </span>
  )
}

export function PlanPills({ pills, value, onChange }: { pills: readonly PlanPill[]; value: PlanFilter; onChange: (v: PlanFilter) => void }): React.JSX.Element {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const words = { approve: t('wall.plans.approve'), need: (n: number) => t('wall.plans.needYou', { n }) }
  const titleOf = (p: PlanPill): string =>
    t('wall.plans.title', {
      name: p.name,
      done: p.progress.counts.done,
      total: p.progress.total,
      running: p.progress.counts.running,
      review: p.progress.counts['awaiting-review'],
      queued: p.progress.counts.queued,
      failed: p.progress.counts.failed,
      needs: p.needs
    })
  const pill = (id: PlanFilter, body: React.ReactNode, title?: string): React.JSX.Element => (
    <button key={id} type="button" className={cx('wall-pill', value === id && 'wall-pill--on')} aria-pressed={value === id} title={title} onClick={() => onChange(id)}>
      {body}
    </button>
  )
  const planPill = (p: PlanPill): React.JSX.Element =>
    pill(
      p.jobId,
      <>
        <span className="wall-pill__name">{p.name}</span>
        <PillBar p={p} />
        <span className={cx('wall-pill__count', (p.needs > 0 || p.approve) && 'wall-pill__count--need')}>{pillCount(p, words)}</span>
      </>,
      titleOf(p)
    )
  const many = pills.length > PILLS_MAX
  const q = query.trim().toLowerCase()
  const shown = many ? pills.filter((p) => p.jobId === value || (q !== '' && `${p.projectName} ${p.name}`.toLowerCase().includes(q))) : pills
  // Grouped by project, as the switcher names them.
  // shortcut: grouped by project, not by W8-D area (Job.areas is not in the JobRow fold); add it to the fold to group by area.
  const groups = [...new Set(shown.map((p) => p.projectName))].map((name) => ({ name, pills: shown.filter((p) => p.projectName === name) }))
  return (
    <div className="wall-pills" role="toolbar" aria-label={t('wall.plans.label')}>
      {pill(ALL_PLANS, t('wall.plans.all'))}
      {many && (
        <input className="wall-pills__search" type="search" placeholder={t('wall.plans.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {many
        ? groups.map((g) => (
            <span key={g.name} className="wall-pills__group">
              <span className="wall-pills__group-name">{g.name}</span>
              {g.pills.map(planPill)}
            </span>
          ))
        : shown.map(planPill)}
      {pill(NO_PLAN, t('wall.plans.none'))}
    </div>
  )
}

export function WallToolbar({
  scope,
  onScope,
  projectName,
  planPicked,
  filter,
  onFilter
}: {
  scope: Scope
  onScope: (s: Scope) => void
  projectName: string | null
  planPicked: boolean
  filter: StateFilter
  onFilter: (f: StateFilter) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const scopes: { id: Scope; label: string }[] = [
    ...(planPicked ? [{ id: 'plan' as const, label: t('wall.scope.plan') }] : []),
    { id: 'project', label: projectName ?? t('wall.scope.noProject') },
    { id: 'all', label: t('wall.scope.all') }
  ]
  return (
    <div className="wall-toolbar">
      <Tabs variant="segmented" label={t('wall.scope.label')} items={scopes} value={scopes.some((s) => s.id === scope) ? scope : 'project'} onChange={onScope} />
      <Tabs
        variant="segmented"
        label={t('wall.filter.label')}
        value={filter}
        onChange={onFilter}
        items={[
          { id: 'all', label: t('wall.filter.all') },
          { id: 'needs', label: t('wall.filter.needs') },
          { id: 'working', label: t('wall.filter.working') },
          { id: 'finished', label: t('wall.filter.finished') }
        ]}
      />
    </div>
  )
}

/** One tile: a header (name, Task, state), the detail line, then the session's own xterm (consoleDock). */
export function ConsoleTile({ c, main, detail, onOpen }: { c: WallConsole; main: boolean; detail: string | null; onOpen: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (c.chat || !anchor.current) return
    return claimTerminal(c.sessionId, anchor.current)
  }, [c.sessionId, c.chat])
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('wall.tile.open', { name: c.label })}
      className={cx('wall-tile', main && 'wall-tile--main', c.state === 'needs' && `wall-tile--${c.tone ?? 'warn'}`)}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="wall-tile__head">
        <span className="wall-tile__name">{c.label}</span>
        {main && <span className="wall-tile__main">{t('wall.main')}</span>}
        {c.taskTitle && <span className="wall-tile__task">{c.taskTitle}</span>}
        <StateChip c={c} />
      </div>
      {detail && <div className="wall-tile__detail">{detail}</div>}
      {c.chat ? <div className="wall-tile__chat">{t('wall.tile.chat')}</div> : <div ref={anchor} className="terminal-host wall-tile__term" />}
    </div>
  )
}

export function WallEmpty(): React.JSX.Element {
  const { t } = useI18n()
  return <EmptyState>{t('wall.empty')}</EmptyState>
}
