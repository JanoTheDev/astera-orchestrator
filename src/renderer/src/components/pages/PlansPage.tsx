// W9-C Plans page (DESIGN.md §2 "Plans"), drawn natively since W11 (DESIGN-W11 §7, §9 "Plans / Plan"): the project's
// plans "By area" (Job.areas) or as the "Overlap" table (plans × folders), the coordinator strip of the live plans above
// them, and a plan's own page (PlanPage, which RunDetail's window became). The order, the groups and the table are
// planBoard.ts's; the strip is coordinator.ts's. JobsView (the old cards) stays only for a paired Runtime's plans.
import { useEffect, useState } from 'react'
import { Archive, ArchiveRestore, CalendarClock, ChevronDown, ChevronRight, Hand, ListChecks, MoreHorizontal, Pencil, PlayCircle, Plus, RotateCw, SlidersHorizontal, Trash2, Pause, Play, ServerOff } from 'lucide-react'
import type { JobRow, OrchHostGate, OrchSnapshot } from '../../../../core/types'
import type { PageId } from '../../../../core/ui/pages'
import { findRun } from '../../../../core/orchestration/snapshot'
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import { parentDir, resolveRelative } from '../../../../core/files/paths'
import { runningCount } from '../../../../core/orchestration/running'
import { schedRuleSummary } from '../../../../core/scheduler/summary'
import type { AppState } from '../../state/appState'
import { localDoor } from '../../lib/orchDoor'
import { archiveJob, deleteRun, holdJob, renameJob, unarchiveJob } from '../../lib/jobActions'
import { jobName } from '../../lib/jobName'
import { useI18n } from '../../i18n/I18nProvider'
import { jobsStall, jobsViewScreen, type JobsStall } from '../../../../core/orchestration/jobsView'
import { Button, Card, Chip, EmptyState, IconButton, Menu, PageHeader, Tabs, Tooltip, type ChipTone, type MenuItem } from '../ui'
import { openPage } from '../shell/navigation'
import { RunIcon, type RunIconKind } from '../JobIcons'
import { SourceChip } from '../SourceChip'
import { ProjectDelivery } from '../delivery/ProjectDelivery'
import { ageOf, areaGroupsOf, overlapTableOf, planListOrder, planSectionOf, type OverlapCell, type PlanSection } from '../plan/planBoard'
import { approveSlot } from '../plan/planTalk'
import { coordinatorOf, isLive, stateOf, type CoordinatorCard, type LiveState } from '../plan/coordinator'
import { PlanPage } from './PlanPage'
import '../plan/plan.css'
import '../plan/plans.css'

/** Which of W9-C's pages shows: W9-B's page (state/useSidebar.ts `page`) when it is one of them. `section` is the
 *  plan section asked for by `openPlan(jobId, section)`; absent, the one last used for that plan. */
export type PlanPages = { page: 'tasks' | 'plans'; section?: PlanSection } | null

/** The page state over W9-B's page switch, and the plans page coming up whenever a plan is opened from anywhere
 *  (`openRun`). Setting null leaves for Agents (the consoles the plan page's tab links go to). */
export function usePlanPages({ openRun, page, goPage }: {
  openRun: { runId: string; runtimeId?: string } | null
  page: PageId
  goPage: (id: PageId) => void
}): {
  planPage: PlanPages
  setPlanPage: (next: PlanPages) => void
} {
  const [section, setSection] = useState<PlanSection | undefined>(undefined)
  const planPage: PlanPages =
    page === 'plans' || page === 'tasks' ? { page, ...(section !== undefined ? { section } : {}) } : null
  const setPlanPage = (next: PlanPages): void => {
    setSection(next?.section)
    goPage(next ? next.page : 'agents')
  }
  const opened = openRun ? `${openRun.runtimeId ?? ''}:${openRun.runId}` : null
  useEffect(() => {
    if (opened) goPage('plans')
  }, [opened]) // eslint-disable-line react-hooks/exhaustive-deps
  return { planPage, setPlanPage }
}

const SECTION_KEY = (jobId: string): string => `cm.planSection.${jobId}`

/** The section last used for a plan (DESIGN.md: "the last one used is remembered per plan"). */
export function storedSection(jobId: string): PlanSection {
  try {
    return planSectionOf(localStorage.getItem(SECTION_KEY(jobId)))
  } catch {
    return 'overview'
  }
}

function storeSection(jobId: string, section: PlanSection): void {
  try {
    localStorage.setItem(SECTION_KEY(jobId), section)
  } catch {
    /* no storage: the plan opens on Overview next time */
  }
}

type View = 'area' | 'overlap'
type T = ReturnType<typeof useI18n>['t']

export type PlansPageProps = Pick<
  AppState,
  | 'actionUi' | 'approve' | 'hostDriver' | 'hostStatus' | 'orchHostGate' | 'parkedSinceMs' | 'pauseScheduleRun' | 'restartCoordinator' | 'resumeScheduleRun' | 'currentProject' | 'detail' | 'detailDoor' | 'layout' | 'openLinkedFolder' | 'openRun' | 'orchSnapshot'
  | 'remoteSnapshot' | 'selectWorkbenchTab' | 'setDetail' | 'setJournalPagesFor' | 'openStart' | 'setOpenRun'
  | 'setSourceJobOpen' | 't'
> & ReturnType<typeof usePlanPages>

export function PlansPage(p: PlansPageProps): React.JSX.Element {
  const {
    actionUi, approve, hostDriver, hostStatus, orchHostGate, parkedSinceMs, pauseScheduleRun, restartCoordinator, resumeScheduleRun, currentProject, detail, detailDoor, layout, openLinkedFolder, openRun, orchSnapshot, remoteSnapshot,
    selectWorkbenchTab, setDetail, setJournalPagesFor, openStart, setOpenRun, setSourceJobOpen, planPage,
    setPlanPage
  } = p
  const canOpenSession = (sessionId: string): boolean => !!layout && !!groupOfTab(layout, sessionTab(sessionId))

  if (openRun && detailDoor) {
    const snap = openRun.runtimeId ? remoteSnapshot : orchSnapshot
    const section = planPage?.section ?? storedSection(openRun.runId)
    // Moved from Overlays' RunDetail mount (W9-A), with its comments: the props are the window's, now a page's
    return (
      <div className="plan-pages">
        <PlanPage
          door={detailDoor}
          // 그래프의 노드는 제목·상태·세션을 스냅샷에서 읽는다(detail 의 layers 는 id 뿐이다).
          // 그 Run 이 스냅샷에서 사라졌으면(다른 프로젝트로 갔거나 지워졌다) undefined 다.
          // findRun 인 이유는 위 두 효과와 같다 — 예약 회차는 children 안에 있다(snapshot.ts).
          run={snap ? findRun(snap, openRun.runId) : undefined}
          runtimeId={openRun.runtimeId}
          detail={detail}
          projectPath={openRun.projectPath}
          runId={openRun.runId}
          // the tab tree is the only place that knows whether the worker's tab is still open (JobsView's pair)
          canOpenSession={canOpenSession}
          onOpenSession={(sessionId) => {
            setPlanPage(null) // 탭으로 가면서 닫는다
            selectWorkbenchTab(sessionTab(sessionId))
          }}
          onShowOlderJournal={() =>
            setJournalPagesFor((prev) => ({
              runId: openRun.runId,
              pages: (prev?.runId === openRun.runId ? prev.pages : 1) + 1
            }))
          }
          onClose={() => setOpenRun(null)}
          // W6-E progress view: a plan's affected path, shown in the explorer (its folder, as a folder link is)
          onOpenPath={
            openRun.runtimeId
              ? undefined
              : (rel) => {
                  setPlanPage(null)
                  openLinkedFolder(parentDir(resolveRelative(`${openRun.projectPath}/.`, rel)))
                }
          }
          section={section}
          onSection={(s) => {
            storeSection(openRun.runId, s)
            setPlanPage({ page: 'plans', section: s })
          }}
          plans={snap?.runs ?? []}
          snapshot={snap}
          onOpenConsoles={() => openPage('agents', openRun.runId)}
        />
      </div>
    )
  }

  // The local list the Jobs sidebar drew (Sidebar.tsx), its handlers moved with it; a paired Runtime's plans and its
  // selector are W9-B's Pages.tsx, beside this page
  const local = currentProject ? localDoor(window.api, currentProject) : null
  return (
    <div className="plan-pages">
      <PlansList
        snapshot={orchSnapshot}
        hostGate={orchHostGate}
        // why nothing moves (limit L3): a held Host, a Host that does not answer
        stall={jobsStall({ hostStatus, driver: hostDriver, parkedSinceMs, nowMs: Date.now() })}
        projectPath={currentProject ?? undefined}
        canOpenSession={canOpenSession}
        onOpenSession={(sessionId) => {
          setPlanPage(null)
          selectWorkbenchTab(sessionTab(sessionId))
        }}
        onOpenRun={(runId) => {
          setDetail(null) // 이전 Run 의 상세가 한 프레임 보이지 않게 한다
          setPlanPage({ page: 'plans' })
          if (currentProject) setOpenRun({ projectPath: currentProject, runId })
        }}
        // T2: one create page — New job opens Start, as New / Ctrl+N does
        onNewRun={() => currentProject && openStart({})}
        onNewFromSource={() => currentProject && setSourceJobOpen(currentProject)}
        onPauseRun={pauseScheduleRun}
        onResumeRun={resumeScheduleRun}
        onRestartCoordinator={restartCoordinator}
        onApprove={(runId) => local && approve(local, orchSnapshot, runId, actionUi)}
        onDeleteRun={(runId) => local && void deleteRun(local, orchSnapshot, runId, actionUi)}
        onRenameJob={(jobId, title) => local && void renameJob(local, jobId, title, actionUi)}
        onArchiveJob={(jobId) => local && void archiveJob(local, orchSnapshot, jobId, actionUi)}
        onUnarchiveJob={(jobId) => local && void unarchiveJob(local, jobId, actionUi)}
        onHoldJob={(jobId, hold) => local && void holdJob(local, jobId, hold, actionUi)}
      />
    </div>
  )
}

/** What a row can do. Destructive ones (delete, archive) confirm in lib/jobActions. */
export interface PlanActs {
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  onOpenRun: (runId: string) => void
  onPauseRun: (runId: string) => void
  onResumeRun: (runId: string) => void
  onRestartCoordinator: (runId: string) => void
  onApprove: (runId: string) => void
  onDeleteRun: (runId: string) => void
  onRenameJob: (jobId: string, title: string) => void
  onArchiveJob: (jobId: string) => void
  onUnarchiveJob: (jobId: string) => void
  onHoldJob: (jobId: string, hold: boolean) => void
}

export type PlansListProps = PlanActs & {
  snapshot: OrchSnapshot | null
  hostGate: OrchHostGate | null
  stall: JobsStall | null
  /** The open project; absent, there is nothing to list or create. */
  projectPath?: string
  onNewRun: () => void
  onNewFromSource: () => void
}

/** The Plans list page: header, coordinator strip, then the plans by area or the Overlap table. */
export function PlansList(p: PlansListProps): React.JSX.Element {
  const { t } = useI18n()
  const { snapshot, hostGate, stall, projectPath } = p
  const [view, setView] = useState<View>('area')
  // W1-C: archived plans are hidden until asked for. Not remembered: the list opens on the plans that work.
  const [showArchived, setShowArchived] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const screen = jobsViewScreen({ hostGate, snapshot })
  const runs = planListOrder(snapshot?.runs ?? [])
  const archivedCount = runs.filter((r) => r.archivedAt !== undefined).length
  const listed = showArchived ? runs : runs.filter((r) => r.archivedAt === undefined)
  const strip = coordinatorOf(runs)

  const actions = projectPath !== undefined && (
    <>
      <Button variant="ghost" icon={<ListChecks size={16} />} onClick={p.onNewFromSource}>
        {t('jobs.source.open')}
      </Button>
      <Button variant="primary" icon={<Plus size={16} />} onClick={p.onNewRun}>
        {t('jobs.new.open')}
      </Button>
    </>
  )
  const filters = screen === 'runs' && (
    <>
      <Tooltip content={t('pages.plans.viewHint')}>
        <Tabs<View>
          variant="segmented"
          label={t('pages.plans.title')}
          value={view}
          onChange={setView}
          items={[
            { id: 'area', label: t('pages.plans.byArea') },
            { id: 'overlap', label: t('pages.plans.overlap') }
          ]}
        />
      </Tooltip>
      {archivedCount > 0 && (
        <Button variant="ghost" size="sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? t('jobs.lifecycle.hideArchived') : t('jobs.lifecycle.showArchived', { count: archivedCount })}
        </Button>
      )}
      {projectPath !== undefined && (
        // DESIGN-W11 §7: "When a plan is done" is not about browsing, so it sits behind View options
        <span className="plans-options">
          <IconButton icon={<SlidersHorizontal size={16} />} label={t('pages.plans.viewOptions')} active={optionsOpen} aria-expanded={optionsOpen} onClick={() => setOptionsOpen((v) => !v)} />
          {optionsOpen && (
            <div className="plans-options-pop" role="dialog" aria-label={t('pages.plans.viewOptions')} onKeyDown={(e) => e.key === 'Escape' && setOptionsOpen(false)}>
              <ProjectDelivery projectPath={projectPath} />
            </div>
          )}
        </span>
      )}
    </>
  )

  // 아무것도 움직이지 않는 까닭(한도 L3): the list and the empty state both show it, a new Job will not move either
  const stallLine = stall && (
    <p className="plans-stall" role="status">
      {stall.kind === 'unresponsive'
        ? t('jobs.stall.unresponsive')
        : stall.kind === 'reading'
          ? t('jobs.stall.reading')
          : t('jobs.stall.parked', { reason: t(stall.gate === 'unreadable' ? 'jobs.stall.gate.unreadable' : 'jobs.stall.gate.notMigrated') })}
    </p>
  )

  let body: React.ReactNode
  if (screen === 'host' && hostGate) {
    // The Host is why there is nothing (host control plane design §6): saying so is the whole point of this state
    const waiting = hostGate.state === 'waiting'
    body = (
      <EmptyState icon={ServerOff} title={t(waiting ? 'jobs.host.waiting' : 'jobs.host.unreachable')}>
        {t('jobs.host.features')}
        {!waiting && hostGate.reason && <span className="plans-empty-line">{t('jobs.host.reason', { reason: hostGate.reason })}</span>}
        {!waiting && <span className="plans-empty-line">{t('jobs.host.retry')}</span>}
        {!waiting && <span className="plans-empty-line">{t('jobs.host.log', { path: hostGate.logPath })}</span>}
      </EmptyState>
    )
  } else if (screen === 'blank' || snapshot === null) {
    // Before the first orch.list answer nothing is known: no empty state flashing "no jobs" on a project switch
    body = null
  } else if (screen === 'empty' || projectPath === undefined) {
    body = (
      <>
        {stallLine}
        {projectPath !== undefined ? (
          <EmptyState icon={ListChecks} title={t('jobs.empty')} action={<Button variant="primary" icon={<Plus size={16} />} onClick={p.onNewRun}>{t('jobs.new.open')}</Button>}>
            {t('jobs.empty.hint')}
          </EmptyState>
        ) : (
          <EmptyState icon={ListChecks} title={t('jobs.noProject')}>
            {t('jobs.noProject.hint')}
          </EmptyState>
        )}
      </>
    )
  } else {
    body = (
      <>
        {stallLine}
        {strip.length > 0 && <CoordinatorStrip cards={strip} t={t} onOpen={p.onOpenRun} />}
        {view === 'overlap' ? (
          <OverlapTable rows={runs} t={t} onOpen={p.onOpenRun} />
        ) : (
          areaGroupsOf(listed).map((g) => (
            <section key={g.area} className="plans-group" aria-label={g.area || t('pages.plans.noArea')}>
              <h2 className="plans-group-head">
                <span>{g.area || t('pages.plans.noArea')}</span>
                {g.folders.length > 0 && <span className="plans-group-folders">{g.folders.join(' · ')}</span>}
              </h2>
              {g.rows.map((r) => (
                <PlanRow key={r.id} run={r} rows={runs} acts={p} t={t} />
              ))}
            </section>
          ))
        )}
      </>
    )
  }
  return (
    <div className="plans-page">
      <PageHeader
        title={t('pages.plans.title')}
        subtitle={screen === 'runs' ? t('pages.plans.count', { count: runs.length - archivedCount }) : undefined}
        actions={actions || undefined}
        filters={filters || undefined}
      />
      <div className="plans-body">{body}</div>
    </div>
  )
}

const STATE_TONE: Record<LiveState, ChipTone> = {
  planning: 'neutral', approval: 'warn', queued: 'neutral', running: 'info', paused: 'neutral', 'needs-you': 'warn', failed: 'danger'
}

/** The live plans side by side: state, wave, workers and what each waits on (coordinator.ts). */
function CoordinatorStrip({ cards, t, onOpen }: { cards: CoordinatorCard[]; t: T; onOpen: (id: string) => void }): React.JSX.Element {
  return (
    <div className="plans-strip" role="list" aria-label={t('pages.plans.live')}>
      {cards.map((c) => (
        <div key={c.id} role="listitem" className="plans-strip-item">
          <Card onClick={() => onOpen(c.id)} className="plans-coord" title={c.name}>
            <span className="plans-coord-name">{c.name}</span>
            <span className="plans-coord-meta">
              <Chip tone={STATE_TONE[c.state]} dot>
                {t(`pages.plans.state.${c.state}`)}
              </Chip>
              {c.wave && <span>{t('pages.plans.wave', { n: c.wave.n, m: c.wave.m })}</span>}
              {c.working > 0 && <span>{t('pages.plans.working', { n: c.working })}</span>}
            </span>
            {c.waits.map((w) => (
              <span key={w.planId} className="plans-coord-wait">
                {t(w.kind === 'lease' ? 'pages.plans.waitLease' : 'pages.plans.waitFiles', { plan: w.plan, path: w.path })}
              </span>
            ))}
            {c.after && <span className="plans-coord-wait">{t('pages.plans.startsAfter', { plan: c.after.plan })}</span>}
            {c.overlaps.map((o) => (
              <span key={o.id} className={`plans-coord-wait${c.decide ? ' plans-coord-decide' : ''}`}>
                {t(c.decide ? 'pages.plans.decide' : 'pages.plans.overlaps', { plan: o.plan })}
              </span>
            ))}
          </Card>
        </div>
      ))}
    </div>
  )
}

/** The row's glyph, as the old card head chose it: a gate beats the plan's own outcome. */
const runKind = (run: JobRow): RunIconKind =>
  run.tasks.some((tk) => tk.status === 'blocked') ? 'blocked' : run.outcome === 'running' ? 'running' : run.outcome === 'failed' ? 'failed' : 'done'

const RUN_KIND_KEY = { running: 'jobs.run.running', blocked: 'jobs.state.blocked', done: 'jobs.state.completed', failed: 'jobs.state.failed' } as const

/** Rounds of a template drawn at once; "more" adds this many (JobsView's ROUNDS_PAGE). */
const ROUNDS_PAGE = 5
/** Working rows under a plan before the rest fold into "+n" (JobsView's MAX_ROWS). */
const MAX_WORKERS = 3

const fmtNext = (ms: number): string => new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** One plan: a 36px row (glyph, name, chips, progress, inline actions, overflow), then the lines that call for a person
 *  (gates, overlaps before approval) and the workers working now. A schedule template or a re-run Job lists its rounds. */
function PlanRow({ run, rows, acts, t, ordinal }: { run: JobRow; rows: readonly JobRow[]; acts: PlanActs; t: T; ordinal?: number }): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(ROUNDS_PAGE)
  const top = ordinal === undefined
  const template = run.schedule !== undefined || (run.children?.length ?? 0) > 0
  const kids = run.children ?? []
  const kind = runKind(run)
  const nameOf = (id: string): string => {
    const r = rows.find((x) => x.id === id)
    return r ? jobName(r) : id
  }
  const slot = approveSlot(run)
  const live = top && !template && isLive(run)
  // W5-C: a schedule pauses as a whole, and a plan not started has nothing to launch yet
  const holdable = top && run.archivedAt === undefined && !run.schedule && !run.pendingStart
  const menu: Array<MenuItem | 'separator'> = [
    ...(top ? [{ id: 'rename', label: t('jobs.lifecycle.rename'), icon: <Pencil size={14} />, onSelect: () => setRenaming(true) }] : []),
    ...(holdable
      ? [run.dispatchHold
          ? { id: 'release', label: t('jobs.hold.release'), icon: <PlayCircle size={14} />, onSelect: () => acts.onHoldJob(run.id, false) }
          : { id: 'hold', label: t('jobs.hold.hold'), icon: <Hand size={14} />, onSelect: () => acts.onHoldJob(run.id, true) }]
      : []),
    ...(top
      ? [run.archivedAt !== undefined
          ? { id: 'unarchive', label: t('jobs.lifecycle.unarchive'), icon: <ArchiveRestore size={14} />, onSelect: () => acts.onUnarchiveJob(run.id) }
          : { id: 'archive', label: t('jobs.lifecycle.archive'), icon: <Archive size={14} />, onSelect: () => acts.onArchiveJob(run.id) }]
      : []),
    ...(top ? ['separator' as const] : []),
    { id: 'delete', label: t('jobs.run.delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => acts.onDeleteRun(run.id) }
  ]
  const working = run.tasks.filter((tk) => tk.startedAt !== undefined && tk.provider !== undefined)
  const gates = run.tasks.filter((tk) => tk.status === 'blocked' && tk.gate)
  const running = runningCount(run.tasks)
  return (
    <div className={`plans-item${run.archivedAt !== undefined ? ' is-archived' : ''}${top ? '' : ' is-round'}`}>
      <div className="plans-row">
        {template && (
          <IconButton size="sm" icon={open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} label={t('pages.plans.rounds')} aria-expanded={open} onClick={() => setOpen((v) => !v)} />
        )}
        {renaming ? (
          <input
            className="plans-rename"
            autoFocus
            defaultValue={jobName(run)}
            placeholder={t('jobs.lifecycle.titlePlaceholder')}
            aria-label={t('jobs.lifecycle.rename')}
            onKeyDown={(e) => {
              // An Enter that ends a Korean or Japanese composition is the IME's, not a save
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                acts.onRenameJob(run.id, e.currentTarget.value)
                setRenaming(false)
              } else if (e.key === 'Escape') setRenaming(false)
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <button type="button" className="plans-row-main" title={run.objective} onClick={() => acts.onOpenRun(run.id)}>
            {template ? <CalendarClock size={14} aria-hidden="true" /> : <RunIcon kind={kind} label={t(RUN_KIND_KEY[kind])} />}
            {ordinal !== undefined && <Chip>{t('jobs.run.scheduleOrdinal', { n: ordinal })}</Chip>}
            <span className={`plans-row-name${kind === 'done' && !template ? ' is-done' : ''}`}>{jobName(run)}</span>
            {live && (
              <Chip tone={STATE_TONE[stateOf(run)]} dot>
                {t(`pages.plans.state.${stateOf(run)}`)}
              </Chip>
            )}
            {run.archivedAt !== undefined && <Chip>{t('jobs.lifecycle.archived')}</Chip>}
            {run.archivedAt === undefined && run.dispatchHold && <Chip>{t('jobs.hold.held')}</Chip>}
            {run.schedule && <Chip>{t('jobs.run.scheduled')}</Chip>}
            {run.after !== undefined && run.pendingStart && <Chip>{t('pages.plans.startsAfter', { plan: nameOf(run.after) })}</Chip>}
            {(run.overlapPlans ?? []).map((id) => (
              <Chip key={id} tone="warn">
                {t('pages.plans.overlaps', { plan: nameOf(id) })}
              </Chip>
            ))}
            {run.paused && !run.schedule && <Chip>{t('jobs.run.roundStopped')}</Chip>}
            {run.sharesProjectFolder && <Chip tone="warn">{t('jobs.run.sharedFolder')}</Chip>}
            {slot === 'auto' && <Chip>{t('jobs.run.startsByItself')}</Chip>}
          </button>
        )}
        {/* The ticket the Job was made from (plugin Phase 4 J18): a link of its own, so outside the open button */}
        <SourceChip source={run.source} />
        <span className="plans-row-meta">
          {template ? (
            <>
              {run.schedule && <span>{schedRuleSummary(t, run.schedule)}</span>}
              {run.paused ? <span>{t('jobs.run.paused')}</span> : run.nextFireAt !== undefined && <span>{t('jobs.run.scheduleNext', { time: fmtNext(run.nextFireAt) })}</span>}
              <span>{t('jobs.run.scheduleRuns', { count: run.fireCount ?? 0 })}</span>
            </>
          ) : (
            <>
              {run.total > 0 && <span className="plans-num">{`${run.done}/${run.total}`}</span>}
              {run.createdAt !== undefined && <span>{t('pages.plans.age', { age: ageOf(run.createdAt, Date.now()) })}</span>}
            </>
          )}
        </span>
        {slot === 'approve' && !template && (
          <Button size="sm" title={t('jobs.run.approveHint')} onClick={() => acts.onApprove(run.id)}>
            {t('jobs.run.approve')}
          </Button>
        )}
        {run.coordinatorMissing && !template && (
          <IconButton size="sm" icon={<RotateCw size={14} />} label={t('jobs.run.coordinatorRestart')} title={t('jobs.run.coordinatorRestartHint')} onClick={() => acts.onRestartCoordinator(run.id)} />
        )}
        {run.schedule && (
          <IconButton
            size="sm"
            icon={run.paused ? <Play size={14} /> : <Pause size={14} />}
            label={run.paused ? t('jobs.run.resume') : t('jobs.run.pause')}
            title={run.paused ? t('jobs.run.resumeHint') : t('jobs.run.pauseHint')}
            onClick={() => (run.paused ? acts.onResumeRun(run.id) : acts.onPauseRun(run.id))}
          />
        )}
        <Menu label={t('pages.plans.more')} align="end" trigger={{ icon: <MoreHorizontal size={16} />, size: 'sm', variant: 'ghost' }} items={menu} />
      </div>
      {/* A gate stays in sight: it waits on a person, and a hidden one stops the plan with nobody knowing */}
      {gates.map((tk) => (
        <p key={tk.id} className="plans-line plans-line--gate">
          {tk.gate?.question}
          {tk.openGates > 1 ? ` ${t('jobs.gates.more', { count: tk.openGates - 1 })}` : ''}
        </p>
      ))}
      {/* W8-D: before approval, one line per overlap with another plan of this project */}
      {run.pendingStart &&
        (run.overlaps ?? []).map((line) => (
          <p key={line} className="plans-line" title={t('jobs.run.overlapsHint')}>
            {t('jobs.run.overlaps')}: {line}
          </p>
        ))}
      {working.slice(0, MAX_WORKERS).map((tk) => {
        // the row's look and its click come from the same value, or it looks clickable and does nothing
        const sessionId = tk.sessionId && acts.canOpenSession(tk.sessionId) ? tk.sessionId : undefined
        return sessionId ? (
          <button key={tk.id} type="button" className="plans-line plans-worker" onClick={() => acts.onOpenSession(sessionId)}>
            {tk.provider} · {tk.title}
          </button>
        ) : (
          <p key={tk.id} className="plans-line plans-worker">
            {tk.provider} · {tk.title}
          </p>
        )
      })}
      {running > Math.min(working.length, MAX_WORKERS) && <p className="plans-line plans-worker">+{running - Math.min(working.length, MAX_WORKERS)}</p>}
      {open && template && (
        <div className="plans-rounds">
          {kids.length === 0 ? (
            <p className="plans-line">{t(run.pendingStart ? 'jobs.run.schedulePending' : 'jobs.run.scheduleEmpty')}</p>
          ) : (
            <>
              {kids.slice(0, shown).map((kid) => (
                <PlanRow key={kid.id} run={kid} rows={rows} acts={acts} t={t} ordinal={kid.fireOrdinal ?? 1} />
              ))}
              {kids.length > shown && (
                <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + ROUNDS_PAGE)}>
                  {t('jobs.run.scheduleMore', { count: Math.min(ROUNDS_PAGE, kids.length - shown) })}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** "Overlap": plans × top folders, a folder two plans still work in highlighted. */
function OverlapTable({ rows, t, onOpen }: { rows: readonly JobRow[]; t: T; onOpen: (jobId: string) => void }): React.JSX.Element {
  const table = overlapTableOf(rows)
  if (table.folders.length === 0) return <p className="plans-line">{t('pages.plans.noFolders')}</p>
  const cellText = (c: OverlapCell): string =>
    c === null ? '' : c.kind === 'editing' ? t('pages.plans.cell.editing', { task: c.task }) : t(`pages.plans.cell.${c.kind}`)
  return (
    <div className="plans-overlap">
      <table>
        <thead>
          <tr>
            <th scope="col">{t('pages.plans.title')}</th>
            {table.folders.map((f) => (
              <th key={f} scope="col" className={table.shared.has(f) ? 'shared' : undefined} title={table.shared.has(f) ? t('pages.plans.sharedHint') : undefined}>
                {f}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map(({ row, cells }) => (
            <tr key={row.id}>
              <th scope="row">
                <button type="button" className="plans-row-main" onClick={() => onOpen(row.id)}>
                  {jobName(row)}
                </button>
              </th>
              {cells.map((c, i) => (
                <td key={table.folders[i]} className={`${c?.kind ?? 'none'}${table.shared.has(table.folders[i]) && c ? ' shared' : ''}`}>
                  {cellText(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
