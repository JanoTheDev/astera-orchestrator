// T7 Plans side bar view (DESIGN-W13 §4 "Plans"): the tree Plan › Step › Task (plan/planTree.ts builds the rows), grouped
// by plan, Task status or area, in three panes: Running on top, Unmerged (ended, PR not landed; Review with AI, Merge PR) then Finished (newest finished first, Clear finished, Show archived). Every plan action is on its row's context menu
// (lib/jobActions, as the old list rows wired them). A paired Runtime's plans keep their selector and list (JobsView).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JobRow, JobTask } from '../../../../core/types'
import { jobsStall, jobsViewScreen } from '../../../../core/orchestration/jobsView'
import { groupOfTab } from '../../../../core/panes/tree'
import { sessionTab } from '../../../../core/panes/tabId'
import { Badge, Button, Icon, IconButton, Input, Menu, Tree, ViewContainer, ViewPane, menuPointOf, type ChipTone, type IconName, type MenuItem, type TreeItem, type TreeProps } from '../ui'
import { RuntimeSelector } from '../RuntimeSelector'
import { JobsView } from '../JobsView'
import { STATE_KEY, TaskGlyph } from '../JobIcons'
import { controlReason, isRemoteRuntime, offlineNote } from '../../lib/remoteJobs'
import { localDoor, replyNote, type CheckPluginRow } from '../../lib/orchDoor'
import { jobName } from '../../lib/jobName'
import { toast } from '../../lib/toast'
import { confirmModal } from '../../lib/confirm'
import { archiveJob, archiveJobs, deleteRun, holdJob, integratePlan, mergePlan, openPlanChat, pauseRun, refreshLead, rejectPlan, renameJob, restartCoordinator as restartRunCoordinator, resolveFailed, resumeRun, resumeStoppedRun, stopRun, unarchiveJob } from '../../lib/jobActions'
import { openConsole, openPlanConsoles, openView } from '../shell/navigation'
import { ViewToolbar, type SideBarViewProps } from '../shell/SideBar'
import { OLD_FINISHED_DAYS, clearableOf, isStalledPlan, isStoppedPlan, planStatusOf, resumeActionOf, isUnmergedPlan, splitPlans } from '../plan/planList'
import { approveSlot, canChat } from '../plan/planTalk'
import { planActionsOf } from '../plan/planHeaderActions'
import { findRunFolder } from '../plan/PlanChanges'
import { useCachedRead } from '../../lib/readCache'
import { planCheckPluginsKey, planRunConfigsKey } from '../plan/planReadKeys'
import { checkChoicesOf } from '../checkText'
import { RenamePlanModal } from '../plan/RenamePlanModal'
import { NewTaskModal } from '../NewTaskModal'
import { askAboutTaskWithToast } from '../plan/planCommands'
import { startCodeReviewWithToast } from '../review/codeReviewSession'
import { doneViewOf } from '../plan/taskDoneView'
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

type Pane = 'running' | 'unmerged' | 'finished'
const PANE_TITLE = { running: 'pages.plans.running', unmerged: 'pages.plans.unmerged', finished: 'pages.plans.finished' } as const
/** How often the view asks GitHub whether the unmerged plans' PRs landed (`runs-pr-sync`). */
const PR_SYNC_MS = 5 * 60_000
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
  // Rename (an input in the dialog) and Add task to step (the plan page's own form) come from the menu
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [adding, setAdding] = useState<{ row: JobRow; deps: string[] } | null>(null)
  // "3h ago" to the minute
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const runs = useMemo(() => orchSnapshot?.runs ?? [], [orchSnapshot])
  const split = useMemo(() => splitPlans(runs, showArchived), [runs, showArchived])
  // a group or step id is the same in every pane, so the lower panes' open state is kept under their own key
  const toggleKey = (pane: Pane, id: string): string => (pane === 'running' ? id : `${pane}|${id}`)
  const runningRows = useMemo(
    () => planTreeRows({ rows: split.running, groupBy, filter, showArchived: true, isOpen: (id, node) => toggled.has(id) !== openByDefault(node) }),
    [split.running, groupBy, filter, toggled]
  )
  const unmergedRows = useMemo(
    () =>
      planTreeRows({
        rows: split.unmerged,
        groupBy,
        filter,
        showArchived: true,
        keepOrder: true,
        isOpen: (id, node) => toggled.has(toggleKey('unmerged', id)) !== openByDefault(node)
      }),
    [split.unmerged, groupBy, filter, toggled]
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
  const rowsOf = (pane: Pane): PlanTreeRow[] => (pane === 'running' ? runningRows : pane === 'unmerged' ? unmergedRows : finishedRows)
  const byRunning = useMemo(() => new Map(runningRows.map((r) => [r.id, r])), [runningRows])
  const byUnmerged = useMemo(() => new Map(unmergedRows.map((r) => [r.id, r])), [unmergedRows])
  const byFinished = useMemo(() => new Map(finishedRows.map((r) => [r.id, r])), [finishedRows])
  const byId = (pane: Pane): Map<string, PlanTreeRow> => (pane === 'running' ? byRunning : pane === 'unmerged' ? byUnmerged : byFinished)
  const local = currentProject ? localDoor(window.api, currentProject) : null
  // Merged PRs leave Unmerged: ask GitHub on mount and every PR_SYNC_MS while the view is up (its errors change nothing)
  useEffect(() => {
    if (!currentProject) return
    const door = localDoor(window.api, currentProject)
    const sync = (): void => void door.command('runs-pr-sync', { projectPath: currentProject }).catch(() => undefined)
    sync()
    const id = setInterval(sync, PR_SYNC_MS)
    return () => clearInterval(id)
  }, [currentProject])
  // the run configs and check plugins the plan page's own new-Task form reads, while this tree's Add task is open
  const adder = adding && local ? local : null
  const configsRead = useCachedRead(adder && adding ? planRunConfigsKey(adder, adding.row.id) : null, async () =>
    (await adder!.runConfigs(adding!.row.id)).filter((c) => c.type !== 'compound').map((c) => ({ id: c.id, name: c.name }))
  )
  const pluginsRead = useCachedRead<CheckPluginRow[]>(adder ? planCheckPluginsKey(adder) : null, () => adder!.checkPlugins())
  const runConfigs = configsRead.data ? checkChoicesOf(configsRead.data, pluginsRead.data ?? (pluginsRead.error ? [] : null), t) : configsRead.error ? [] : null
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
    setToggled(new Set((['running', 'unmerged', 'finished'] as const).flatMap((pane) => rowsOf(pane).filter((r) => openByDefault(r.node)).map((r) => toggleKey(pane, r.id)))))

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

  /** Review with AI: a chat in the plan's repository with the review prompt of its PR, else of its branch against the project's target. */
  const reviewPlan = async (row: JobRow): Promise<void> => {
    if (!local) return
    const fail = (detail: string): void => void toast.error(t('review.code.failed', { detail }))
    try {
      const job = await local.command('jobs-get', { id: row.id })
      const body = job.body as { cwd?: unknown; projectId?: unknown; run?: { delivery?: { branch?: unknown } } } | null
      if (job.status >= 400 || typeof body?.cwd !== 'string') return fail(String((job.body as { error?: unknown } | null)?.error ?? job.status))
      const pr = row.pr
      if (pr?.number !== undefined) {
        await startCodeReviewWithToast(local, { cwd: body.cwd, target: { kind: 'pr', number: pr.number, ...(pr.url ? { url: pr.url } : {}), title: jobName(row) } }, t)
        return
      }
      const head = pr?.branch ?? (typeof body.run?.delivery?.branch === 'string' ? body.run.delivery.branch : undefined)
      if (head === undefined) return fail(row.id)
      const project = typeof body.projectId === 'string' ? await local.command('projects-get', { id: body.projectId }).catch(() => null) : null
      const p = project?.body as { deliveryBranch?: string; defaultBranch?: string } | null
      await startCodeReviewWithToast(local, { cwd: body.cwd, target: { kind: 'branch', base: p?.deliveryBranch ?? p?.defaultBranch ?? 'main', head, title: jobName(row) } }, t)
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    }
  }
  /** Merge PR: the plan page's confirm and toasts, `run-pr-merge` on the plan's folded Run id. */
  const mergePlanPr = async (row: JobRow, method: 'merge' | 'squash' | 'rebase'): Promise<void> => {
    const pr = planActionsOf(row, !!local).mergePr
    if (!pr || !local) return
    const ok = await confirmModal({
      title: t('worktrees.mergePr.title', { number: pr.number ?? '' }),
      body: t('plan.header.mergePrBody', { plan: jobName(row), method: t(`worktrees.act.method.${method}` as never) }),
      confirmLabel: t('worktrees.mergePr.confirm'),
      danger: true
    })
    if (!ok) return
    try {
      const reply = await local.command('run-pr-merge', { run: row.foldedRunId ?? row.id, method })
      if (reply.status >= 400) {
        const error = (reply.body as { error?: unknown } | null)?.error
        toast.error(t('worktrees.mergePr.failed', { reason: replyNote(reply, t as never, typeof error === 'string' ? error : String(reply.status)) }))
      } else toast.success(t('worktrees.mergePr.done', { number: pr.number ?? '' }))
    } catch (err) {
      toast.error(t('worktrees.mergePr.failed', { reason: err instanceof Error ? err.message : String(err) }))
    } finally {
      void window.api.github.refresh({ force: true })
    }
  }

  /** Mark as merged: an Unmerged plan the owner merged where git cannot see it (`run-mark-merged`). */
  const markPlanMerged = async (row: JobRow): Promise<void> => {
    if (!local) return
    const ok = await confirmModal({ title: t('plan.markMerged.title', { plan: jobName(row) }), body: t('plan.markMerged.body', { plan: jobName(row) }), confirmLabel: t('plan.markMerged.confirm') })
    if (!ok) return
    try {
      const reply = await local.command('run-mark-merged', { run: row.foldedRunId ?? row.id })
      if (reply.status >= 400) {
        const error = (reply.body as { error?: unknown } | null)?.error
        toast.error(t('plan.markMerged.failed', { reason: replyNote(reply, t as never, typeof error === 'string' ? error : String(reply.status)) }))
      } else toast.success(t('plan.markMerged.done'))
    } catch (err) {
      toast.error(t('plan.markMerged.failed', { reason: err instanceof Error ? err.message : String(err) }))
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
    const acts = planActionsOf(row, !!local)
    const folderAction = (id: string, label: string, icon: IconName, run: (path: string) => void): MenuItem =>
      item(id, label, icon, () =>
        void findRunFolder(row).then(
          (f) => (f ? run(f.path) : toast.error(t('plan.header.noFolder'))),
          () => toast.error(t('plan.header.noFolder'))
        )
      )
    return [
      item('open', t('pages.plans.tree.menu.open'), 'open', () => openPlanTab(row.id)),
      item('consoles', t('pages.plans.tree.menu.consoles'), 'terminal', () => openPlanConsoles(row.id)),
      item('settings', t('pages.plans.tree.menu.settings'), 'settings', () => openPlanTab(row.id, 'settings')),
      'separator',
      ...(approveSlot(row) === 'approve' && local ? [item('approve', t('jobs.run.approve'), 'check', () => p.approve(local, orchSnapshot, row.id, actionUi))] : []),
      ...(acts.reject && local ? [item('reject', t('plan.talk.reject'), 'close', () => void rejectPlan(local, row.id, jobName(row), '', actionUi), true)] : []),
      ...(pause === 'pause-schedule' ? [item('pause', t('jobs.run.pause'), 'pause', () => p.pauseScheduleRun(row.id))] : []),
      ...(pause === 'resume-schedule' ? [item('resume', t('jobs.run.resume'), 'run', () => p.resumeScheduleRun(row.id))] : []),
      ...(pause === 'hold' && local ? [item('pause', t('jobs.run.pause'), 'pause', () => void holdJob(local, row.id, true, actionUi))] : []),
      ...(pause === 'release' && local ? [item('resume', t('jobs.run.resume'), 'run', () => void holdJob(local, row.id, false, actionUi))] : []),
      ...(acts.stop && local ? [item('stop', t('pages.plan.kill'), 'stop', () => void stopRun(local, row.foldedRunId ?? row.id, jobName(row), actionUi), true)] : []),
      ...(acts.refreshLead && local ? [item('refreshLead', t('plan.header.refreshLead'), 'refresh', () => void refreshLead(local, row.foldedRunId ?? row.id, actionUi))] : []),
      ...(row.coordinatorMissing ? [item('coord', t('pages.plans.restartLead'), 'reset', () => p.restartCoordinator(row.id))] : []),
      ...(delivery && deliveryActionsOf({ delivery }).retry && delivery.state !== 'delivering'
        ? [item('deliver', t('plan.delivery.retry'), 'rerun', () => void retryDelivery(row))]
        : []),
      ...(local && canChat(row) ? [item('chat', t('plan.chat.label'), 'message', () => void openPlanChat(local, row.id, actionUi))] : []),
      ...(local && isUnmergedPlan(row) ? [item('review', t('pages.plans.unmerged.review'), 'search', () => void reviewPlan(row))] : []),
      ...(acts.mergePr && local ? (['merge', 'squash', 'rebase'] as const).map((m) => item(`mergePr-${m}`, `${t('worktrees.act.mergePr')}: ${t(`worktrees.act.method.${m}` as never)}`, 'merge', () => void mergePlanPr(row, m))) : []),
      ...(acts.markMerged && local ? [item('markMerged', t('plan.markMerged.menu'), 'check', () => void markPlanMerged(row))] : []),
      ...(acts.merge && local ? [item('merge', t('jobs.run.merge'), 'merge', () => void mergePlan(local, row, actionUi))] : []),
      ...(acts.mergeAll && local ? [item('mergeAll', t('plan.integrate.menu'), 'merge', () => void integratePlan(local, row, jobName(row), actionUi))] : []),
      ...(acts.openPr
        ? [
            acts.openPr.kind === 'pr'
              ? item('openPr', t('shell.plans.menu.openPr'), 'pullRequest', () => void window.api.system.openExternal((acts.openPr as { url: string }).url))
              : item('copyBranch', t('plan.header.copyBranch'), 'branch', () => window.api.clipboard.writeText((acts.openPr as { branch: string }).branch))
          ]
        : []),
      ...(acts.folder && local ? [folderAction('reveal', t('plan.header.reveal'), 'folder', (path) => void window.api.files.reveal(path)), folderAction('terminal', t('plan.header.terminal'), 'terminal', (path) => void window.api.terminal.open(path))] : []),
      ...(acts.rename && local ? [item('rename', t('jobs.lifecycle.rename'), 'edit', () => setRenaming({ id: row.id, title: jobName(row) }))] : []),
      item('copyId', t('plan.header.copyId'), 'copy', () => window.api.clipboard.writeText(row.id)),
      ...(local && archived ? [item('unarchive', t('jobs.lifecycle.unarchive'), 'restore', () => void unarchiveJob(local, row.id, actionUi))] : []),
      ...(local && !archived ? [item('archive', t('jobs.lifecycle.archive'), 'archive', () => void archiveJob(local, orchSnapshot, row.id, actionUi))] : []),
      // lib/jobActions asks before it deletes
      ...(local ? ['separator' as const, item('delete', t('jobs.run.delete'), 'delete', () => void deleteRun(local, orchSnapshot, row.id, actionUi), true)] : [])
    ]
  }
  const taskMenu = (row: JobRow, taskId: string, sessionId?: string, status?: JobTask['status']): Array<MenuItem | 'separator'> => [
    {
      id: 'console',
      label: t('pages.plans.tree.menu.openConsole'),
      icon: <Icon name="terminal" />,
      disabled: !(sessionId && canOpenSession(sessionId)),
      onSelect: () => sessionId && openConsole(sessionId)
    },
    ...(status !== undefined && doneViewOf({ status }).ask
      ? [{ id: 'ask', label: t('plan.done.ask'), icon: <Icon name="terminal" />, disabled: !local, onSelect: () => local && void askAboutTaskWithToast(local, row.id, taskId, t) }]
      : []),
    { id: 'plan', label: t('pages.plans.tree.menu.openInPlan'), icon: <Icon name="listTree" />, onSelect: () => openPlanTab(row.id, taskSection(taskId)) },
    { id: 'copy', label: t('pages.plans.tree.menu.copyId'), icon: <Icon name="copy" />, onSelect: () => window.api.clipboard.writeText(taskId) }
  ]
  // Finished plans keep this same menu; actions that only suit a finished plan are added to planMenu for `archived || done` rows.
  /** A step row: the plan opened at the board, and the plan page's own new-Task form with the previous step's Tasks as deps. */
  const stepMenu = (row: JobRow, step: number): Array<MenuItem | 'separator'> => {
    const previous = row.tasks.filter((x) => x.wave === step - 1).map((x) => x.id)
    // the plan page has no step anchor: land on the step's first Task (expanded and flashed), else the steps section
    const first = row.tasks.find((x) => x.wave === step)
    return [
      { id: 'openStep', label: t('shell.plans.menu.openStep'), icon: <Icon name="open" />, onSelect: () => openPlanTab(row.id, first ? taskSection(first.id) : 'waves') },
      ...(local && row.archivedAt === undefined ? [{ id: 'addTask', label: t('plan.steps.addTask'), icon: <Icon name="add" />, onSelect: () => setAdding({ row, deps: step === 0 ? [] : previous }) }] : [])
    ]
  }
  const menuOf = (node: PlanNode): Array<MenuItem | 'separator'> | null =>
    node.kind === 'plan'
      ? planMenu(node.row)
      : node.kind === 'task'
        ? taskMenu(node.row, node.task.id, node.task.sessionId, node.task.status)
        : node.kind === 'step'
          ? stepMenu(node.row, node.step)
          : null

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
      description: pane !== 'running' ? finishedDescription(n.row, nowMs, t) : planDescription(n.row, nowMs, t),
      decoration: { text: t(status.key, status.params), tone: status.tone },
      // Every plan is one click from its chat tab (T3); the row menu carries it, the finished pane's row action too
      ...(local && pane === 'finished' && canChat(n.row)
        ? { actions: <IconButton size="sm" label={t('plan.chat.label')} icon={<Icon name="message" size={14} />} onClick={() => void openPlanChat(local, n.row.id, actionUi)} /> }
        : {}),
      // An unmerged plan: its review and its merge are one click (the menu has the other merge methods and Open PR)
      ...(local && pane === 'unmerged'
        ? {
            actions: (
              <>
                <IconButton size="sm" label={t('pages.plans.unmerged.review')} icon={<Icon name="search" size={14} />} onClick={() => void reviewPlan(n.row)} />
                {planActionsOf(n.row, true).mergePr && <IconButton size="sm" label={t('worktrees.act.mergePr')} icon={<Icon name="merge" size={14} />} onClick={() => void mergePlanPr(n.row, 'merge')} />}
                {n.row.pr?.url && <IconButton size="sm" label={t('shell.plans.menu.openPr')} icon={<Icon name="pullRequest" size={14} />} onClick={() => void window.api.system.openExternal(n.row.pr!.url!)} />}
              </>
            )
          }
        : {}),
      // A dead plan is one click from archived, or from running again where something can resume it (resumeActionOf)
      ...(local && (isStalledPlan(n.row) || isStoppedPlan(n.row))
        ? {
            actions: (
              <>
                {resume && (
                  <IconButton
                    size="sm"
                    label={t('jobs.run.resume')}
                    icon={<Icon name="run" size={14} />}
                    onClick={() =>
                      resume.kind === 'restart-lead'
                        ? p.restartCoordinator(n.row.id)
                        : resume.kind === 'resume-run'
                          ? void resumeStoppedRun(local, n.row.foldedRunId ?? n.row.id, actionUi)
                          : void resolveFailed(local, resume.taskId, 'retry', actionUi)
                    }
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
        label={t(PANE_TITLE[pane])}
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
          <ViewPane title={t('pages.plans.unmerged')} count={split.unmerged.length} storageKey="plans.unmerged">
            {treeOf('unmerged', split.unmerged, filter.trim() === '' ? t('pages.plans.unmerged.empty') : t('pages.plans.tree.noMatch'))}
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
      {renaming && local && <RenamePlanModal initial={renaming.title} onRename={(title) => void renameJob(local, renaming.id, title, actionUi)} onClose={() => setRenaming(null)} />}
      {adding && local && (
        <NewTaskModal
          door={local}
          runId={adding.row.id}
          tasks={adding.row.tasks}
          accounts={accounts}
          runConfigs={runConfigs}
          initialDeps={adding.deps}
          planned={adding.row.planned === true}
          onClose={() => setAdding(null)}
          onCreated={() => setAdding(null)}
        />
      )}
      {ctx && ctxItems && <Menu at={ctx.at} onClose={() => setCtx(null)} label={t('pages.plans.tree.menu.label')} items={ctxItems} />}
    </>
  )
}
