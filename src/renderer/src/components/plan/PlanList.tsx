// W11 Plans page (DESIGN-W11 §7, §9 "Plans"): PageHeader (count, New job, From a source, View options), the By area /
// Overlap choice and the archived chip as filters, the Coordinator strip, then the plans by area as PlanRows. The Host
// gate, the stall line and the empty states are the ones JobsView drew (core's jobsViewScreen and jobsStall decide).
import { Fragment, useEffect, useState } from 'react'
import { Archive, FolderOpen, ListTodo, Plus, ServerOff, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import type { JobRow, OrchHostGate, OrchSnapshot } from '../../../../core/types'
import { jobsViewScreen, type JobsStall } from '../../../../core/orchestration/jobsView'
import { useI18n } from '../../i18n/I18nProvider'
import { jobName } from '../../lib/jobName'
import { clockFor } from '../../lib/runClock'
import { Button, Chip, EmptyState, Menu, PageHeader, Tabs, Tooltip } from '../ui'
import { useProjectDelivery } from '../delivery/ProjectDelivery'
import { areaGroupsOf, plansViewOf, type PlansView } from './planBoard'
import { Coordinator } from './Coordinator'
import { PlanRow, type PlanActs } from './PlanRow'
import './plans.css'

type View = PlansView

const VIEW_KEY = 'cm.plansView'

function storedView(): View {
  try {
    return plansViewOf(localStorage.getItem(VIEW_KEY))
  } catch {
    return 'area'
  }
}

/** "When a plan is done" (W6-H) as a View options menu: a setting, not a filter (DESIGN-W11 §7). The push branch is
 *  set in the project's settings. */
function ViewOptions({ projectPath }: { projectPath: string }): React.JSX.Element | null {
  const { t } = useI18n()
  const { project, mode, target, error, choose } = useProjectDelivery(projectPath)
  if (!project) return null
  return (
    <>
    {error && <Chip tone="danger">{error}</Chip>}
    <Menu
      label={t('pages.plans.viewOptions')}
      align="end"
      trigger={{ icon: <SlidersHorizontal size={16} />, title: t('pages.plans.viewOptions') }}
      items={[
        { id: 'head', label: t('delivery.label'), disabled: true, onSelect: () => {} },
        { id: 'pr', label: t('delivery.pr'), checked: mode === 'pr', onSelect: () => choose('pr') },
        { id: 'push', label: t('delivery.push', { branch: target }), checked: mode === 'push', onSelect: () => choose('push') }
      ]}
    />
    </>
  )
}

export function PlanList({
  snapshot,
  hostGate,
  stall,
  projectPath,
  acts,
  onNewRun,
  onNewFromSource,
  onNewConsole,
  overlap,
  mainPlan
}: {
  snapshot: OrchSnapshot | null
  hostGate: OrchHostGate | null
  /** Why nothing moves (limits L3), or null. */
  stall: JobsStall | null
  /** The open project; absent: none is open, and nothing can be created here. */
  projectPath?: string
  acts: PlanActs
  onNewRun: () => void
  onNewFromSource: () => void
  /** No project: a console makes its folder the project. */
  onNewConsole: () => void
  /** The Overlap view's table. */
  overlap: React.ReactNode
  /** The Main plan view. */
  mainPlan?: React.ReactNode
}): React.JSX.Element {
  const { t } = useI18n()
  const [view, setView] = useState<View>(storedView)
  const chooseView = (v: View): void => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* no storage: the list opens on By area next time */
    }
  }
  // Archived plans are hidden until asked for. Not remembered: the list opens on the plans that work.
  const [showArchived, setShowArchived] = useState(false)

  // A clock only while something runs or waits for a reset: it stops by itself after the last worker ends
  const anyRunning =
    snapshot?.runs.some(
      (r) => r.tasks.some((tk) => tk.startedAt || tk.waiting) || (r.children ?? []).some((kid) => kid.tasks.some((tk) => tk.startedAt || tk.waiting))
    ) ?? false
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!anyRunning) return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyRunning])

  const screen = jobsViewScreen({ hostGate, snapshot })
  const runs = snapshot?.runs ?? []
  const archivedCount = runs.filter((r) => r.archivedAt !== undefined).length
  const listed = showArchived ? runs : runs.filter((r) => r.archivedAt === undefined)
  const nameOf = (id: string): string => {
    const r = runs.find((x) => x.id === id)
    return r ? jobName(r) : id
  }
  const hasProject = projectPath !== undefined

  const header = (
    <PageHeader
      title={t('pages.plans.title')}
      subtitle={screen === 'runs' ? t('pages.plans.count', { n: runs.length - archivedCount }) : undefined}
      actions={
        hasProject && (
          <>
            <Button variant="ghost" icon={<FolderOpen size={16} />} onClick={onNewFromSource}>
              {t('jobs.source.open')}
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={onNewRun}>
              {t('jobs.new.open')}
            </Button>
            <ViewOptions projectPath={projectPath} />
          </>
        )
      }
      filters={
        screen === 'runs' && (
          <>
            <Tooltip content={t('pages.plans.viewHint')}>
              <Tabs<View>
                variant="segmented"
                label={t('pages.plans.title')}
                value={view}
                onChange={chooseView}
                items={[
                  { id: 'area', label: t('pages.plans.byArea') },
                  { id: 'overlap', label: t('pages.plans.overlap') },
                  { id: 'main', label: t('pages.plans.main') }
                ]}
              />
            </Tooltip>
            {archivedCount > 0 && view === 'area' && (
              <Button
                size="sm"
                variant="ghost"
                className="plans-chip"
                aria-pressed={showArchived}
                icon={<Archive size={14} />}
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived ? t('jobs.lifecycle.hideArchived') : t('jobs.lifecycle.showArchived', { count: archivedCount })}
              </Button>
            )}
          </>
        )
      }
    />
  )

  const stallLine = stall && (
    <p className="plans-stall" role="status">
      <TriangleAlert size={16} aria-hidden="true" />
      {stall.kind === 'unresponsive'
        ? t('jobs.stall.unresponsive')
        : stall.kind === 'reading'
          ? t('jobs.stall.reading')
          : t('jobs.stall.parked', { reason: t(stall.gate === 'unreadable' ? 'jobs.stall.gate.unreadable' : 'jobs.stall.gate.notMigrated') })}
    </p>
  )

  let body: React.ReactNode
  if (screen === 'host' && hostGate) {
    // The Host is why there is nothing: saying so is the whole point (with no Host there is no state to read)
    const waiting = hostGate.state === 'waiting'
    body = (
      <EmptyState icon={ServerOff} title={t(waiting ? 'jobs.host.waiting' : 'jobs.host.unreachable')}>
        <span className="plans-host">
          <span>{t('jobs.host.features')}</span>
          {!waiting && hostGate.reason && <span>{t('jobs.host.reason', { reason: hostGate.reason })}</span>}
          {!waiting && <span>{t('jobs.host.retry')}</span>}
          {!waiting && <span>{t('jobs.host.log', { path: hostGate.logPath })}</span>}
        </span>
      </EmptyState>
    )
  } else if (screen === 'blank') {
    // before the first answer: nothing, not an empty state that flashes on every project switch
    body = null
  } else if (screen === 'empty' || (view === 'area' && listed.length === 0)) {
    // 'runs' with every plan archived lists nothing: the same empty state, the archived toggle stays above it
    body = hasProject ? (
      <EmptyState
        icon={ListTodo}
        title={t('pages.plans.empty.title')}
        action={
          <Button variant="primary" icon={<Plus size={16} />} onClick={onNewRun}>
            {t('jobs.new.open')}
          </Button>
        }
      >
        {t('pages.plans.empty.body')}
      </EmptyState>
    ) : (
      <EmptyState
        icon={FolderOpen}
        title={t('jobs.noProject')}
        action={
          <Button variant="primary" icon={<Plus size={16} />} onClick={onNewConsole}>
            {t('wall.new')}
          </Button>
        }
      >
        {t('jobs.noProject.hint')}
      </EmptyState>
    )
  } else if (view === 'overlap') {
    body = overlap
  } else if (view === 'main') {
    body = mainPlan
  } else {
    body = (
      <div className="plans-list">
        {areaGroupsOf(listed).map((g) => (
          <Fragment key={g.area}>
            <h2 className="plans-group">
              <span>{g.area || t('pages.plans.noArea')}</span>
              {g.folders.length > 0 && <span className="plans-group__folders">{g.folders.join(' · ')}</span>}
            </h2>
            {g.rows.map((row: JobRow) => (
              <PlanRow key={row.id} row={row} acts={acts} nowMs={clockFor(row, nowMs)} nameOf={nameOf} />
            ))}
          </Fragment>
        ))}
      </div>
    )
  }

  return (
    <>
      {header}
      <div className="plans-body">
        {stallLine}
        {screen === 'runs' && <Coordinator rows={runs} onOpen={acts.onOpen} />}
        {body}
      </div>
    </>
  )
}
