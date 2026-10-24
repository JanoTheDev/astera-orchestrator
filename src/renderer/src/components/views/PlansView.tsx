// T7 Plans side bar view (DESIGN-W13 §4 "Plans"): the tree Plan › Step › Task (plan/planTree.ts builds the rows), grouped
// by plan, Task status or area, in two panes: Running on top, Finished below (newest finished first, Clear finished, Show archived). Every plan action is on its row's context menu
// (lib/jobActions, as the old list rows wired them). A paired Runtime's plans keep their selector and list (JobsView).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JobRow } from '../../../../core/types'
import { jobsStall, jobsViewScreen } from '../../../../core/orchestration/jobsView'
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import { Badge, Button, Icon, IconButton, Input, Menu, Tree, ViewContainer, ViewPane, menuPointOf, type ChipTone, type IconName, type MenuItem, type TreeItem, type TreeProps } from '../ui'
import { RuntimeSelector } from '../RuntimeSelector'
import { JobsView } from '../JobsView'
import { STATE_KEY, TaskGlyph } from '../JobIcons'
import { controlReason, isRemoteRuntime, offlineNote } from '../../lib/remoteJobs'
import { localDoor, replyNote } from '../../lib/orchDoor'
import { jobName } from '../../lib/jobName'
import { toast } from '../../lib/toast'
import { archiveJob, archiveJobs, deleteRun, holdJob, pauseRun, restartCoordinator as restartRunCoordinator, resolveFailed, resumeRun, unarchiveJob } from '../../lib/jobActions'
import { openConsole, openPlanConsoles, openView } from '../shell/navigation'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { OLD_FINISHED_DAYS, clearableOf, isStalledPlan, planStatusOf, resumeActionOf, splitPlans } from '../plan/planList'
import { approveSlot } from '../plan/planTalk'
import { deliveryActionsOf } from '../plan/planPage'
import { type PlanSection } from '../plan/planBoard'
import {
  GROUP_BYS,
  groupByOf,
  finishedDescription,
  groupCount,
  needsYouOf,
  openByDefault,
  overlapOf,
  pauseActionOf,
  planDescription,
  planTreeRows,
  taskDescription,
  taskSection,
  type GroupBy,
  type PlanNode,
  type PlanTreeRow,
  type StatusGroup
} from '../plan/planTree'
import '../plan/plans.css'

const GROUP_KEY = 'cm.plansGroupBy'

function storedGroupBy(): GroupBy {
  try {
    return groupByOf(localStorage.getItem(GROUP_KEY))
  } catch {
    return 'plans'
  }
}

const TONE_ICON: Record<ChipTone, IconName> = { ok: 'done', danger: 'error', warn: 'circleAlert', info: 'active', neutral: 'pending' }
const GROUP_ICON: Record<StatusGroup, { icon: IconName; tone: ChipTone }> = {
  needs: { icon: 'circleAlert', tone: 'warn' },
  running: { icon: 'loading', tone: 'info' },
  waiting: { icon: 'waiting', tone: 'neutral' },
  done: { icon: 'done', tone: 'ok' },
  failed: { icon: 'error', tone: 'danger' }
}
const toned = (name: IconName, tone: ChipTone): React.ReactNode => <Icon name={name} className={`plans-tone--${tone}`} />

export function PlansView(p: SideBarViewProps): React.JSX.Element {
  const { t, pairedRuntimes, jobsRuntime, remoteSnapshot, remoteProject, remoteViewPermission, remoteViewDoor, remoteActionUi } = p
  const runtimeName = pairedRuntimes.find((r) => r.runtimeId === jobsRuntime)?.name ?? jobsRuntime
  const remote = isRemoteRuntime(jobsRuntime)
  return (
    <ViewContainer label={t('shell.activity.plans')} className="plans-view">
      {pairedRuntimes.length > 0 && (
        <div className="plans-view__runtime">
          <RuntimeSelector
            readOnlyReason={controlReason(remoteViewPermission, t as never)}
            paired={pairedRuntimes}
            runtimeId={jobsRuntime}
            onRuntime={p.setJobsRuntime}
            projects={p.remoteProjects}
            project={remoteProject}
            onProject={p.setRemoteProject}
            offline={offlineNote(
              remoteSnapshot?.runtime,
              runtimeName,
              // The last answer this app had (review I4); the pairing time only before any answer.
              remoteSnapshot?.runtime?.lastSeenAt ?? pairedRuntimes.find((r) => r.runtimeId === jobsRuntime)?.lastSeenAt ?? null,
              t as never,
              (iso) => new Date(iso).toLocaleString()
            )}
          />
        </div>
      )}
      {remote ? (
        // A paired Runtime's Jobs, acted on there through its door (Phase 7), disabled with the reason for a
        // read-only pairing.
        <div className="wb-view wb-view--scroll">
          <JobsView
            snapshot={remoteSnapshot}
            hostGate={null}
            stall={null}
            hasProject={remoteProject !== null}
            remote
            disabledReason={controlReason(remoteViewPermission, t as never) ?? undefined}
            newDisabledReason={t('jobs.new.localOnly')}
            canOpenSession={() => false}
            onOpenSession={() => {}}
            onOpenRun={(runId) => {
              p.setDetail(null)
              if (remoteProject) p.setOpenRun({ projectPath: remoteProject, runId, runtimeId: jobsRuntime })
            }}
            onNewRun={() => {}}
            onPauseRun={(runId) => remoteViewDoor && void pauseRun(remoteViewDoor, runId, remoteActionUi)}
            onResumeRun={(runId) => remoteViewDoor && void resumeRun(remoteViewDoor, runId, remoteActionUi)}
            onDeleteRun={(runId) => remoteViewDoor && void deleteRun(remoteViewDoor, remoteSnapshot, runId, remoteActionUi)}
            onRestartCoordinator={(runId) => remoteViewDoor && void restartRunCoordinator(remoteViewDoor, runId, remoteActionUi)}
            onApprove={(runId) => remoteViewDoor && p.approve(remoteViewDoor, remoteSnapshot, runId, remoteActionUi)}
          />
        </div>
      ) : (
        <LocalPlans {...p} />
      )}
    </ViewContainer>
  )
}

/** A Tree whose rows open on a click or Enter (DESIGN-W13 §4); the arrow keys and a right-click only move the
 *  selection, a twistie only toggles, and a double-click's second click opens nothing more. */
function ClickTree({ onActivate, onSelect, ...rest }: TreeProps & { onActivate: (id: string) => void }): React.JSX.Element {
  // how the selection is moving right now: a row click opens, keys do not (Enter opens through onOpen)
  const via = useRef<'click' | 'key' | null>(null)
  return (
    <div
      className="plans-tree__wrap"
      onClickCapture={(e) => (via.current = (e.target as Element).closest('.ui-tree__twistie') ? null : 'click')}
      onKeyDownCapture={() => (via.current = 'key')}
      onContextMenuCapture={() => (via.current = null)}
    >
      <Tree
        {...rest}
        onSelect={(id) => {
          onSelect?.(id)
          if (via.current === 'click') onActivate(id)
          via.current = null
        }}
        // Enter; the double-click that also lands here already opened on its first click
        onOpen={(id) => via.current === 'key' && onActivate(id)}
      />
    </div>
  )
}

type Pane = 'running' | 'finished'
type Ctx = { pane: Pane; id: string; at: { x: number; y: number } }

function LocalPlans(p: SideBarViewProps): React.JSX.Element {
  const { t, orchSnapshot, currentProject, accounts, layout, actionUi } = p
  const [groupBy, setGroupBy] = useState<GroupBy>(storedGroupBy)
  const [filter, setFilter] = useState('')
  // Archived plans are hidden from the Finished pane until asked for
  const [showArchived, setShowArchived] = useState(false)
  // the rows whose open state is not their default (openByDefault)
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [ctx, setCtx] = useState<Ctx | null>(null)
  // "3h ago" to the minute
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const runs = useMemo(() => orchSnapshot?.runs ?? [], [orchSnapshot])
  const split = useMemo(() => splitPlans(runs, showArchived), [runs, showArchived])
  // a group or step id is the same in both panes, so the Finished pane's open state is kept under its own key
  const toggleKey = (pane: Pane, id: string): string => (pane === 'finished' ? `finished|${id}` : id)
  const runningRows = useMemo(
    () => planTreeRows({ rows: split.running, groupBy, filter, showArchived: true, isOpen: (id, node) => toggled.has(id) !== openByDefault(node) }),
    [split.running, groupBy, filter, toggled]
  )
  const finishedRows = useMemo(
    () =>
      planTreeRows({
        rows: split.finished,
        groupBy,
        filter,
        showArchived: true,
        keepOrder: true,
        isOpen: (id, node) => toggled.has(toggleKey('finished', id)) !== openByDefault(node)
      }),
    [split.finished, groupBy, filter, toggled]
  )
  const rowsOf = (pane: Pane): PlanTreeRow[] => (pane === 'running' ? runningRows : finishedRows)
  const byRunning = useMemo(() => new Map(runningRows.map((r) => [r.id, r])), [runningRows])
  const byFinished = useMemo(() => new Map(finishedRows.map((r) => [r.id, r])), [finishedRows])
  const byId = (pane: Pane): Map<string, PlanTreeRow> => (pane === 'running' ? byRunning : byFinished)
  const local = currentProject ? localDoor(window.api, currentProject) : null
  const canOpenSession = (id: string): boolean => !!layout && !!groupOfTab(layout, sessionTab(id))
  const accountLabel = (id: string): string => accounts.find((a) => a.id === id)?.label ?? id

  const chooseGroupBy = (g: GroupBy): void => {
    setGroupBy(g)
    try {
      localStorage.setItem(GROUP_KEY, g)
    } catch {
      /* no storage: the tree opens grouped by plan next time */
    }
  }
  const setOpen = (pane: Pane, row: PlanTreeRow, open: boolean): void =>
    setToggled((prev) => {
      const next = new Set(prev)
      const key = toggleKey(pane, row.id)
      if (open === openByDefault(row.node)) next.delete(key)
      else next.add(key)
      return next
    })
  // every group and step shown closes; the plans opened go back to closed
  const collapseAll = (): void =>
    setToggled(new Set((['running', 'finished'] as const).flatMap((pane) => rowsOf(pane).filter((r) => openByDefault(r.node)).map((r) => toggleKey(pane, r.id)))))

  /** The plan tab, at a section (`settings`, `task-<id>`, as planAnchorOf reads it) or its top. Opens from orchSnapshot
   *  like before (archived plans too), so the section goes to the page state, not navigation's openPlan (workspaceTree). */
  const openPlanTab = (jobId: string, section?: PlanSection): void => {
    if (!currentProject) return
    p.setDetail(null) // the previous plan's detail never shows for a frame
    p.setPlanPage({ page: 'plans', ...(section !== undefined ? { section } : {}) })
    p.setOpenRun({ projectPath: currentProject, runId: jobId })
  }
  /** DESIGN-W13 §10: a Task opens its console when one runs for it, else its plan tab scrolled to it. */
  const openTask = (row: JobRow, taskId: string, sessionId?: string): void => {
    if (sessionId && canOpenSession(sessionId)) openConsole(sessionId)
    else openPlanTab(row.id, taskSection(taskId))
  }
  const activate = (pane: Pane, id: string): void => {
    const row = byId(pane).get(id)
    if (!row) return
    const n = row.node
    if (n.kind === 'plan') openPlanTab(n.row.id)
    else if (n.kind === 'task') openTask(n.row, n.task.id, n.task.sessionId)
    else setOpen(pane, row, !row.expanded)
  }

  /** Clear finished: one confirm, then every finished plan older than OLD_FINISHED_DAYS (or all of them) is archived, never deleted. */
  const clearFinished = async (): Promise<void> => {
    if (!local) return
    const old = clearableOf(runs, false, Date.now()).length
    const all = clearableOf(runs, true, Date.now()).length
    if (all === 0) {
      toast.info(t('pages.plans.clearFinished.none'))
      return
    }
    const answer = await actionUi.confirmChoices({
      title: t('pages.plans.clearFinished'),
      body: t('pages.plans.clearFinished.body', { old, all, days: OLD_FINISHED_DAYS }),
      confirmLabel: t('jobs.lifecycle.archive'),
      choices: [
        { id: 'all', label: t('pages.plans.clearFinished.all', { days: OLD_FINISHED_DAYS }) },
        { id: 'kill', label: t('pages.plans.clearFinished.kill'), hint: t('jobs.lifecycle.archiveKillHint') }
      ]
    })
    if (!answer.ok) return
    const ids = clearableOf(runs, answer.checked.includes('all'), Date.now()).map((r) => r.id)
    if (ids.length === 0) {
      toast.info(t('pages.plans.clearFinished.none'))
      return
    }
    const { archived, failed } = await archiveJobs(local, ids, answer.checked.includes('kill'))
    if (failed > 0) toast.error(t('pages.plans.clearFinished.failed', { n: failed }) + (archived > 0 ? ` · ${t('pages.plans.clearFinished.done', { n: archived })}` : ''))
    else toast.success(t('pages.plans.clearFinished.done', { n: archived }))
  }

  const retryDelivery = async (row: JobRow): Promise<void> => {
    if (!local || !row.delivery) return
    try {
      const reply = await local.command('run-deliver', { run: row.delivery.runId, force: true })
      if (reply.status >= 400) toast.error(t('plan.delivery.retryFailed', { reason: replyNote(reply, t as never, t('jobs.node.failed')) }))
      else toast.success(t('plan.delivery.delivered'))
    } catch {
      toast.error(t('jobs.node.failed'))
    }
  }

  const planMenu = (row: JobRow): Array<MenuItem | 'separator'> => {
    const archived = row.archivedAt !== undefined
    const pause = pauseActionOf(row)
    const delivery = row.delivery?.state === 'pending' ? undefined : row.delivery
    const item = (id: string, label: string, icon: IconName, onSelect: () => void, danger?: boolean): MenuItem => ({
      id,
      label,
      icon: <Icon name={icon} />,
      onSelect,
      ...(danger ? { danger } : {})
    })
    return [
      item('open', t('pages.plans.tree.menu.open'), 'open', () => openPlanTab(row.id)),
      item('consoles', t('pages.plans.tree.menu.consoles'), 'terminal', () => openPlanConsoles(row.id)),
      item('settings', t('pages.plans.tree.menu.settings'), 'settings', () => openPlanTab(row.id, 'settings')),
      'separator',
      ...(approveSlot(row) === 'approve' && local ? [item('approve', t('jobs.run.approve'), 'check', () => p.approve(local, orchSnapshot, row.id, actionUi))] : []),
      ...(pause === 'pause-schedule' ? [item('pause', t('jobs.run.pause'), 'pause', () => p.pauseScheduleRun(row.id))] : []),
      ...(pause === 'resume-schedule' ? [item('resume', t('jobs.run.resume'), 'run', () => p.resumeScheduleRun(row.id))] : []),
      ...(pause === 'hold' && local ? [item('pause', t('jobs.run.pause'), 'pause', () => void holdJob(local, row.id, true, actionUi))] : []),
      ...(pause === 'release' && local ? [item('resume', t('jobs.run.resume'), 'run', () => void holdJob(local, row.id, false, actionUi))] : []),
      ...(row.coordinatorMissing ? [item('coord', t('pages.plans.restartLead'), 'reset', () => p.restartCoordinator(row.id))] : []),
      ...(delivery && deliveryActionsOf({ delivery }).retry && delivery.state !== 'delivering'
        ? [item('deliver', t('plan.delivery.retry'), 'rerun', () => void retryDelivery(row))]
        : []),
      ...(local && archived ? [item('unarchive', t('jobs.lifecycle.unarchive'), 'restore', () => void unarchiveJob(local, row.id, actionUi))] : []),
      ...(local && !archived ? [item('archive', t('jobs.lifecycle.archive'), 'archive', () => void archiveJob(local, orchSnapshot, row.id, actionUi))] : []),
      // lib/jobActions asks before it deletes
      ...(local ? ['separator' as const, item('delete', t('jobs.run.delete'), 'delete', () => void deleteRun(local, orchSnapshot, row.id, actionUi), true)] : [])
    ]
  }
  const taskMenu = (row: JobRow, taskId: string, sessionId?: string): Array<MenuItem | 'separator'> => [
    {
      id: 'console',
      label: t('pages.plans.tree.menu.openConsole'),
      icon: <Icon name="terminal" />,
      disabled: !(sessionId && canOpenSession(sessionId)),
      onSelect: () => sessionId && openConsole(sessionId)
    },
    { id: 'plan', label: t('pages.plans.tree.menu.openInPlan'), icon: <Icon name="listTree" />, onSelect: () => openPlanTab(row.id, taskSection(taskId)) },
    { id: 'copy', label: t('pages.plans.tree.menu.copyId'), icon: <Icon name="copy" />, onSelect: () => window.api.clipboard.writeText(taskId) }
  ]
  // Finished plans keep this same menu; actions that only suit a finished plan are added to planMenu for `archived || done` rows.
  const menuOf = (node: PlanNode): Array<MenuItem | 'separator'> | null =>
    node.kind === 'plan' ? planMenu(node.row) : node.kind === 'task' ? taskMenu(node.row, node.task.id, node.task.sessionId) : null

  const overlapMark = (names: string[] | null): React.ReactNode => {
    if (!names) return null
    const tip = t('pages.plans.tree.overlap', { plans: names.join(', ') })
    return (
      <span className="plans-tree__overlap" title={tip}>
        <Icon name="warning" size={14} label={tip} />
      </span>
    )
  }

  const itemOf = (pane: Pane, shown: readonly JobRow[]) => (r: PlanTreeRow): TreeItem => {
    const base = { id: r.id, depth: r.depth, hasChildren: r.hasChildren, expanded: r.expanded }
    const n = r.node
    if (n.kind === 'group') {
      const status = groupBy === 'status' ? GROUP_ICON[n.key as StatusGroup] : undefined
      return {
        ...base,
        label: status ? t(`pages.plans.tree.status.${n.key as StatusGroup}`) : n.key || t('pages.plans.noArea'),
        icon: status ? toned(status.icon, status.tone) : <Icon name="layers" />,
        badge: <Badge>{groupCount(shown, groupBy, n.key, true)}</Badge>
      }
    }
    if (n.kind === 'step') {
      const tasks = n.row.tasks.filter((x) => x.wave === n.step)
      return {
        ...base,
        label: t('pages.plans.tree.step', { n: n.step + 1 }),
        icon: <Icon name="ordered" />,
        description: t('pages.plans.main.count', { done: tasks.filter((x) => x.status === 'completed').length, total: tasks.length })
      }
    }
    if (n.kind === 'task') {
      const live = n.task.provider !== undefined && !!n.task.sessionId && canOpenSession(n.task.sessionId)
      return {
        ...base,
        label: n.task.title,
        icon: <TaskGlyph task={n.task} size={16} />,
        // grouped by status, the plan says where the Task belongs; elsewhere its parent row does
        description: groupBy === 'status' ? jobName(n.row) : taskDescription(n.task, accountLabel, t),
        // the status as a word beside its icon (colour never stands alone)
        decoration: { text: t(STATE_KEY[n.task.status]), tone: 'neutral' },
        badge: (
          <>
            {overlapMark(overlapOf(n, runs))}
            {live && <Icon name="terminal" size={14} label={t('pages.plans.tree.console')} />}
          </>
        )
      }
    }
    const status = planStatusOf(n.row)
    const needs = needsYouOf(n.row)
    const resume = resumeActionOf(n.row)
    return {
      ...base,
      label: jobName(n.row),
      icon: toned(TONE_ICON[status.tone], status.tone),
      description: pane === 'finished' ? finishedDescription(n.row, nowMs, t) : planDescription(n.row, nowMs, t),
      decoration: { text: t(status.key, status.params), tone: status.tone },
      // A dead plan is one click from archived, or from running again where something can resume it (resumeActionOf)
      ...(local && isStalledPlan(n.row)
        ? {
            actions: (
              <>
                {resume && (
                  <IconButton
                    size="sm"
                    label={t('jobs.run.resume')}
                    icon={<Icon name="run" size={14} />}
                    onClick={() => (resume.kind === 'restart-lead' ? p.restartCoordinator(n.row.id) : void resolveFailed(local, resume.taskId, 'retry', actionUi))}
                  />
                )}
                <IconButton size="sm" label={t('jobs.lifecycle.archive')} icon={<Icon name="archive" size={14} />} onClick={() => void archiveJob(local, orchSnapshot, n.row.id, actionUi)} />
              </>
            )
          }
        : {}),
      badge: (
        <>
          {overlapMark(overlapOf(n, runs))}
          {needs > 0 && (
            <span title={t('pages.plans.tree.needsYou', { n: needs })}>
              <Badge tone="warn">{needs}</Badge>
            </span>
          )}
        </>
      )
    }
  }

  const screen = jobsViewScreen({ hostGate: p.orchHostGate, snapshot: orchSnapshot })
  const stall = jobsStall({ hostStatus: p.hostStatus, driver: p.hostDriver, parkedSinceMs: p.parkedSinceMs, nowMs: Date.now() })
  const groupLabel = (g: GroupBy): string => t(`pages.plans.tree.group.${g}`)

  let body: React.ReactNode
  if (screen === 'host' && p.orchHostGate) {
    // The Host is why there is nothing: saying so is the whole point (with no Host there is no state to read)
    const waiting = p.orchHostGate.state === 'waiting'
    body = (
      <div className="wb-view-pad plans-view__note">
        <p className="wb-view-empty">{t(waiting ? 'pages.plans.host.waiting' : 'pages.plans.host.unreachable')}</p>
        <p className="plans-view__dim">{t('pages.plans.host.features')}</p>
        {!waiting && p.orchHostGate.reason && <p className="plans-view__dim">{t('jobs.host.reason', { reason: p.orchHostGate.reason })}</p>}
      </div>
    )
  } else if (screen === 'blank') {
    // before the first answer: nothing, not an empty state that flashes on every project switch
    body = null
  } else if (!currentProject) {
    // All projects (or a folder no project holds): plans are read one project at a time; New plan asks which one
    body = (
      <div className="wb-view-pad">
        <p className="wb-view-empty">{t('pages.plans.allProjects')}</p>
        <Button variant="primary" size="sm" onClick={() => openView('start')}>
          {t('shell.plans.new')}
        </Button>
      </div>
    )
  } else if (runs.length === 0) {
    // DESIGN-W13 §12 empty view: one sentence, one full-width primary button
    body = (
      <div className="wb-view-pad">
        <p className="wb-view-empty">{t('pages.plans.empty.body')}</p>
        <Button variant="primary" size="sm" onClick={() => openView('start')}>
          {t('shell.plans.new')}
        </Button>
      </div>
    )
  }

  const bar = (
    <div className="plans-tree__bar">
      <Input
        className="plans-tree__filter"
        value={filter}
        placeholder={t('pages.plans.tree.filter')}
        aria-label={t('pages.plans.tree.filter')}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
      />
      <Menu
        label={t('pages.plans.tree.groupBy')}
        align="end"
        trigger={{ icon: <Icon name="listTree" />, size: 'sm', title: `${t('pages.plans.tree.groupBy')}: ${groupLabel(groupBy)}` }}
        items={GROUP_BYS.map((g) => ({ id: g, label: groupLabel(g), checked: g === groupBy, onSelect: () => chooseGroupBy(g) }))}
      />
    </div>
  )
  const treeOf = (pane: Pane, shown: readonly JobRow[], empty: string): React.ReactNode => {
    const rows = rowsOf(pane)
    return rows.length === 0 ? (
      <p className="wb-view-empty">{empty}</p>
    ) : (
      <ClickTree
        className="plans-tree"
        label={t(pane === 'running' ? 'pages.plans.running' : 'pages.plans.finished')}
        rows={rows.map(itemOf(pane, shown))}
        selectedId={selected}
        onSelect={setSelected}
        onActivate={(id) => activate(pane, id)}
        onToggle={(id, open) => {
          const row = byId(pane).get(id)
          if (row) setOpen(pane, row, open)
        }}
        onContextMenu={(id, e) => {
          e.preventDefault()
          const row = byId(pane).get(id)
          if (row && menuOf(row.node)) setCtx({ pane, id, at: menuPointOf(e) })
        }}
      />
    )
  }
  const stallNote = stall && (
    <p className="plans-stall" role="status">
      <Icon name="warning" size={14} />
      {stall.kind === 'unresponsive'
        ? t('pages.plans.stall.unresponsive')
        : stall.kind === 'reading'
          ? t('pages.plans.stall.reading')
          : t('pages.plans.stall.parked', { reason: t(stall.gate === 'unreadable' ? 'jobs.stall.gate.unreadable' : 'jobs.stall.gate.notMigrated') })}
    </p>
  )
  const twoPanes = screen === 'runs' && !!currentProject && runs.length > 0

  const ctxRow = ctx ? byId(ctx.pane).get(ctx.id) : undefined
  const ctxItems = ctxRow ? menuOf(ctxRow.node) : null
  // the row went (a snapshot moved it): its menu goes too, and does not come back with it
  useEffect(() => {
    if (ctx && !ctxRow) setCtx(null)
  }, [ctx, ctxRow])

  return (
    <>
      <ViewToolbar
        label={t('shell.activity.plans')}
        items={[
          // With no project picked the New plan page asks for one (startLogic projectChoice)
          { id: 'new', icon: <Icon name="add" />, label: t('shell.plans.new'), onClick: () => openView('start') },
          {
            id: 'issues',
            icon: <Icon name="issue" />,
            label: t('pages.plans.tree.fromIssues'),
            disabled: !currentProject,
            onClick: () => currentProject && p.setSourceJobOpen(currentProject)
          },
          { id: 'main', icon: <Icon name="target" />, label: t('pages.plans.tree.openMain'), onClick: () => openView('mainplan') },
          { id: 'collapse', icon: <Icon name="collapseAll" />, label: t('pages.plans.tree.collapseAll'), onClick: collapseAll }
        ]}
      />
      {twoPanes ? (
        <>
          <ViewPane title={t('pages.plans.running')} count={split.running.length} storageKey="plans.running">
            {stallNote}
            {bar}
            {treeOf('running', split.running, t('pages.plans.tree.noMatch'))}
          </ViewPane>
          <ViewPane
            title={t('pages.plans.finished')}
            count={split.finished.length}
            storageKey="plans.finished"
            actions={
              <>
                <Menu
                  label={t('pages.plans.tree.showArchived')}
                  align="end"
                  trigger={{ icon: <Icon name="filter" />, size: 'sm', title: t('pages.plans.tree.showArchived') }}
                  items={[{ id: 'archived', label: t('pages.plans.tree.showArchived'), checked: showArchived, onSelect: () => setShowArchived(!showArchived) }]}
                />
                <IconButton size="sm" label={t('pages.plans.clearFinished')} icon={<Icon name="archive" size={14} />} disabled={!local} onClick={() => void clearFinished()} />
              </>
            }
          >
            {/* finished-row actions (Archive, Unarchive, Delete) are planMenu's; a finished-only action goes there */}
            {treeOf('finished', split.finished, filter.trim() === '' ? t('pages.plans.finished.empty') : t('pages.plans.tree.noMatch'))}
          </ViewPane>
        </>
      ) : (
        <ViewPane title={t('pages.plans.title')} storageKey="plans.tree">
          {stallNote}
          {body}
        </ViewPane>
      )}
      {ctx && ctxItems && <Menu at={ctx.at} onClose={() => setCtx(null)} label={t('pages.plans.tree.menu.label')} items={ctxItems} />}
    </>
  )
}
