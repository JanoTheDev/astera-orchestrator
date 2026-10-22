// W9-H, W11: the Agents page's wall (DESIGN-W11 §7, §9): the filters of the page header, the plan groups with their
// tiles and Done cards, the empty state, and the console strip of the full-size view. What goes where is
// wallModel.ts's; this file only draws it.
import { useEffect, useRef, useState } from 'react'
import { ExternalLink, MoreHorizontal, Plus, TerminalSquare } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { useChatState } from '../../hooks/useChatState'
import { Button, Chip, Tabs, EmptyState, Menu, Select, cx, type ChipTone } from '../ui'
import { claimTerminal } from './consoleDock'
import {
  ALL_PLANS, NO_PLAN, pillCount, previewOf, progressSegments, stripLabel, tileMenuOf,
  type PlanFilter, type PlanPill, type StateFilter, type TileState, type WallConsole
} from './wallModel'
import type { PlanProgress } from '../plan/planBoard'

/** More plans than this and the plan chips become one select (DESIGN-W11 §7: one control per kind). */
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

/** The full-size view's switcher: every live console of the scope, the open one selected. */
export function ConsoleStrip({
  consoles,
  mainId,
  selected,
  onAll,
  onOpen
}: {
  consoles: readonly WallConsole[]
  mainId: string | null
  /** The open console, or null for "All consoles" (another page's tab has the pane grid). */
  selected: string | null
  onAll: () => void
  onOpen: (sessionId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const live = consoles.filter((c) => c.state !== 'finished')
  const items = [
    // With a console open the header's back button is the way out; the strip offers it only when nothing is open.
    ...(selected === null ? [{ id: '', label: t('wall.strip.all') }] : []),
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

/** A plan's Tasks as one stacked bar, done first. */
export function ProgressBar({ progress }: { progress: PlanProgress }): React.JSX.Element {
  return (
    <span className="wall-progress" aria-hidden="true">
      {progressSegments(progress).map((s) => (
        <span key={s.category} className={`wall-progress__seg wall-progress__seg--${s.category}`} style={{ flexGrow: s.share }} />
      ))}
    </span>
  )
}

const usePillTitle = (): ((p: PlanPill) => string) => {
  const { t } = useI18n()
  return (p) =>
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
}

/** A toggled filter (DESIGN-W11 §7): a ghost Button that reads pressed while on. */
function FilterChip({ on, title, onClick, children }: { on: boolean; title?: string; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <Button size="sm" variant="ghost" className={cx('wall-chip', on && 'is-active')} aria-pressed={on} title={title} onClick={onClick}>
      {children}
    </Button>
  )
}

/** The page header's filters row: the state as a segmented choice with counts, the plans, and "All projects". */
export function WallFilters({
  filter,
  onFilter,
  counts,
  pills,
  plan,
  onPlan,
  allProjects,
  onAllProjects
}: {
  filter: StateFilter
  onFilter: (f: StateFilter) => void
  counts: Readonly<Record<TileState, number>>
  pills: readonly PlanPill[]
  plan: PlanFilter
  onPlan: (p: PlanFilter) => void
  allProjects: boolean
  onAllProjects: (on: boolean) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const titleOf = usePillTitle()
  const words = { approve: t('wall.plans.approve'), need: (n: number) => t('wall.plans.needYou', { n }) }
  const live = counts.needs + counts.working + counts.idle
  const count = (n: number): { count?: number } => (n > 0 ? { count: n } : {})
  return (
    <>
      <Tabs
        variant="segmented"
        label={t('wall.filter.label')}
        value={filter}
        onChange={onFilter}
        items={[
          { id: 'all', label: t('wall.filter.all'), ...count(live + counts.finished) },
          { id: 'needs', label: t('wall.filter.needs'), ...count(counts.needs) },
          { id: 'working', label: t('wall.filter.working'), ...count(counts.working) },
          { id: 'finished', label: t('wall.filter.finished'), ...count(counts.finished) }
        ]}
      />
      {pills.length > 0 && <span className="wall-filters__sep" aria-hidden="true" />}
      {pills.length > PILLS_MAX ? (
        <Select className="wall-filters__plan" aria-label={t('wall.plans.label')} value={plan} onChange={(e) => onPlan(e.target.value)}>
          <option value={ALL_PLANS}>{t('wall.plans.all')}</option>
          {[...new Set(pills.map((p) => p.projectName))].map((name) => (
            <optgroup key={name} label={name}>
              {pills
                .filter((p) => p.projectName === name)
                .map((p) => (
                  <option key={p.jobId} value={p.jobId}>{`${p.name} · ${pillCount(p, words)}`}</option>
                ))}
            </optgroup>
          ))}
          <option value={NO_PLAN}>{t('wall.plans.none')}</option>
        </Select>
      ) : (
        pills.length > 0 && (
          <div className="wall-filters__plans" role="group" aria-label={t('wall.plans.label')}>
            <FilterChip on={plan === ALL_PLANS} onClick={() => onPlan(ALL_PLANS)}>
              {t('wall.plans.all')}
            </FilterChip>
            {pills.map((p) => (
              <FilterChip key={p.jobId} on={plan === p.jobId} title={titleOf(p)} onClick={() => onPlan(p.jobId)}>
                <span className="wall-chip__name">{p.name}</span>
                <span className={cx('wall-chip__count', (p.needs > 0 || p.approve) && 'wall-chip__count--need')}>{pillCount(p, words)}</span>
              </FilterChip>
            ))}
            <FilterChip on={plan === NO_PLAN} onClick={() => onPlan(NO_PLAN)}>
              {t('wall.plans.none')}
            </FilterChip>
          </div>
        )
      )}
      <span className="wall-filters__end">
        <FilterChip on={allProjects} onClick={() => onAllProjects(!allProjects)}>
          {t('wall.scope.all')}
        </FilterChip>
      </span>
    </>
  )
}

/** One plan's block on the wall: its name and progress, its live tiles, then its Done cards. */
export function PlanGroup({
  pill,
  name,
  live,
  done,
  onOpenPlan
}: {
  /** The plan's pill (progress, counts), or undefined for the consoles of no plan. */
  pill?: PlanPill
  /** Null: no head (the wall's only group is the consoles of no plan). */
  name: string | null
  live: React.ReactNode[]
  done: React.ReactNode[]
  onOpenPlan?: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const titleOf = usePillTitle()
  return (
    <section className="wall-group" aria-label={name ?? undefined}>
      {name !== null && (
        <header className="wall-group__head">
          <h2 className="wall-group__name">{name}</h2>
          {pill && pill.total > 0 && (
            <span className="wall-group__progress" title={titleOf(pill)}>
              <ProgressBar progress={pill.progress} />
              <span className="wall-group__count">{t('wall.group.progress', { done: pill.done, total: pill.total })}</span>
            </span>
          )}
          {pill && pill.needs > 0 && (
            <Chip tone="warn" dot>
              {t('wall.plans.needYou', { n: pill.needs })}
            </Chip>
          )}
          {pill?.approve && <Chip tone="warn">{t('wall.plans.approve')}</Chip>}
          {onOpenPlan && (
            <Button size="sm" variant="ghost" className="wall-group__open" icon={<ExternalLink size={14} />} onClick={onOpenPlan}>
              {t('wall.group.open')}
            </Button>
          )}
        </header>
      )}
      {live.length > 0 && <div className="wall-grid">{live}</div>}
      {done.length > 0 && (
        <div className="wall-group__done">
          {live.length > 0 && (
            <h3 className="wall-group__done-title">
              {t('wall.group.done')} <span className="wall-group__count">{done.length}</span>
            </h3>
          )}
          <div className="wall-done">{done}</div>
        </div>
      )}
    </section>
  )
}

/** One tile: role and Task, the state, a meta line (plan · account · elapsed), then the session's own xterm. */
export function ConsoleTile({
  c,
  main,
  meta,
  onOpen
}: {
  c: WallConsole
  main: boolean
  /** Plan, account, the role's detail (time running, files): what tells two tiles apart. */
  meta: readonly string[]
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (c.chat || !anchor.current) return
    return claimTerminal(c.sessionId, anchor.current)
  }, [c.sessionId, c.chat])
  // A chat tile has no xterm: its preview is the session's last reply, read again each time a turn ends (the
  // status leaves 'working'). A terminal tile subscribes to nothing here (enabled=false).
  const chatStatus = useChatState(c.sessionId, c.chat)?.status ?? null
  const [reply, setReply] = useState<string | null>(null)
  useEffect(() => {
    if (!c.chat || chatStatus === 'working') return
    let current = true
    void window.api.conversation.lastReply(c.sessionId).then(
      (text) => current && setReply(text),
      () => {}
    )
    return () => {
      current = false
    }
  }, [c.sessionId, c.chat, chatStatus])
  const preview = previewOf(reply)
  const menu = tileMenuOf(c, { openWindow: t('wall.tile.openWindow') }, (projectId) => window.api.win.openNew(projectId))
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
        <div className="wall-tile__title">
          <span className="wall-tile__name">{c.label}</span>
          {main && <span className="wall-tile__main">{t('wall.main')}</span>}
          {c.taskTitle && <span className="wall-tile__task">{c.taskTitle}</span>}
        </div>
        <StateChip c={c} />
        {/* The menu is a button of its own inside the tile's button: its clicks and keys must not open the tile. */}
        <span className="wall-tile__menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Menu label={t('wall.tile.menu')} align="end" trigger={{ size: 'sm', icon: <MoreHorizontal size={14} /> }} items={menu} />
        </span>
      </div>
      {meta.length > 0 && <div className="wall-tile__meta">{meta.join(' · ')}</div>}
      {c.chat ? (
        <div className={cx('wall-tile__chat', preview === null && 'wall-tile__chat--empty')}>
          {preview === null ? t('wall.tile.chatEmpty') : <p className="wall-tile__reply">{preview}</p>}
        </div>
      ) : (
        <div ref={anchor} className="terminal-host wall-tile__term" />
      )}
    </div>
  )
}

/** The page's one empty state: no consoles at all (with New console), or none left by the filters. */
export function WallEmpty({ filtered, onNew, onReset }: { filtered: boolean; onNew?: () => void; onReset: () => void }): React.JSX.Element {
  const { t } = useI18n()
  return filtered ? (
    <EmptyState icon={TerminalSquare} title={t('wall.empty.filtered.title')} action={<Button onClick={onReset}>{t('wall.empty.reset')}</Button>}>
      {t('wall.empty.filtered')}
    </EmptyState>
  ) : (
    <EmptyState
      icon={TerminalSquare}
      title={t('wall.empty.title')}
      action={
        onNew && (
          <Button variant="primary" icon={<Plus size={16} />} onClick={onNew}>
            {t('wall.new')}
          </Button>
        )
      }
    >
      {t('wall.empty')}
    </EmptyState>
  )
}
