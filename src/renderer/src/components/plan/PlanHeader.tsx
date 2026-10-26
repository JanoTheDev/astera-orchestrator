// The plan tab's header (moved out of pages/PlanPage.tsx; T8 restyled to DESIGN-W13): the plan's name (renamed inline),
// its status as an icon and a word, "Step 2 of 3 · 4/7 done" with a progress Meter, and its actions: Approve when it
// applies, Merge, Pause/Resume, Open consoles and the ⋯ menu (delivery, lifecycle). Workers at once moved to Plan settings.
// T3: the per-state counts moved to the summary card; a finished plan shows Open PR, Archive and Copy plan ID instead of
// Open consoles (planHeaderActions.ts decides which stand visible).
import { useState } from 'react'
import type { JobRow, OrchSnapshot } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { replyNote, type OrchDoor } from '../../lib/orchDoor'
import {
  archiveJob,
  deleteRun,
  holdJob,
  openPlanChat,
  refreshLead,
  rejectPlan,
  pauseRun,
  renameJob,
  resolveFailed,
  restartCoordinator,
  resumeRun,
  setJobAfter,
  stopRun,
  resumeStoppedRun,
  unarchiveJob
} from '../../lib/jobActions'
import { toast } from '../../lib/toast'
import { jobName } from '../../lib/jobName'
import { openPlan } from '../shell/navigation'
import { SourceChip } from '../SourceChip'
import { Button, Chip, Icon, Input, Menu, Meter, PageHeader, Toolbar, type MenuItem } from '../ui'
import { planProgressOf } from './planBoard'
import { integrateAllOutcomeOf, type IntegrateAllOutcome } from './planCommands'
import { isOwnerHeld, isStoppedPlan, planStatusOf } from './planList'
import { approveViewOf } from './planPage'
import './plans.css'
import { PlanMergeActions, useRunFolder } from './PlanChanges'
import { deliveryActionsOf, RUN_START, taskAnchorId } from './planPage'
import type { PlanPageState } from './usePlanPage'
import { FailedWaitButtons } from './FailedWaitButtons'
import { headerActionsOf, planActionsOf } from './planHeaderActions'

export function PlanHeader({
  p,
  run,
  runId,
  runtimeId,
  door,
  plans,
  snapshot,
  onOpenConsoles,
  simple = false
}: {
  p: PlanPageState
  run: JobRow | undefined
  runId: string
  runtimeId?: string
  door: OrchDoor
  plans: readonly JobRow[]
  snapshot: OrchSnapshot | null
  /** The plan's consoles: the Agents side bar, filtered to this plan. */
  onOpenConsoles: () => void
  /** T19: simple mode: no model chip */
  simple?: boolean
}): React.JSX.Element {
  const { t } = useI18n()
  const { lockedReason, ui, waveStatus, tasks, busy } = p
  const [renaming, setRenaming] = useState(false)
  // T8: the Stalled chip's Fix in flight
  const [fixing, setFixing] = useState(false)
  // T3: a delivery being retried, failed or waiting on the owner can be tried again from here (`run-deliver --force`)
  const [redelivering, setRedelivering] = useState(false)
  // T4: "Merge everything and fix conflicts" in flight, and what it answered (a hand-off to the merge Task stays on screen)
  const [integrating, setIntegrating] = useState(false)
  const [integrated, setIntegrated] = useState<IntegrateAllOutcome | null>(null)
  // a row that only carries the wait for another plan (state 'pending') has nothing to retry
  const delivery = run?.delivery?.state === 'pending' ? undefined : run?.delivery
  const deliveryActions = deliveryActionsOf({ delivery })
  // Retry (force), It's already pushed (ownerPushed) and Dismiss share one in-flight flag and one error toast
  const runDelivery = async (command: 'run-deliver' | 'run-delivery-dismiss', args: Record<string, unknown>, done: string): Promise<void> => {
    if (!delivery) return
    setRedelivering(true)
    try {
      const reply = await door.command(command, { run: delivery.runId, ...args })
      if (reply.status >= 400) toast.error(t('plan.delivery.retryFailed', { reason: replyNote(reply, t as never, t('jobs.node.failed')) }))
      else toast.success(done)
    } catch {
      toast.error(t('jobs.node.failed'))
    } finally {
      setRedelivering(false)
    }
  }
  const mergeEverything = async (): Promise<void> => {
    if (!run) return
    const ok = await ui.confirm({ title: t('plan.integrate.title'), body: t('plan.integrate.body', { plan: jobName(run) }), confirmLabel: t('plan.integrate.confirm') })
    if (!ok) return
    setIntegrating(true)
    setIntegrated(null)
    try {
      const reply = await door.command('run-integrate-all', { run: run.foldedRunId ?? runId })
      const out = integrateAllOutcomeOf(reply)
      if (out.state === 'delivered') toast.success(t('plan.integrate.delivered'))
      else if (out.state === 'refused') toast.error(t('plan.integrate.failed', { reason: replyNote(reply, t as never, out.error ?? t('jobs.node.failed')) }))
      else setIntegrated(out)
    } catch {
      toast.error(t('jobs.node.failed'))
    } finally {
      setIntegrating(false)
    }
  }
  /** Brings the AI merge Task's row into view, expanded, as Needs you's Task names do. */
  const showMergeTask = (taskId: string): void => {
    p.setSelected(taskId)
    requestAnimationFrame(() => document.getElementById(taskAnchorId(taskId))?.scrollIntoView({ block: 'center' }))
  }
  const retryDelivery = (): Promise<void> => runDelivery('run-deliver', { force: true }, t('plan.delivery.delivered'))
  const alreadyPushed = (): Promise<void> => runDelivery('run-deliver', { ownerPushed: true }, t('plan.delivery.delivered'))
  const dismissDelivery = async (): Promise<void> => {
    const ok = await ui.confirm({ title: t('plan.delivery.dismissTitle'), body: t('plan.delivery.dismissBody'), confirmLabel: t('plan.delivery.dismiss') })
    if (ok) await runDelivery('run-delivery-dismiss', {}, t('plan.delivery.dismissed'))
  }
  // W9-C: the plan's own actions in the header and its ⋯ menu (DESIGN.md §2 "Plan page"); each is lib/jobActions'.
  const off = lockedReason !== undefined
  // W1-C/W5-C lifecycle (rename, start after, hold, archive) is this computer's Jobs only, as the Jobs list offers it
  const local = runtimeId === undefined
  const otherPlans = plans.filter((pl) => pl.id !== runId && pl.archivedAt === undefined)
  const acts = headerActionsOf(run, local)
  const planActs = run ? planActionsOf(run, local) : undefined
  const folder = useRunFolder(run)
  const copy = (text: string, done: string): void => {
    window.api.clipboard.writeText(text)
    toast.success(done)
  }
  const openPr = (): void => {
    if (acts.openPr?.kind === 'pr') void window.api.system.openExternal(acts.openPr.url)
    else if (acts.openPr?.kind === 'branch') copy(acts.openPr.branch, t('plan.header.branchCopied'))
  }
  const archive = (): void =>
    void (acts.archive === 'unarchive' ? unarchiveJob(door, runId, ui) : archiveJob(door, snapshot, runId, ui))
  const askMore = (): void => void openPlanChat(door, runId, ui)
  const openPrLabel = acts.openPr?.kind === 'branch' ? acts.openPr.branch : t('plan.header.openPr')
  const archiveLabel = t(acts.archive === 'unarchive' ? 'jobs.lifecycle.unarchive' : 'jobs.lifecycle.archive')
  /** "Start after…": the plans this one can wait for, one to tick; none ticked starts it right away. */
  const pickAfter = async (): Promise<void> => {
    if (!run) return
    const answer = await ui.confirmChoices({
      title: t('pages.plan.startAfter'),
      body: t('pages.plan.startAfterBody', { plan: jobName(run) }),
      confirmLabel: t('common.confirm'),
      choices: otherPlans.map((pl) => ({ id: pl.id, label: jobName(pl) }))
    })
    if (answer.ok) await setJobAfter(door, runId, answer.checked[0] ?? 'none', ui)
  }
  const menu: MenuItem[] = run
    ? [
        // T3: a finished plan's Open consoles is a rare action
        ...(!acts.consoles ? [{ id: 'consoles', label: t('plan.doc.openConsoles'), icon: <Icon name="layoutGrid" size={14} />, onSelect: onOpenConsoles }] : []),
        ...(local ? [{ id: 'rename', label: t('jobs.lifecycle.rename'), icon: <Icon name="edit" size={14} />, disabled: off, onSelect: () => setRenaming(true) }] : []),
        // W8-C: a plan not planned yet can wait for another to deliver
        ...(local && run.pendingStart && !run.planned
          ? [{ id: 'after', label: t('pages.plan.startAfter'), icon: <Icon name="ordered" size={14} />, disabled: off, onSelect: () => void pickAfter() }]
          : []),
        // T2: Copy plan ID in every state; a finished plan shows it as a header button instead
        ...(!acts.finished ? [{ id: 'copyId', label: t('plan.header.copyId'), icon: <Icon name="copy" size={14} />, onSelect: () => copy(runId, t('plan.header.idCopied')) }] : []),
        ...(planActs?.refreshLead
          ? [{ id: 'refreshLead', label: t('plan.header.refreshLead'), icon: <Icon name="refresh" size={14} />, disabled: off, onSelect: () => void refreshLead(door, run.foldedRunId ?? runId, ui) }]
          : []),
        ...(folder
          ? [
              { id: 'reveal', label: t('plan.header.reveal'), icon: <Icon name="folder" size={14} />, onSelect: () => void window.api.files.reveal(folder.path) },
              { id: 'terminal', label: t('plan.header.terminal'), icon: <Icon name="terminal" size={14} />, onSelect: () => void window.api.terminal.open(folder.path) }
            ]
          : []),
        ...(run.coordinatorMissing
          ? [{ id: 'coordinator', label: t('plan.header.restartLead'), icon: <Icon name="run" size={14} />, disabled: off, onSelect: () => void restartCoordinator(door, runId, ui) }]
          : []),
        // T8: the delivery's own answers live in the menu; the chip above says why it has not gone through
        ...(deliveryActions.retry
          ? [{ id: 'redeliver', label: redelivering || delivery?.state === 'delivering' ? t('plan.delivery.delivering') : t('plan.delivery.retry'), icon: <Icon name="rerun" size={14} />, disabled: off || redelivering || delivery?.state === 'delivering', onSelect: () => void retryDelivery() }]
          : []),
        ...(deliveryActions.alreadyPushed
          ? [{ id: 'pushed', label: t('plan.delivery.alreadyPushed'), icon: <Icon name="check" size={14} />, disabled: off || redelivering, onSelect: () => void alreadyPushed() }]
          : []),
        ...(deliveryActions.dismiss
          ? [{ id: 'dismiss', label: t('plan.delivery.dismiss'), icon: <Icon name="close" size={14} />, disabled: off || redelivering, onSelect: () => void dismissDelivery() }]
          : []),
        // T4 (advanced): every worktree into the plan branch, an agent fixes the conflicts, then the plan's own delivery
        ...(run.archivedAt === undefined && !run.pendingStart
          ? [{ id: 'integrate', label: integrating ? t('plan.integrate.working') : t('plan.integrate.menu'), icon: <Icon name="merge" size={14} />, disabled: off || integrating, onSelect: () => void mergeEverything() }]
          : []),
        { id: 'kill', label: t('pages.plan.kill'), icon: <Icon name="stop" size={14} />, danger: true, disabled: off || !planActs?.stop, onSelect: () => void stopRun(door, run.foldedRunId ?? runId, jobName(run), ui) },
        // T3: Archive stands in the header of a finished plan; the menu keeps it otherwise
        ...(!local || acts.archive !== undefined ? [] : run.archivedAt !== undefined
          ? [{ id: 'unarchive', label: t('jobs.lifecycle.unarchive'), icon: <Icon name="restore" size={14} />, disabled: off, onSelect: () => void unarchiveJob(door, runId, ui) }]
          : [{ id: 'archive', label: t('jobs.lifecycle.archive'), icon: <Icon name="archive" size={14} />, disabled: off, onSelect: () => void archiveJob(door, snapshot, runId, ui) }]),
        { id: 'delete', label: t('jobs.run.delete'), icon: <Icon name="delete" size={14} />, danger: true, disabled: off, onSelect: () => void deleteRun(door, snapshot, runId, ui) }
      ]
    : []
  // W5-C: a plan pauses by holding its new starts (jobs-hold); a schedule pauses as a whole (run-pause)
  const pause: { label: string; title?: string; onSelect: () => void } | null =
    run === undefined || run.archivedAt !== undefined || run.pendingStart || run.outcome === 'completed' ? null : run.schedule ? {
      label: run.paused ? t('jobs.run.resume') : t('jobs.run.pause'),
      title: lockedReason,
      onSelect: () => void (run.paused ? resumeRun(door, runId, ui) : pauseRun(door, runId, ui))
    } : !local ? null : isStoppedPlan(run) ? {
      // Kill (runs-stop) paused the Run: Resume undoes it, with the id stopRun used
      label: t('jobs.run.resume'),
      title: lockedReason,
      onSelect: () => void resumeStoppedRun(door, run.foldedRunId ?? runId, ui)
    } : run.dispatchHold && !isOwnerHeld(run) ? null : {
      // a replan, the final check and a replan's question release themselves: only the owner's own hold shows Resume
      label: run.dispatchHold ? t('jobs.run.resume') : t('jobs.run.pause'),
      title: lockedReason ?? (run.dispatchHold ? t('plan.header.release') : t('plan.header.hold')),
      onSelect: () => void holdJob(door, runId, !run.dispatchHold, ui)
    }
  // W17: a narrow tab folds Pause, Open consoles and the ⋯ menu into one ⋯ toolbar (planPage.css shows one set)
  const narrowMenu: Array<MenuItem | 'separator'> = [
    ...(pause ? [{ id: 'pause', label: pause.label, disabled: off, onSelect: pause.onSelect }] : []),
    ...(acts.askMore ? [{ id: 'askMore', label: t('plan.chat.askMore'), icon: <Icon name="sparkles" size={14} />, disabled: off, onSelect: askMore }] : []),
    ...(acts.openPr ? [{ id: 'openPr', label: acts.openPr.kind === 'pr' ? openPrLabel : t('plan.header.copyBranch'), icon: <Icon name={acts.openPr.kind === 'pr' ? 'pullRequest' : 'branch'} size={14} />, onSelect: openPr }] : []),
    ...(acts.archive ? [{ id: 'archiveNow', label: archiveLabel, icon: <Icon name={acts.archive === 'unarchive' ? 'restore' : 'archive'} size={14} />, disabled: off, onSelect: archive }] : []),
    ...(acts.copyId && acts.finished ? [{ id: 'copyId', label: t('plan.header.copyId'), icon: <Icon name="copy" size={14} />, onSelect: () => copy(runId, t('plan.header.idCopied')) }] : []),
    ...(acts.consoles ? [{ id: 'consoles', label: t('plan.doc.openConsoles'), icon: <Icon name="layoutGrid" size={14} />, onSelect: onOpenConsoles }] : []),
    ...(menu.length > 0 ? ['separator' as const, ...menu] : [])
  ]

  const status = run ? planStatusOf(run) : null
  const prog = planProgressOf(tasks)
  const approve = run ? approveViewOf(run) : null
  const progressText = [waveStatus ? t('plan.steps.of', { at: waveStatus.at, of: waveStatus.of }) : null, prog.total > 0 ? t('plan.wave.progress', { done: prog.counts.done, total: prog.total }) : null]
    .filter((x) => x !== null)
    .join(' · ')

  return (
    <PageHeader
      className="plan-page-header"
      title={
        // 머리말이 없다 — Job 의 이름(jobName: 티켓에서 만든 Job 은 티켓 제목, 아니면 목표)이 제목이고, 그 옆의 아이콘과 숫자가 상태를 말한다
        // W9-C: rename inline (Enter keeps, Escape or leaving drops), as the Jobs card's head does
        renaming && run ? (
          <Input
            className="jobs-title-input"
            autoFocus
            defaultValue={jobName(run)}
            placeholder={t('jobs.lifecycle.titlePlaceholder')}
            aria-label={t('jobs.lifecycle.rename')}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                void renameJob(door, runId, e.currentTarget.value, ui)
                setRenaming(false)
              } else if (e.key === 'Escape') setRenaming(false)
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <span className="plan-page-title" title={run?.objective} onDoubleClick={() => local && !off && setRenaming(true)}>
            {run ? jobName(run) : ''}
          </span>
        )
      }
      subtitle={
        <span className="plan-page-sub">
          {/* the status as a dot and a word (DESIGN-W13: colour always has a second cue) */}
          {status && (
            <Chip tone={status.tone} dot>
              {t(status.key, status.params)}
            </Chip>
          )}
          {/* a failed plan whose work landed through a later plan: one click to that plan */}
          {status?.deliveredBy !== undefined && (
            <Button size="sm" variant="ghost" icon={<Icon name="listTree" size={14} />} onClick={() => openPlan(status.deliveredBy!)}>
              {t('pages.plans.tree.menu.open')}
            </Button>
          )}
          {progressText !== '' && <span className="plan-page-wave">{progressText}</span>}
          {prog.total > 0 && <Meter className="plan-meter plan-page-meter" value={prog.percent} />}
          {/* T36: waits on a failed Task: the owner's three answers instead of the generic Fix */}
          {run?.stalledOn && (
            <span title={run.stalledOn.result ?? t('plan.failedWait.hint')}>
              <FailedWaitButtons
                disabled={off}
                title={lockedReason}
                onAct={(action) => run.stalledOn && void resolveFailed(door, run.stalledOn.taskId, action, ui)}
              />
            </span>
          )}
          {/* T8: a running plan nothing can move: Fix runs `runs doctor --fix` on this Run (runsDoctor.ts) */}
          {run?.stuck === 'stalled' && !run.stalledOn && (
            <Button
              size="sm"
              disabled={off || fixing}
              title={lockedReason ?? t('plan.outcome.stalledHint')}
              onClick={() => {
                setFixing(true)
                void door
                  .command('runs-doctor', { run: runId, fix: true })
                  .then((reply) => {
                    if (reply.status >= 400) return toast.error(replyNote(reply, t as never, t('plan.doctor.failed')))
                    const n = ((reply.body as { repairs?: Array<{ fixed: boolean }> } | null)?.repairs ?? []).filter((r) => r.fixed).length
                    toast.info(n > 0 ? t('plan.doctor.fixed', { n }) : t('plan.doctor.nothing'))
                  })
                  .catch(() => toast.error(t('plan.doctor.failed')))
                  .finally(() => setFixing(false))
              }}
            >
              {fixing ? t('plan.doctor.fixing') : t('plan.doctor.fix')}
            </Button>
          )}
          {run?.outcome === 'failed' && run.deliveryError !== undefined && delivery === undefined && (
            <Chip tone="danger">{t('jobs.run.notDelivered', { reason: run.deliveryError })}</Chip>
          )}
          {/* T3: why the delivery has not gone through yet; Retry delivery stands in the ⋯ menu */}
          {delivery !== undefined && delivery.state !== 'delivering' && (
            <Chip tone={delivery.state === 'failed' ? 'danger' : 'warn'}>
              {t(delivery.state === 'retrying' ? 'plan.delivery.retrying' : delivery.state === 'failed' ? 'plan.delivery.failed' : 'plan.delivery.needsOwner', {
                reason: delivery.reason ?? '—'
              })}
            </Chip>
          )}
          {/* T5: the coordinator's model, picked by the plan's size (roleModels.ts resolveCoordinatorModel) */}
          {!simple && run?.coordinatorModel !== undefined && <Chip>{`${t('plan.card.model')}: ${run.coordinatorModel}`}</Chip>}
          {integrated?.state === 'stopped' && <Chip tone="danger">{t('plan.integrate.stopped', { reason: integrated.error ?? '—' })}</Chip>}
          {integrated?.state === 'fixing-conflicts' && (
            <>
              <Chip tone="info">{t('plan.integrate.fixing')}</Chip>
              <Button size="sm" variant="ghost" icon={<Icon name="tasks" size={14} />} onClick={() => showMergeTask(integrated.taskId)}>
                {t('plan.integrate.openTask')}
              </Button>
            </>
          )}
          <SourceChip source={run?.source} />
        </span>
      }
      actions={
        <>
          {/* #116 (approveSlot): a planned Job's planner not done yet, or an auto-approve plan: words, no button. Moved here
              from the overview (T8); the logic is planTalk.ts'. */}
          {/* Task 를 다 짜고 누르는 버튼. **Task 가 없으면 잠근다** — 빈 Run 을 시작하면 pendingStart 만 걷히고
              아무 일도 일어나지 않는다. 누르면 게이트가 걷히고 이 버튼도 사라진다. 도는 동안은 회전과 문구로 바뀐다. */}
          {run && approve?.show && (
            <>
              {!approve.ready && (
                <div className="plan-page-problems" role="alert">
                  <strong>{t(run.autoApprove === true || run.handsOff === true ? 'plan.talk.waitingPlanner' : 'plan.talk.problems')}</strong>
                  {approve.problems.length > 0 && (
                    <ul>
                      {approve.problems.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <Button
                size="sm"
                variant="primary"
                icon={<Icon name="run" size={14} />}
                loading={busy === RUN_START}
                disabled={off || busy === RUN_START || !approve.ready}
                title={lockedReason ?? t('plan.header.startHint')}
                onClick={() => void p.startRunNow()}
              >
                {busy === RUN_START ? t('jobs.run.starting') : t('jobs.run.approve')}
              </Button>
              {planActs?.reject && (
                <Button size="sm" variant="ghost" icon={<Icon name="close" size={14} />} disabled={off || busy === RUN_START} title={lockedReason} onClick={() => void rejectPlan(door, runId, jobName(run), '', ui)}>
                  {t('plan.talk.reject')}
                </Button>
              )}
            </>
          )}
          {/* the finished group's Open PR stands for the PR chip, so the merge actions leave it out */}
          {!p.authoringOpen && <PlanMergeActions p={p} run={acts.openPr && run ? { ...run, pr: undefined } : run} />}
          <span className="plan-header-wide">
            {pause && (
              <Button size="sm" variant="ghost" disabled={off} title={pause.title} onClick={pause.onSelect}>
                {pause.label}
              </Button>
            )}
            {acts.finished && (
              <>
                {acts.askMore && (
                  <Button size="sm" variant="primary" icon={<Icon name="sparkles" size={14} />} disabled={off} title={lockedReason ?? t('plan.chat.askMoreHint')} onClick={askMore}>
                    {t('plan.chat.askMore')}
                  </Button>
                )}
                {acts.openPr && (
                  <Button
                    size="sm"
                    variant={acts.primary === 'openPr' ? 'primary' : 'ghost'}
                    icon={<Icon name={acts.openPr.kind === 'pr' ? 'pullRequest' : 'branch'} size={14} />}
                    title={acts.openPr.kind === 'pr' ? acts.openPr.url : t('plan.header.copyBranch')}
                    onClick={openPr}
                  >
                    {openPrLabel}
                  </Button>
                )}
                {acts.archive && (
                  <Button
                    size="sm"
                    variant={acts.primary === 'archive' ? 'primary' : 'ghost'}
                    icon={<Icon name={acts.archive === 'unarchive' ? 'restore' : 'archive'} size={14} />}
                    disabled={off}
                    title={lockedReason}
                    onClick={archive}
                  >
                    {archiveLabel}
                  </Button>
                )}
                {acts.copyId && (
                  <Button size="sm" variant="ghost" icon={<Icon name="copy" size={14} />} onClick={() => copy(runId, t('plan.header.idCopied'))}>
                    {t('plan.header.copyId')}
                  </Button>
                )}
              </>
            )}
            {acts.consoles && (
              <Button size="sm" variant="ghost" icon={<Icon name="layoutGrid" size={14} />} onClick={onOpenConsoles}>
                {t('plan.doc.openConsoles')}
              </Button>
            )}
            {menu.length > 0 && (
              <Menu label={t('plan.header.more')} align="end" items={menu} trigger={{ variant: 'ghost', size: 'sm', icon: <Icon name="more" size={14} />, title: t('plan.header.more') }} />
            )}
          </span>
          <Toolbar className="plan-header-narrow" label={t('plan.header.more')} overflowLabel={t('plan.header.more')} items={[]} overflow={narrowMenu} />
        </>
      }
    />
  )
}
