// The plan page's header (moved out of pages/PlanPage.tsx, restyled to DESIGN-W11 §7): back to Plans, the plan's name
// (renamed inline), its state and wave, its actions and ⋯ menu, and the section tabs under them.
import { useState } from 'react'
import type { JobRow, OrchSnapshot } from '../../../../core/types'
import { DEFAULT_CONCURRENCY, MAX_CONCURRENT_WORKERS } from '../../../../core/orchestration/types'
import { useI18n } from '../../i18n/I18nProvider'
import { replyNote, type OrchDoor } from '../../lib/orchDoor'
import {
  archiveJob,
  deleteRun,
  holdJob,
  pauseRun,
  renameJob,
  restartCoordinator,
  resumeRun,
  setJobAfter,
  stopRun,
  unarchiveJob
} from '../../lib/jobActions'
import { toast } from '../../lib/toast'
import { jobName } from '../../lib/jobName'
import { RunIcon, STATE_KEY, TaskIcon } from '../JobIcons'
import { SourceChip } from '../SourceChip'
import { Archive, ArchiveRestore, ArrowLeft, ListOrdered, MoreHorizontal, Pencil, Play, Square, Trash2 } from 'lucide-react'
import { Button, Chip, Input, Menu, PageHeader, Tabs, type MenuItem } from '../ui'
import { PLAN_SECTIONS, type PlanSection } from './planBoard'
import type { PlanPageState } from './usePlanPage'
import { WaveLine } from './PlanWaves'

export function PlanHeader({
  p,
  run,
  runId,
  runtimeId,
  door,
  section,
  onSection,
  plans,
  snapshot,
  onClose,
  onOpenConsoles
}: {
  p: PlanPageState
  run: JobRow | undefined
  runId: string
  runtimeId?: string
  door: OrchDoor
  section: PlanSection
  onSection: (section: PlanSection) => void
  plans: readonly JobRow[]
  snapshot: OrchSnapshot | null
  onClose: () => void
  onOpenConsoles: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const { lockedReason, ui, formOpen, running, counts, waveStatus } = p
  const [renaming, setRenaming] = useState(false)
  // T3: a delivery being retried, failed or waiting on the owner can be tried again from here (`run-deliver --force`)
  const [redelivering, setRedelivering] = useState(false)
  const delivery = run?.delivery
  const retryDelivery = async (): Promise<void> => {
    if (!delivery) return
    setRedelivering(true)
    try {
      const reply = await door.command('run-deliver', { run: delivery.runId, force: true })
      if (reply.status >= 400) toast.error(t('plan.delivery.retryFailed', { reason: replyNote(reply, t as never, t('jobs.node.failed')) }))
      else toast.success(t('plan.delivery.delivered'))
    } catch {
      toast.error(t('jobs.node.failed'))
    } finally {
      setRedelivering(false)
    }
  }
  // W9-C: the plan's own actions in the header and its ⋯ menu (DESIGN.md §2 "Plan page"); each is lib/jobActions'.
  const off = lockedReason !== undefined
  // W1-C/W5-C lifecycle (rename, start after, hold, archive) is this computer's Jobs only, as the Jobs list offers it
  const local = runtimeId === undefined
  const otherPlans = plans.filter((pl) => pl.id !== runId && pl.archivedAt === undefined)
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
        ...(local ? [{ id: 'rename', label: t('jobs.lifecycle.rename'), icon: <Pencil size={14} />, disabled: off, onSelect: () => setRenaming(true) }] : []),
        // W8-C: a plan not planned yet can wait for another to deliver
        ...(local && run.pendingStart && !run.planned
          ? [{ id: 'after', label: t('pages.plan.startAfter'), icon: <ListOrdered size={14} />, disabled: off, onSelect: () => void pickAfter() }]
          : []),
        ...(run.coordinatorMissing
          ? [{ id: 'coordinator', label: t('jobs.run.coordinatorRestart'), icon: <Play size={14} />, disabled: off, onSelect: () => void restartCoordinator(door, runId, ui) }]
          : []),
        { id: 'kill', label: t('pages.plan.kill'), icon: <Square size={14} />, danger: true, disabled: off || running === 0, onSelect: () => void stopRun(door, run.foldedRunId ?? runId, jobName(run), ui) },
        ...(!local ? [] : run.archivedAt !== undefined
          ? [{ id: 'unarchive', label: t('jobs.lifecycle.unarchive'), icon: <ArchiveRestore size={14} />, disabled: off, onSelect: () => void unarchiveJob(door, runId, ui) }]
          : [{ id: 'archive', label: t('jobs.lifecycle.archive'), icon: <Archive size={14} />, disabled: off, onSelect: () => void archiveJob(door, snapshot, runId, ui) }]),
        { id: 'delete', label: t('jobs.run.delete'), icon: <Trash2 size={14} />, danger: true, disabled: off, onSelect: () => void deleteRun(door, snapshot, runId, ui) }
      ]
    : []
  // W5-C: a plan pauses by holding its new starts (jobs-hold); a schedule pauses as a whole (run-pause)
  const pauseButton =
    run === undefined || run.archivedAt !== undefined || run.pendingStart || run.outcome === 'completed' ? null : run.schedule ? (
      <Button size="sm" variant="ghost" disabled={off} title={lockedReason} onClick={() => void (run.paused ? resumeRun(door, runId, ui) : pauseRun(door, runId, ui))}>
        {run.paused ? t('jobs.run.resume') : t('jobs.run.pause')}
      </Button>
    ) : !local ? null : (
      <Button size="sm" variant="ghost" disabled={off} title={lockedReason ?? (run.dispatchHold ? t('jobs.hold.release') : t('jobs.hold.hold'))} onClick={() => void holdJob(door, runId, !run.dispatchHold, ui)}>
        {run.dispatchHold ? t('jobs.run.resume') : t('jobs.run.pause')}
      </Button>
    )

  return (
    <PageHeader
      className="plan-page-header"
      leading={
        // While a form is open or a command runs, leaving would drop it (the old window's ✕ hid then)
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} />} title={t('pages.plan.back')} disabled={formOpen} onClick={onClose}>
          {t('pages.plans.title')}
        </Button>
      }
      title={
        // 머리말이 없다 — Job 의 이름(jobName: 티켓에서 만든 Job 은 티켓 제목, 아니면 목표)이 제목이고, 그 옆의 아이콘과 숫자가 상태를 말한다
        // W9-C: rename inline (Enter keeps, Escape or leaving drops), as the Jobs card's head does
        renaming && run ? (
          <input
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
          {run?.archivedAt !== undefined && <Chip>{t('jobs.lifecycle.archived')}</Chip>}
          {run?.dispatchHold && <Chip tone="warn">{t('jobs.hold.held')}</Chip>}
          {run?.pendingStart && <Chip tone="info">{t('jobs.run.notStarted')}</Chip>}
          {run?.outcome === 'checking' && <Chip tone="info">{t('pages.plans.status.checking')}</Chip>}
          {run?.outcome === 'blocked' && <Chip tone="warn">{t('pages.plans.status.blocked')}</Chip>}
          {run?.outcome === 'failed' && run.deliveryError !== undefined && delivery === undefined && (
            <Chip tone="danger">{t('jobs.run.notDelivered', { reason: run.deliveryError })}</Chip>
          )}
          {/* T3: why the delivery has not gone through yet; "Retry delivery" stands in the actions */}
          {delivery !== undefined && delivery.state !== 'delivering' && (
            <Chip tone={delivery.state === 'failed' ? 'danger' : 'warn'}>
              {t(delivery.state === 'retrying' ? 'plan.delivery.retrying' : delivery.state === 'failed' ? 'plan.delivery.failed' : 'plan.delivery.needsOwner', {
                reason: delivery.reason ?? '—'
              })}
            </Chip>
          )}
          {/* T5: the coordinator's model, picked by the plan's size (roleModels.ts resolveCoordinatorModel) */}
          {run?.coordinatorModel !== undefined && <Chip>{`${t('plan.card.model')}: ${run.coordinatorModel}`}</Chip>}
          <SourceChip source={run?.source} />
          <WaveLine status={waveStatus} brief />
          {running > 0 && (
            <span className="jobs-count">
              <RunIcon kind="running" label={t('jobs.run.running')} />
              <span>{running}</span>
            </span>
          )}
          {counts.map(([status, n]) => (
            <span key={status} className="jobs-count">
              <TaskIcon status={status} label={t(STATE_KEY[status])} />
              <span>{n}</span>
            </span>
          ))}
        </span>
      }
      actions={
        <>
          {/* W7-D (#67): workers at once, changeable while the Job runs; a lower number only holds back new starts */}
          {run && run.outcome === 'running' && (
            <label className="jobs-count plan-page-concurrency" title={t('runDetail.concurrencyHint')}>
              <span>{t('runDetail.concurrency')}</span>
              <Input
                type="number"
                min={1}
                max={MAX_CONCURRENT_WORKERS}
                key={run.concurrency ?? DEFAULT_CONCURRENCY}
                defaultValue={run.concurrency ?? DEFAULT_CONCURRENCY}
                disabled={lockedReason !== undefined}
                aria-label={t('runDetail.concurrencyHint')}
                onBlur={(e) => {
                  const n = Math.min(MAX_CONCURRENT_WORKERS, Math.max(1, Math.round(Number(e.target.value)) || 1))
                  e.target.value = String(n)
                  if (n === (run.concurrency ?? DEFAULT_CONCURRENCY)) return
                  door
                    .command('jobs-set', { id: runId, concurrency: n })
                    .then((reply) => {
                      if (reply.status >= 400) toast.error(replyNote(reply, t as never, t('jobs.node.failed')))
                    })
                    .catch(() => toast.error(t('jobs.node.failed')))
                }}
              />
            </label>
          )}
          {/* W9-C: the ✕ of the old window is the back button; the plan's actions stand here instead */}
          <Button size="sm" variant="ghost" onClick={onOpenConsoles}>
            {t('pages.plan.consoles')}
          </Button>
          {pauseButton}
          {delivery !== undefined && (
            <Button
              size="sm"
              variant="secondary"
              disabled={off || redelivering || delivery.state === 'delivering'}
              title={lockedReason ?? delivery.reason}
              onClick={() => void retryDelivery()}
            >
              {redelivering || delivery.state === 'delivering' ? t('plan.delivery.delivering') : t('plan.delivery.retry')}
            </Button>
          )}
          {run?.planned && (
            <Button size="sm" variant="ghost" onClick={() => onSection('overview')}>
              {t('pages.plan.talk')}
            </Button>
          )}
          {menu.length > 0 && (
            <Menu label={t('pages.plan.more')} align="end" items={menu} trigger={{ variant: 'ghost', size: 'sm', icon: <MoreHorizontal size={14} /> }} />
          )}
        </>
      }
      filters={
        <Tabs
          variant="underline"
          label={t('pages.plan.sections')}
          value={section}
          onChange={onSection}
          items={PLAN_SECTIONS.map((id) => ({ id, label: t(`pages.plan.section.${id}`) }))}
        />
      }
    />
  )
}
