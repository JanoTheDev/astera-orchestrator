// W11 Plans page: one plan's row (DESIGN-W11 §7 "Lists", §9 "Plans"). It keeps every action JobsView's cards offered:
// open, approve, restart the coordinator, pause or resume a schedule, hold, rename, archive or unarchive, delete; and
// what they showed: the status, progress, queue and overlaps, the source and PR chips, gates, running workers (a click
// opens the worker's tab), auto-fix chips, and a schedule's rule and rounds. The words are planList.ts'.
import { useState } from 'react'
import {
  Archive, ArchiveRestore, ArrowUpRight, ChevronDown, ChevronRight, Hand, MoreHorizontal, Pause, Pencil, Play, PlayCircle, RotateCcw, Trash2
} from 'lucide-react'
import type { JobRow } from '../../../../core/types'
import { runningCount } from '../../../../core/orchestration/running'
import { schedRuleSummary } from '../../../../core/scheduler/summary'
import { convergenceChipOf } from '../../../../core/orchestration/nodeMeta'
import { useI18n } from '../../i18n/I18nProvider'
import { clockFor } from '../../lib/runClock'
import { jobName } from '../../lib/jobName'
import { Button, Chip, IconButton, Input, Menu, Meter, cx, type MenuItem } from '../ui'
import { SourceChip } from '../SourceChip'
import { RunPrChip } from '../TaskLinkChips'
import { STATE_KEY, TaskGlyph, TaskIcon } from '../JobIcons'
import { approveSlot } from './planTalk'
import { ageOf } from './planBoard'
import { convergenceText, isRunningTask, lastActivityOf, planStatusOf, taskMeta } from './planList'

/** The plan actions PlansPage wires (lib/jobActions: delete and archive confirm there). Absent: not offered. */
export interface PlanActs {
  onOpen: (id: string) => void
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
  onApprove?: (id: string) => void
  onDelete?: (id: string) => void
  onRestartCoordinator?: (id: string) => void
  onPause?: (id: string) => void
  onResume?: (id: string) => void
  onRename?: (id: string, title: string) => void
  onArchive?: (id: string) => void
  onUnarchive?: (id: string) => void
  onHold?: (id: string, hold: boolean) => void
}

/** Running worker lines drawn; the rest fold into "+N". */
const MAX_WORKERS = 3
/** Rounds of a schedule drawn at a time ("more" adds as many). */
const ROUNDS_PAGE = 5

const fmtNext = (ms: number): string => new Date(ms).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function PlanRow({
  row,
  acts,
  nowMs,
  nameOf,
  ordinal
}: {
  row: JobRow
  acts: PlanActs
  nowMs: number
  /** Another plan's name by id, for the queue and overlap chips. Absent on a schedule's round. */
  nameOf?: (id: string) => string
  /** A schedule's round: its number. A round is a Run, not a plan: no rename, hold or archive. */
  ordinal?: number
}): React.JSX.Element {
  const { t } = useI18n()
  const [renaming, setRenaming] = useState(false)
  const [roundsOpen, setRoundsOpen] = useState(false)
  const [shown, setShown] = useState(ROUNDS_PAGE)
  const plan = ordinal === undefined
  const archived = row.archivedAt !== undefined
  const status = planStatusOf(row)
  const kids = row.children ?? []
  const template = row.schedule !== undefined || kids.length > 0
  const workers = row.tasks.filter(isRunningTask).slice(0, MAX_WORKERS)
  const folded = runningCount(row.tasks) - workers.length
  const gates = row.tasks.filter((tk) => tk.status === 'blocked' && tk.gate)
  const last = lastActivityOf(row)
  const percent = row.total === 0 ? 0 : Math.floor((row.done * 100) / row.total)
  const slot = approveSlot(row)
  // W5-C: a schedule pauses as a whole, and a plan not started has nothing to launch yet
  const holdable = plan && acts.onHold !== undefined && !archived && !row.schedule && !row.pendingStart

  const items: Array<MenuItem | 'separator'> = [
    { id: 'open', label: t('jobs.detail.open'), icon: <ArrowUpRight size={16} />, onSelect: () => acts.onOpen(row.id) },
    ...(row.schedule && acts.onPause && acts.onResume
      ? [row.paused
          ? { id: 'resume', label: t('jobs.run.resume'), icon: <Play size={16} />, onSelect: () => acts.onResume?.(row.id) }
          : { id: 'pause', label: t('jobs.run.pause'), icon: <Pause size={16} />, onSelect: () => acts.onPause?.(row.id) }]
      : []),
    ...(row.coordinatorMissing && acts.onRestartCoordinator
      ? [{ id: 'coord', label: t('jobs.run.coordinatorRestart'), icon: <RotateCcw size={16} />, onSelect: () => acts.onRestartCoordinator?.(row.id) }]
      : []),
    ...(holdable
      ? [row.dispatchHold
          ? { id: 'release', label: t('jobs.hold.release'), icon: <PlayCircle size={16} />, onSelect: () => acts.onHold?.(row.id, false) }
          : { id: 'hold', label: t('jobs.hold.hold'), icon: <Hand size={16} />, onSelect: () => acts.onHold?.(row.id, true) }]
      : []),
    ...(plan && acts.onRename ? [{ id: 'rename', label: t('jobs.lifecycle.rename'), icon: <Pencil size={16} />, onSelect: () => setRenaming(true) }] : []),
    ...(plan && archived && acts.onUnarchive
      ? [{ id: 'unarchive', label: t('jobs.lifecycle.unarchive'), icon: <ArchiveRestore size={16} />, onSelect: () => acts.onUnarchive?.(row.id) }]
      : []),
    ...(plan && !archived && acts.onArchive
      ? [{ id: 'archive', label: t('jobs.lifecycle.archive'), icon: <Archive size={16} />, onSelect: () => acts.onArchive?.(row.id) }]
      : []),
    ...(acts.onDelete
      ? ['separator' as const, { id: 'delete', label: t('jobs.run.delete'), icon: <Trash2 size={16} />, danger: true, onSelect: () => acts.onDelete?.(row.id) }]
      : [])
  ]

  return (
    <div className={cx('plans-row', archived && 'plans-row--archived', row.sharesProjectFolder && 'plans-row--shared')}>
      <div className="plans-row__main">
        {template && (
          <IconButton
            size="sm"
            icon={roundsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            label={t('pages.plans.rounds')}
            active={roundsOpen}
            aria-expanded={roundsOpen}
            onClick={() => setRoundsOpen((o) => !o)}
          />
        )}
        {ordinal !== undefined && <Chip>{t('jobs.run.scheduleOrdinal', { n: ordinal })}</Chip>}
        {renaming && acts.onRename ? (
          <Input
            className="plans-row__rename"
            autoFocus
            defaultValue={jobName(row)}
            placeholder={t('jobs.lifecycle.titlePlaceholder')}
            aria-label={t('jobs.lifecycle.rename')}
            onKeyDown={(e) => {
              // An Enter that ends a Korean or Japanese composition is the IME's, not a save
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter') {
                acts.onRename?.(row.id, e.currentTarget.value)
                setRenaming(false)
              } else if (e.key === 'Escape') setRenaming(false)
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <Button variant="ghost" size="sm" className="plans-row__name" title={row.objective} onClick={() => acts.onOpen(row.id)}>
            {jobName(row)}
          </Button>
        )}
        <Chip tone={status.tone} dot>
          {t(status.key)}
        </Chip>
        {status.reason !== undefined && <span className="plans-row__reason">{t('jobs.run.notDelivered', { reason: status.reason })}</span>}
        <SourceChip source={row.source} />
        {row.pr && (
          <span className="plans-row__pr">
            <RunPrChip pr={row.pr} />
          </span>
        )}
        {row.sharesProjectFolder && (
          <span title={t('jobs.run.sharedFolderHint')}>
            <Chip tone="warn">{t('jobs.run.sharedFolder')}</Chip>
          </span>
        )}
        <span className="plans-row__spacer" />
        {!template && row.wave && <span className="plans-row__meta">{t('pages.plans.wave', { at: row.wave.at, of: row.wave.of })}</span>}
        {!template && row.total > 0 && (
          <span className="plans-row__progress">
            <Meter className="plans-row__meter" value={percent} label={t('pages.plans.progress', { done: row.done, total: row.total })} />
          </span>
        )}
        {last !== undefined && <span className="plans-row__meta">{t('pages.plans.age', { age: ageOf(new Date(last).toISOString(), nowMs) })}</span>}
        {slot === 'approve' && acts.onApprove && (
          <Button size="sm" title={t('jobs.run.approveHint')} onClick={() => acts.onApprove?.(row.id)}>
            {t('jobs.run.approve')}
          </Button>
        )}
        {/* the coordinator is gone and nothing brings it back by itself: the way back stands on the row */}
        {row.coordinatorMissing && acts.onRestartCoordinator && (
          <IconButton
            size="sm"
            icon={<RotateCcw size={14} />}
            label={t('jobs.run.coordinatorRestart')}
            title={t('jobs.run.coordinatorRestartHint')}
            onClick={() => acts.onRestartCoordinator?.(row.id)}
          />
        )}
        <span className="plans-row__menu">
          <Menu label={t('pages.plans.more')} align="end" trigger={{ icon: <MoreHorizontal size={16} />, size: 'sm' }} items={items} />
        </span>
      </div>

      {template && (
        <div className="plans-row__sub plans-row__facts">
          {row.schedule && <span>{schedRuleSummary(t, row.schedule)}</span>}
          {row.paused ? (
            <span>{t('jobs.run.paused')}</span>
          ) : (
            row.nextFireAt !== undefined && <span>{t('jobs.run.scheduleNext', { time: fmtNext(row.nextFireAt) })}</span>
          )}
          <span>{t('jobs.run.scheduleRuns', { count: row.fireCount ?? 0 })}</span>
        </div>
      )}

      {nameOf && ((row.after !== undefined && row.pendingStart) || (row.overlapPlans?.length ?? 0) > 0) && (
        <div className="plans-row__sub plans-row__facts">
          {row.after !== undefined && row.pendingStart && <Chip>{t('pages.plans.startsAfter', { plan: nameOf(row.after) })}</Chip>}
          {(row.overlapPlans ?? []).map((id) => (
            <span key={id} title={(row.overlaps ?? []).join('\n')}>
              <Chip tone="warn">{t('pages.plans.overlaps', { plan: nameOf(id) })}</Chip>
            </span>
          ))}
        </div>
      )}

      {/* W8-D: before approval, one line per overlap with another plan; it never blocks the approve */}
      {row.pendingStart && ((row.planOverlaps ?? row.overlaps)?.length ?? 0) > 0 && (
        <ul className="plans-row__sub plans-row__overlaps" aria-label={t('jobs.run.overlaps')}>
          {(row.planOverlaps ?? row.overlaps)?.map((line) => (
            <li key={line} title={t('jobs.run.overlapsHint')}>
              {t('jobs.run.overlaps')}: {line}
            </li>
          ))}
        </ul>
      )}

      {/* a gate stays in sight: it is a person being waited on */}
      {gates.map((task) => {
        const chip = convergenceChipOf(task)
        return (
          <div key={task.id} className="plans-row__sub plans-row__gate">
            <TaskIcon status="blocked" label={t(STATE_KEY.blocked)} />
            {chip && <Chip tone="warn">{convergenceText(chip, t)}</Chip>}
            <span className="plans-row__text">
              {task.gate?.question}
              {task.openGates > 1 ? ` ${t('jobs.gates.more', { count: task.openGates - 1 })}` : ''}
            </span>
          </div>
        )
      })}

      {(workers.length > 0 || folded > 0) && (
        <div className="plans-row__sub plans-row__workers">
          {workers.map((task) => {
            // the line's look and its click come from the same value, or it looks clickable and does nothing
            const sessionId = task.sessionId && acts.canOpenSession(task.sessionId) ? task.sessionId : undefined
            const chip = convergenceChipOf(task)
            const meta = `${task.provider} · ${taskMeta(task, nowMs, t)}`
            const body = (
              <>
                <TaskGlyph task={task} />
                <span className="plans-row__text" title={task.title}>
                  {task.title}
                </span>
                <span className="plans-row__meta" title={meta}>
                  {meta}
                </span>
                {chip && <Chip tone="info">{convergenceText(chip, t)}</Chip>}
                {sessionId && <ArrowUpRight size={14} aria-hidden="true" />}
              </>
            )
            return sessionId ? (
              <Button key={task.id} variant="ghost" size="sm" className="plans-row__worker" onClick={() => acts.onOpenSession(sessionId)}>
                {body}
              </Button>
            ) : (
              <div key={task.id} className="plans-row__worker">
                {body}
              </div>
            )
          })}
          {folded > 0 && <span className="plans-row__meta">+{folded}</span>}
        </div>
      )}

      {template && roundsOpen && (
        <div className="plans-row__rounds">
          {kids.length === 0 ? (
            <p className="plans-row__meta">{t(row.pendingStart ? 'jobs.run.schedulePending' : 'jobs.run.scheduleEmpty')}</p>
          ) : (
            kids.slice(0, shown).map((kid) => (
              <PlanRow key={kid.id} row={kid} acts={{ ...acts, onPause: undefined, onResume: undefined }} nowMs={clockFor(kid, nowMs)} ordinal={kid.fireOrdinal ?? 0} />
            ))
          )}
          {kids.length > shown && (
            <Button variant="ghost" size="sm" onClick={() => setShown((n) => n + ROUNDS_PAGE)}>
              {t('jobs.run.scheduleMore', { count: Math.min(ROUNDS_PAGE, kids.length - shown) })}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
