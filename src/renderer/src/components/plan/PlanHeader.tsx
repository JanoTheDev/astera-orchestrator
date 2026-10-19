// The plan page's head: the breadcrumb back to Plans, the plan's name (renamed in place), its state chips and counts,
// its actions (consoles, pause, talk, the ⋯ menu) and the section switch. Moved out of pages/PlanPage.tsx; each action
// is lib/jobActions'.
import { useState } from 'react'
import type { JobRow, JobTask, OrchSnapshot, TaskStatus } from '../../../../core/types'
import { DEFAULT_CONCURRENCY, MAX_CONCURRENT_WORKERS } from '../../../../core/orchestration/types'
import { runningCount } from '../../../../core/orchestration/running'
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
  unarchiveJob,
  type ActionUi
} from '../../lib/jobActions'
import { toast } from '../../lib/toast'
import { RunIcon, STATE_KEY, TaskIcon } from '../JobIcons'
import { Archive, ArchiveRestore, ChevronLeft, ListOrdered, MoreHorizontal, Pencil, Play, Square, Trash2 } from 'lucide-react'
import { Button, Chip, Menu, Tabs, type MenuItem } from '../ui'
import { SourceChip } from '../SourceChip'
import { jobName } from '../../lib/jobName'
import { PLAN_SECTIONS, type PlanSection } from './planBoard'

/** 헤더에서 따로 세는 다섯. 순서는 눈이 가야 하는 차례다 — 사람을 기다리는 것이 먼저다 */
const HEAD_STATES: readonly TaskStatus[] = ['blocked', 'completed', 'failed', 'ready', 'pending']

export function PlanHeader({
  run,
  runId,
  tasks,
  door,
  ui,
  runtimeId,
  lockedReason,
  formOpen,
  plans,
  snapshot,
  section,
  onSection,
  onClose,
  onOpenConsoles
}: {
  run: JobRow | undefined
  runId: string
  tasks: JobTask[]
  door: OrchDoor
  ui: ActionUi
  runtimeId?: string
  lockedReason: string | undefined
  /** A form is open or a command runs: leaving now would drop it, so the way back is off. */
  formOpen: boolean
  plans: readonly JobRow[]
  snapshot: OrchSnapshot | null
  section: PlanSection
  onSection: (section: PlanSection) => void
  onClose: () => void
  onOpenConsoles: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [renaming, setRenaming] = useState(false)
  const running = runningCount(tasks)
  const counts = HEAD_STATES.map(
    (status) => [status, tasks.filter((tk) => tk.status === status).length] as const
  ).filter(([, n]) => n > 0)
  // W9-C: the plan's own actions in the header and its ⋯ menu (DESIGN.md §2 "Plan page"); each is lib/jobActions'.
  const off = lockedReason !== undefined
  // W1-C/W5-C lifecycle (rename, start after, hold, archive) is this computer's Jobs only, as the Jobs list offers it
  const local = runtimeId === undefined
  const otherPlans = plans.filter((p) => p.id !== runId && p.archivedAt === undefined)
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
  /** "Start after…": the plans this one can wait for, one to tick; none ticked starts it right away. */
  const pickAfter = async (): Promise<void> => {
    if (!run) return
    const answer = await ui.confirmChoices({
      title: t('pages.plan.startAfter'),
      body: t('pages.plan.startAfterBody', { plan: jobName(run) }),
      confirmLabel: t('common.confirm'),
      choices: otherPlans.map((p) => ({ id: p.id, label: jobName(p) }))
    })
    if (answer.ok) await setJobAfter(door, runId, answer.checked[0] ?? 'none', ui)
  }
  // W5-C: a plan pauses by holding its new starts (jobs-hold); a schedule pauses as a whole (run-pause)
  const pauseButton =
    run === undefined || run.archivedAt !== undefined || run.pendingStart || run.outcome === 'completed' ? null : run.schedule ? (
      <Button size="sm" disabled={off} title={lockedReason} onClick={() => void (run.paused ? resumeRun(door, runId, ui) : pauseRun(door, runId, ui))}>
        {run.paused ? t('jobs.run.resume') : t('jobs.run.pause')}
      </Button>
    ) : !local ? null : (
      <Button size="sm" disabled={off} title={lockedReason ?? (run.dispatchHold ? t('jobs.hold.release') : t('jobs.hold.hold'))} onClick={() => void holdJob(door, runId, !run.dispatchHold, ui)}>
        {run.dispatchHold ? t('jobs.run.resume') : t('jobs.run.pause')}
      </Button>
    )

  return (
    <>
      <nav className="plan-crumb" aria-label={t('pages.plans.title')}>
        {/* While a form is open or a command runs, leaving would drop it (the old window's ✕ hid then) */}
        <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} disabled={formOpen} onClick={onClose}>
          {t('pages.plans.title')}
        </Button>
        <span aria-hidden="true">/</span>
        <span className="plan-crumb-cur">{run ? jobName(run) : ''}</span>
      </nav>
      {/* 머리말이 없다 — Job 의 이름(jobName: 티켓에서 만든 Job 은 티켓 제목, 아니면 목표)이 제목이고, 그 옆의 아이콘과 숫자가 상태를 말한다 */}
      <div className="detail-head">
        {/* W9-C: rename inline (Enter keeps, Escape or leaving drops), as the Jobs card's head does */}
        {renaming && run ? (
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
          <h2 title={run?.objective} onDoubleClick={() => local && !off && setRenaming(true)}>
            {run ? jobName(run) : ''}
          </h2>
        )}
        {run?.archivedAt !== undefined && <Chip>{t('jobs.lifecycle.archived')}</Chip>}
        {run?.dispatchHold && <Chip tone="warn">{t('jobs.hold.held')}</Chip>}
        {run?.pendingStart && <Chip tone="info">{t('jobs.run.notStarted')}</Chip>}
        <SourceChip source={run?.source} />
        {/* W7-D (#67): workers at once, changeable while the Job runs; a lower number only holds back new starts */}
        {run && run.outcome === 'running' && (
          <label className="jobs-count" title={t('runDetail.concurrencyHint')}>
            <span>{t('runDetail.concurrency')}</span>
            <input
              type="number"
              min={1}
              max={MAX_CONCURRENT_WORKERS}
              key={run.concurrency ?? DEFAULT_CONCURRENCY}
              defaultValue={run.concurrency ?? DEFAULT_CONCURRENCY}
              disabled={lockedReason !== undefined}
              aria-label={t('runDetail.concurrencyHint')}
              style={{ width: '3.5em' }}
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
        {/* 창을 닫는다. **폼이 열려 있는 동안은 숨는다** — 노드 버튼들과 같은 규칙이고(node() 의
            `!formOpen &&`) 이유가 하나 더 있다: 폼 자신도 오른쪽 위에 ✕ 를 갖고 있어서
            (NewTaskModal 의 .detail-clear) 둘이 함께 보이면 어느 ✕ 가 무엇을 닫는지 알 수 없다.
            폼이 열린 동안 나가는 길은 그 폼의 취소 하나다.
            한때 이 자리가 왼쪽 아래의 `닫기` 버튼이었고 formOpen 이면 disabled 였다. 죽은 버튼이
            폼의 취소·추가 옆에 서서 세 버튼처럼 읽혔고, 무엇에 쓰는 것이냐는 질문을 받았다 —
            같은 가드를 이 파일이 세 자리에서 이미 "숨긴다"로 쓰고 있었는데 이 자리만 달랐다. */}
        {/* W9-C: the ✕ of the old window is "Plans" in the breadcrumb; the plan's actions stand here instead */}
        <span className="plan-head-actions">
          <Button size="sm" onClick={onOpenConsoles}>
            {t('pages.plan.consoles')}
          </Button>
          {pauseButton}
          {run?.planned && (
            <Button size="sm" onClick={() => onSection('overview')}>
              {t('pages.plan.talk')}
            </Button>
          )}
          {menu.length > 0 && (
            <Menu label={t('pages.plan.more')} align="end" items={menu} trigger={{ variant: 'ghost', size: 'sm', children: <MoreHorizontal size={14} /> }} />
          )}
        </span>
      </div>
      <Tabs
        variant="segmented"
        label={t('pages.plan.sections')}
        value={section}
        onChange={onSection}
        items={PLAN_SECTIONS.map((id) => ({ id, label: t(`pages.plan.section.${id}`) }))}
      />
    </>
  )
}
