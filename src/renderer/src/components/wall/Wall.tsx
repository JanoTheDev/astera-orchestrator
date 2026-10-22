// W9-H, W11: the Agents page's wall (DESIGN-W11 §7, §9): the filters of the page header, the plan groups with their
// tiles and Done cards, the empty state, and the console strip of the full-size view. What goes where is
// wallModel.ts's; this file only draws it.
import { useEffect, useRef } from 'react'
import { Activity, CircleAlert, CircleCheck, CirclePause, ExternalLink, EyeOff, MoreHorizontal, Plus, Power, ShieldAlert, TerminalSquare } from 'lucide-react'
import type { MessageKey } from '../../../../core/i18n'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Card, Chip, Tabs, EmptyState, Menu, Select, cx, type ChipTone } from '../ui'
import { claimTerminal } from './consoleDock'
import {
  ALL_PLANS, NO_PLAN, pillCount, progressSegments, stripLabel,
  type PlanFilter, type PlanPill, type StateFilter, type TileState, type WallConsole, type WallSectionRole
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
  // the second cue beside the colour (DESIGN-W11 §2): an icon per state
  const Glyph = c.state === 'needs' ? (c.needs === 'permission' ? ShieldAlert : CircleAlert) : c.state === 'working' ? Activity : c.state === 'finished' ? CircleCheck : CirclePause
  return (
    <Chip tone={stateTone(c)}>
      <Glyph size={12} aria-hidden="true" />
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

const SECTION_TITLE = {
  coordinator: 'wall.section.coordinators',
  planner: 'wall.section.planners',
  worker: 'wall.section.workers',
  console: 'wall.section.consoles'
} as const satisfies Record<WallSectionRole, MessageKey>

/** A role section's heading: the role's name and how many consoles it holds. */
export function SectionHead({ role, count }: { role: WallSectionRole; count: number }): React.JSX.Element {
  const { t } = useI18n()
  return (
    <h2 className="wall-section__head">
      {t(SECTION_TITLE[role])}{' '}
      <span className="wall-group__count">{count}</span>
    </h2>
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

/** T13: one tile, a card that reads at a glance: title and state, meta (project · account · role · ago), what it does
 *  now, then the bottom six lines of the session's own xterm. The card is the one button that opens the console; the
 *  overflow menu beside it holds the rest, so it never opens the console by accident. */
export function ConsoleTile({
  c,
  main,
  meta,
  activity,
  onOpen,
  onHide,
  onEnd
}: {
  c: WallConsole
  main: boolean
  /** Project, account, role, last activity: what tells two tiles apart. */
  meta: readonly string[]
  /** What it does now (activityOf, in the catalog's words). */
  activity: string
  onOpen: () => void
  onHide?: () => void
  onEnd?: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const anchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (c.chat || !anchor.current) return
    return claimTerminal(c.sessionId, anchor.current)
  }, [c.sessionId, c.chat])
  const title = c.taskTitle ?? c.label
  const actions = [
    ...(onHide ? [{ id: 'hide', label: t('wall.tile.hide'), icon: <EyeOff size={14} />, onSelect: onHide }] : []),
    ...(onEnd ? [{ id: 'end', label: t('wall.tile.end'), icon: <Power size={14} />, danger: true, onSelect: onEnd }] : [])
  ]
  return (
    <div className={cx('wall-tile', main && 'wall-tile--main')}>
      <Card
        tone={c.state === 'needs' ? (c.tone === 'danger' ? 'danger' : 'need') : 'plain'}
        className="wall-card wall-tile__card"
        aria-label={t('wall.tile.open', { name: title })}
        onClick={onOpen}
      >
        <span className="wall-card__head">
          <span className="wall-card__title">{title}</span>
          {main && <span className="wall-tile__main">{t('wall.main')}</span>}
          <StateChip c={c} />
        </span>
        {meta.length > 0 && <span className="wall-card__meta">{meta.join(' · ')}</span>}
        <span className="wall-card__line">{activity}</span>
        {c.chat ? <span className="wall-tile__chat">{t('wall.tile.chat')}</span> : <span ref={anchor} className="terminal-host wall-tile__term" />}
      </Card>
      {actions.length > 0 && (
        // a click in the menu stays here: it must never reach the card's open
        <div className="wall-tile__more" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Menu label={t('wall.tile.more', { name: title })} align="end" items={actions} trigger={{ icon: <MoreHorizontal size={14} />, size: 'sm', variant: 'ghost' }} />
        </div>
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
