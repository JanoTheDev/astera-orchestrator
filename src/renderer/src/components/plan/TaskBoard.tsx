// W2-C task board, grouped by wave since W6-E: one section per dependency depth ("Step 1 · 3/4 done"; W12 shows a wave as a step), the current wave
// marked, and a replan in progress as a banner on it. T8 (DESIGN-W13): the steps stack vertically, each a collapsible
// section of Task rows (state icon, title, account, attempts, "Open console" for a running one); a row expands inline
// to its detail: what its worker is doing now, why it is not running (core/orchestration/blocked.ts), model, branch,
// files and the coordinator's answers. The open questions moved to "Needs you" (NeedsYou below). Drawing only: the
// waves, reasons, counts and "now" lines are planBoard.ts's. T4: a card carries its kind (and a merge Task its badge, a
// reusing Task the worktree it continues in), and a kind filter sits above the steps.
// T2: an expanded row opens with everything about its Task (renderAbout: TaskDetail), above what it showed before.
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { Account, JobEvent, JobTask } from '../../../../core/types'
import { type RoleModelSettings } from '../../../../core/orchestration/roleModels'
import { useI18n } from '../../i18n/I18nProvider'
import { TaskGlyph } from '../JobIcons'
import { taskAnchorId } from './planPage'
import {
  CATEGORIES,
  answersKey,
  autoAnswersOf,
  cardEffortOf,
  cardModelOf,
  categoryOf,
  collapsedWavesOf,
  currentWaveOf,
  filterByKind,
  KIND_ICON,
  kindsOf,
  type KindFilter,
  type needsYouOf,
  nowOf,
  reasonText,
  reasonTone,
  reuseOf,
  stepStateOf,
  type StepState,
  wavesOf,
  type LiveSession,
} from './planBoard'
import { taskActionOf } from './planCommands'
import { QuestionAnswer } from './QuestionAnswer'
import { Button, Chip, Icon, Meter, Select, Tooltip, type ChipTone, type IconName } from '../ui'
import { useVirtualRows, VIRTUAL_AFTER_ROWS } from '../ui/virtualRows'
import { openWorktree } from '../shell/navigation' // W9-J
import { TaskLines } from '../attribution/TaskLines' // W8-B
import type { SessionSummary } from '../../../../core/sessions/summary'
import { summaryOneLine } from '../wall/summaryText' // W9-I
import '../wall/wall.css'
import './plan.css'

/** Files a card lists before "+N more". */
const FILES_SHOWN = 3

export function TaskBoard({
  tasks,
  accounts,
  selected,
  onSelect,
  layers = [],
  deps,
  events = [],
  activity = [],
  sessions = {},
  replanning = false,
  refreshed = null,
  canOpenSession,
  onOpenSession,
  projectPath,
  summaries,
  renderDetail,
  renderAbout,
  compact = false,
  nowMs = Date.now(),
  onAddTask,
  onRestart,
  lockedReason
}: {
  tasks: readonly JobTask[]
  accounts: Account[] | null
  /** T8: the Task whose row is expanded (and the journal's filter). */
  selected: string | undefined
  onSelect: (taskId: string) => void
  /** W6-E: the plan's dependency depths (RunDetail `layers`). Empty puts every Task in one wave. */
  layers?: readonly string[][]
  /** T4: Task id → the ids it depends on (RunDetail `deps`): names the worktree a reusing Task continues in. */
  deps?: Readonly<Record<string, readonly string[]>>
  /** W6-E: the Run's timeline, for a question to the coordinator still unanswered. */
  events?: readonly JobEvent[]
  /** W6-E: the activity feed's lines of this plan (auto-answered questions). */
  activity?: readonly ActivityEvent[]
  /** W6-E: the Host's word on each session, by session id. */
  sessions?: Readonly<Record<string, LiveSession>>
  replanning?: boolean
  /** Coordinator rotation: why the plan's coordinator was last refreshed (planBoard coordinatorRefreshOf). */
  refreshed?: string | null
  canOpenSession?: (sessionId: string) => boolean
  onOpenSession?: (sessionId: string) => void
  /** W8-B: present, each card shows its AI and human lines (components/attribution) */
  projectPath?: string
  /** W9-I: the plan's tab summaries by Task; a card whose Task has one says what it did */
  summaries?: ReadonlyMap<string, SessionSummary>
  /** T8: what an expanded row adds under its own detail (the completion checks and the Task's changes). */
  renderDetail?: (task: JobTask) => React.ReactNode
  /** T2: what an expanded row shows first: everything about the Task (TaskDetail) and its Edit and Request changes. */
  renderAbout?: (task: JobTask) => React.ReactNode
  /** T19: simple mode: a row's detail drops its model, account, branch, commits and files */
  compact?: boolean
  /** T9: the clock of "resumes in …" and "… ago", the live read's tick (usePlanLive): one timer for the whole board. */
  nowMs?: number
  /** Present: every step not done ends with "Add task to this step", handing over the previous step's Task ids. */
  onAddTask?: (deps: string[]) => void
  /** Present: a blocked Task with no Gate gets Continue and a failed one Retry (planCommands taskActionOf). */
  onRestart?: (taskId: string) => void
  /** Why the owner's buttons are off (a read-only plan), or undefined. */
  lockedReason?: string
}): React.JSX.Element {
  const { t } = useI18n()
  // T9: each Task's slice of the timeline and the feed, cut once when they change, so a row reads its own and a tick
  // costs the Tasks plus the events, not the Tasks times the events
  const eventsOf = useMemo(() => byTask(events), [events])
  const activityOf = useMemo(() => byTask(activity), [activity])
  const [roleModels, setRoleModels] = useState<RoleModelSettings>({})
  useEffect(() => {
    void window.api?.settings?.getRoleModels?.().then(setRoleModels).catch(() => {})
  }, [])
  const label = (id: string): string => accounts?.find((a) => a.id === id)?.label ?? id
  const waves = wavesOf(tasks, layers)
  const current = currentWaveOf(waves)
  // T4: finished waves fold to one line; a click flips a wave from its default. T8: the wave of the expanded Task opens.
  const folded = collapsedWavesOf(waves)
  const [flipped, setFlipped] = useState<ReadonlySet<number>>(() => new Set())
  const flip = (i: number): void => setFlipped((cur) => { const n = new Set(cur); if (!n.delete(i)) n.add(i); return n })
  // T4: the kind filter shows when the Tasks carry more than one kind; the steps keep their numbers and counts, the cards narrow
  const kinds = useMemo(() => kindsOf(tasks), [tasks])
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const kind = kinds.some((k) => k.kind === kindFilter) ? kindFilter : 'all'
  const rank = (tk: JobTask): number => CATEGORIES.indexOf(categoryOf(tk))
  // a long board draws only the Task rows on screen (each step's list windows itself)
  let estimatedTop = 0 // where the next step's list starts, for the first render's window
  const virtual = waves.reduce((n, w) => n + filterByKind(w.tasks, kind).length, 0) > VIRTUAL_AFTER_ROWS
  return (
    <div className="plan-board plan-waves">
      {kinds.length > 1 && (
        <div className="plan-kind-filter">
          <Select
            className="dense"
            ariaLabel={t('plan.kind.filter')}
            value={kind}
            onChange={(v) => setKindFilter(v as KindFilter)}
            items={[
              { value: 'all', label: t('plan.kind.all', { n: tasks.length }) },
              ...kinds.map((k) => ({ value: k.kind, label: t('plan.kind.option', { kind: t(`plan.kind.${k.kind}`), n: k.count }), icon: <Icon name={KIND_ICON[k.kind]} size={14} /> }))
            ]}
          />
        </div>
      )}
      {waves.map((w, wi) => {
        const shown = filterByKind(w.tasks, kind)
        if (shown.length === 0) return null
        const listTop = estimatedTop
        const isCurrent = w.index === current
        const percent = Math.floor((w.done * 100) / w.tasks.length)
        const hidden = folded.has(w.index) !== flipped.has(w.index) && !w.tasks.some((tk) => tk.id === selected)
        estimatedTop += WAVE_HEAD_ESTIMATE + (hidden ? 0 : shown.length * ROW_ESTIMATE)
        const progress = t('plan.wave.progress', { done: w.done, total: w.tasks.length })
        const step = stepStateOf(w, waves, replanning)
        return (
          <section
            key={w.index}
            className={`plan-wave${isCurrent ? ' plan-wave-current' : ''}${hidden ? ' plan-wave-folded' : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <h3 className="plan-wave-head">
              <Button
                variant="ghost"
                size="sm"
                className="plan-wave-fold"
                aria-expanded={!hidden}
                icon={<Icon name={hidden ? 'chevronRight' : 'chevronDown'} size={14} />}
                onClick={() => flip(w.index)}
              >
                {t('plan.steps.title', { n: w.index + 1 })}
              </Button>
              <StepStateChip step={step} />
              <span className="plan-wave-count">{progress}</span>
              <Meter className="plan-meter plan-wave-bar" value={percent} />
              {isCurrent && <span className="plan-wave-now">{t('plan.wave.current')}</span>}
            </h3>
            {!hidden && step.state === 'waiting' && (
              <p className="plan-wave-waits">{t(step.left === 1 ? 'plan.steps.startsWhen.one' : 'plan.steps.startsWhen', { n: step.on, count: step.left })}</p>
            )}
            {!hidden && isCurrent && refreshed !== null && (
              <div className="plan-wave-banner" role="status">
                {t('plan.steps.leadRefreshed', { reason: refreshed })}
              </div>
            )}
            {!hidden && isCurrent && replanning && (
              <div className="plan-wave-banner" role="status">
                {t('plan.steps.replanning', { n: w.index + 1 })}
              </div>
            )}
            {!hidden && (
              <WaveCards
                tasks={[...shown].sort((x, y) => rank(x) - rank(y))}
                virtual={virtual}
                top={listTop + WAVE_HEAD_ESTIMATE}
                reveal={selected}
                renderRow={(tk, rowRef) => (
                  <TaskRow
                    key={tk.id}
                    rowRef={rowRef}
                    task={tk}
                    reuse={reuseOf(tk, tasks, deps)}
                    expanded={selected === tk.id}
                    nowMs={nowMs}
                    label={label}
                    model={cardModelOf(tk, roleModels, accounts ?? [])}
                    effort={cardEffortOf(tk, roleModels, accounts ?? [])}
                    now={nowOf(tk, tk.sessionId ? sessions[tk.sessionId] : undefined, eventsOf.get(tk.id) ?? NONE, nowMs)}
                    answers={autoAnswersOf(activityOf.get(tk.id) ?? NONE, tk.id)}
                    onSelect={onSelect}
                    projectPath={projectPath}
                    summary={summaries?.get(tk.id)}
                    detail={selected === tk.id ? renderDetail?.(tk) : undefined}
                    about={selected === tk.id ? renderAbout?.(tk) : undefined}
                    compact={compact}
                    onRestart={onRestart}
                    lockedReason={lockedReason}
                    onOpenConsole={
                      tk.sessionId && categoryOf(tk) === 'running' && onOpenSession && canOpenSession?.(tk.sessionId)
                        ? () => onOpenSession(tk.sessionId!)
                        : undefined
                    }
                  />
                )}
              />
            )}
            {!hidden && onAddTask && step.state !== 'done' && (
              <Button variant="ghost" size="sm" className="plan-wave-add" icon={<Icon name="add" size={14} />} onClick={() => onAddTask(wi === 0 ? [] : waves[wi - 1].tasks.map((tk) => tk.id))}>
                {t('plan.steps.addTask')}
              </Button>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Height of a collapsed Task row until it has been drawn once (--list-row-h) */
const ROW_ESTIMATE = 24
/** A step's heading line, and the gap under it, until laid out */
const WAVE_HEAD_ESTIMATE = 40

/** One step's Task rows. `virtual`: only the rows on screen are drawn, the rest is the list's padding. A selected row
 *  that is out of the window is scrolled in (the callers that jump to a Task look it up by its anchor afterwards). */
function WaveCards({
  tasks,
  virtual,
  top,
  reveal,
  renderRow
}: {
  tasks: readonly JobTask[]
  virtual: boolean
  /** Estimated distance from the board's top to this list (the steps above it) */
  top: number
  reveal: string | undefined
  renderRow: (task: JobTask, rowRef: (el: HTMLElement | null) => void) => React.ReactNode
}): React.JSX.Element {
  const vr = useVirtualRows<HTMLUListElement>(tasks.map((tk) => tk.id), () => ROW_ESTIMATE, virtual, top)
  useLayoutEffect(() => {
    if (reveal !== undefined) vr.revealKey(reveal)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new selection scrolls
  }, [reveal])
  return (
    <ul ref={vr.listRef} className="plan-wave-cards" style={virtual ? { paddingTop: vr.before, paddingBottom: vr.after } : undefined}>
      {tasks.slice(vr.start, vr.end).map((tk) => renderRow(tk, vr.measure(tk.id)))}
    </ul>
  )
}

const STEP_CHIP: Record<StepState['state'], { tone: ChipTone; icon: IconName }> = {
  done: { tone: 'ok', icon: 'done' },
  running: { tone: 'info', icon: 'active' },
  ready: { tone: 'neutral', icon: 'queued' },
  waiting: { tone: 'neutral', icon: 'waiting' },
  blocked: { tone: 'warn', icon: 'circleAlert' },
  failed: { tone: 'danger', icon: 'error' },
  replanning: { tone: 'info', icon: 'refresh' }
}

function StepStateChip({ step }: { step: StepState }): React.JSX.Element {
  const { t } = useI18n()
  const { tone, icon } = STEP_CHIP[step.state]
  return (
    <Chip tone={tone} className="plan-wave-state">
      <Icon name={icon} size={14} />
      {t(`plan.steps.state.${step.state}`)}
    </Chip>
  )
}

/** T8 "Needs you": every open question and Gate of the plan, full width, each under its Task's name with its answer
 *  box (QuestionAnswer). Nothing when none is open. */
export function NeedsYou({
  items,
  onAnswer,
  onShowTask
}: {
  /** planBoard needsYouOf */
  items: ReturnType<typeof needsYouOf>
  onAnswer: (id: string, answer: string) => Promise<string | null>
  /** Scrolls to the Task's row and expands it. */
  onShowTask: (taskId: string) => void
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <ul className="plan-needs-list">
      {items.map(({ task, q }) => (
        <li key={q.id} className="plan-needs-item">
          <Button variant="ghost" size="sm" className="plan-needs-task" icon={<TaskGlyph task={task} size={14} />} onClick={() => onShowTask(task.id)}>
            {task.title}
          </Button>
          <QuestionAnswer q={q} onAnswer={onAnswer} />
        </li>
      ))}
    </ul>
  )
}

const NONE: readonly never[] = []

/** Rows by their Task, in their order; rows of no Task are left out. */
function byTask<T extends { taskId?: string }>(rows: readonly T[]): Map<string, T[]> {
  const by = new Map<string, T[]>()
  for (const r of rows) if (r.taskId !== undefined) by.get(r.taskId)?.push(r) ?? by.set(r.taskId, [r])
  return by
}

function TaskRow({
  rowRef,
  task: tk,
  reuse,
  expanded,
  nowMs,
  label,
  model,
  effort,
  now,
  answers,
  onSelect,
  onOpenConsole,
  projectPath,
  summary,
  detail,
  about,
  compact,
  onRestart,
  lockedReason
}: {
  /** The windowed list's measure of this row */
  rowRef?: (el: HTMLElement | null) => void
  task: JobTask
  /** T4: the worktree this Task continues in (planBoard reuseOf), or null */
  reuse: ReturnType<typeof reuseOf>
  expanded: boolean
  nowMs: number
  label: (id: string) => string
  model: string | undefined
  effort: string | undefined
  now: ReturnType<typeof nowOf>
  answers: ReturnType<typeof autoAnswersOf>
  onSelect: (taskId: string) => void
  /** Present for a running Task whose tab is open. */
  onOpenConsole?: () => void
  projectPath?: string // W8-B
  summary?: SessionSummary // W9-I
  detail?: React.ReactNode
  about?: React.ReactNode
  compact: boolean
  onRestart?: (taskId: string) => void
  lockedReason?: string
}): React.JSX.Element {
  const { t } = useI18n()
  const action = taskActionOf(tk)
  const [allFiles, setAllFiles] = useState(false)
  const [showAnswers, setShowAnswers] = useState(false)
  const reason = tk.board?.reason
  const text = reason ? reasonText(reason, nowMs, label) : undefined
  const account = tk.accountId ?? tk.accountIds?.[0]
  const files = tk.affectedPaths ?? []
  const shown = allFiles ? files : files.slice(0, FILES_SHOWN)
  const line = now ? t(now.key, now.params) : reason && text ? t(text.key, text.params) : undefined
  return (
    <li ref={rowRef} id={taskAnchorId(tk.id)} className={`plan-card plan-cat-${categoryOf(tk)}${expanded ? ' selected' : ''}`}>
      <div className="plan-row">
        {/* The title is the row's toggle: one button, so a click anywhere on the name expands it */}
        <Button
          variant="ghost"
          size="sm"
          className="plan-card-title"
          aria-expanded={expanded}
          aria-label={t(expanded ? 'plan.row.collapse' : 'plan.row.expand', { task: tk.title })}
          icon={<TaskGlyph task={tk} size={14} />}
          onClick={() => onSelect(tk.id)}
        >
          {tk.title}
        </Button>
        {tk.kind !== undefined && (
          <Chip className={`plan-kind plan-kind--${tk.kind}`}>
            <Icon name={KIND_ICON[tk.kind]} size={14} />
            {t(`plan.kind.${tk.kind}`)}
          </Chip>
        )}
        {tk.isMerge === true && (
          <Chip tone="info" className="plan-kind-merge">
            <Icon name="merge" size={14} />
            {t('plan.kind.merge')}
          </Chip>
        )}
        {line !== undefined && <span className={reason && !now ? `plan-row-line plan-row-line--${reasonTone(reason)}` : 'plan-row-line plan-now'}>{line}</span>}
        <span className="plan-row-meta">
          {account !== undefined && <span className="plan-row-account">{label(account)}</span>}
          {!compact && (
            <span className="plan-row-account" title={tk.effortNote}>
              {[model ?? t('plan.card.cliDefault'), effort].filter(Boolean).join(' · ')}
            </span>
          )}
          {tk.attempts !== undefined && <span className="plan-card-attempts">{t(tk.attempts === 1 ? 'plan.card.attempts.one' : 'plan.card.attempts', { n: tk.attempts })}</span>}
        </span>
        {action !== undefined && onRestart && (
          <Button size="sm" className="plan-row-action" disabled={lockedReason !== undefined} title={lockedReason} icon={<Icon name="refresh" size={14} />} onClick={() => onRestart(tk.id)}>
            {t(`plan.task.${action}`)}
          </Button>
        )}
        {onOpenConsole && (
          <Button variant="ghost" size="sm" className="plan-link plan-row-console" title={t('plan.card.focus')} icon={<Icon name="open" size={14} />} onClick={onOpenConsole}>
            {t('plan.row.openConsole')}
          </Button>
        )}
      </div>
      {reuse !== null && (
        <p className="plan-row-reuse">
          <Icon name="branch" size={14} />
          {reuse.title !== undefined ? t('plan.card.reuses', { task: reuse.title }) : t('plan.card.reusesDep')}
        </p>
      )}
      {expanded && (
        <div className="plan-row-detail">
          {about}
          {reason && text && now && <span className={`plan-reason plan-reason-${reasonTone(reason)}`}>{t(text.key, text.params)}</span>}
          {summary && <span className="summary-line" title={summary.text || undefined}>{summaryOneLine(summary, t)}</span>}
          {!compact && (
            <dl className="plan-card-meta">
              <dt>{t('plan.card.model')}</dt>
              <dd>{model ?? t('plan.card.cliDefault')}</dd>
              {effort !== undefined && (
                <>
                  <dt>{t('plan.task.effort')}</dt>
                  <dd title={tk.effortNote}>{effort}</dd>
                </>
              )}
              {tk.branch !== undefined && (
                <>
                  <dt>{t('plan.card.branch')}</dt>
                  <dd title={tk.branch}>
                    {/* W9-J: the Task's worktree, found by its branch in the registry, on the Worktrees page. W12: the tooltip says
                        what a worktree is. */}
                    <Tooltip content={t('plan.steps.worktreeHint')}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="branch-link"
                        icon={<Icon name="branch" size={14} />}
                        onClick={() => {
                          void window.api.worktrees.list().then((ws) => {
                            const w = ws.find((x) => x.branch === tk.branch)
                            if (w) openWorktree(w.path)
                          }, () => {})
                        }}
                      >
                        {tk.branch}
                      </Button>
                    </Tooltip>
                  </dd>
                </>
              )}
              {projectPath && <TaskLines projectPath={projectPath} commits={tk.links?.commits ?? []} />}
            </dl>
          )}
          {!compact && files.length > 0 && (
            <ul className="plan-card-files">
              {shown.map((p) => (
                <li key={p} title={p}>
                  {p}
                </li>
              ))}
              {files.length > FILES_SHOWN && (
                <li>
                  <Button variant="ghost" size="sm" className="plan-link" aria-expanded={allFiles} onClick={() => setAllFiles((v) => !v)}>
                    {allFiles ? t('plan.card.fewerFiles') : t('plan.card.moreFiles', { n: files.length - FILES_SHOWN })}
                  </Button>
                </li>
              )}
            </ul>
          )}
          {answers.length > 0 && (
            <div className="plan-answers">
              <Button
                variant="ghost"
                size="sm"
                className="plan-link"
                aria-expanded={showAnswers}
                icon={<Icon name={showAnswers ? 'chevronDown' : 'chevronRight'} size={14} />}
                onClick={() => setShowAnswers((v) => !v)}
              >
                {t(answersKey(answers.length), { n: answers.length })}
              </Button>
              {showAnswers && (
                <ol className="plan-answers-list">
                  {answers.map((a, i) => (
                    <li key={i}>
                      <span className="plan-answer-q">{a.question}</span>
                      <span className="plan-answer-a">{a.answer}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          {detail}
        </div>
      )}
    </li>
  )
}
