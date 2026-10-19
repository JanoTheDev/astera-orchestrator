// W2-C task board, grouped by wave since W6-E: one section per dependency depth ("Wave 1 · 3/4 done"), the current wave
// marked, and a replan in progress as a banner on it. Each card has its model, account, branch, attempts, its files,
// what its worker is doing now, the coordinator's answers to it and, when it is not running, why
// (core/orchestration/blocked.ts). Drawing only: the waves, reasons, counts and "now" lines are planBoard.ts's.
import { useEffect, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { Account, JobEvent, JobTask } from '../../../../core/types'
import { type RoleModelSettings } from '../../../../core/orchestration/roleModels'
import { useI18n } from '../../i18n/I18nProvider'
import { TaskGlyph } from '../JobIcons'
import {
  CATEGORIES,
  answersKey,
  autoAnswersOf,
  cardModelOf,
  categoryOf,
  currentWaveOf,
  nowOf,
  reasonText,
  reasonTone,
  wavesOf,
  gateQuestionsOfTask,
  questionsOfTask,
  type LiveSession,
  type OpenQuestion
} from './planBoard'
import { QuestionAnswer } from './QuestionAnswer'
import { Icon } from '../ui'
import { openWorktree } from '../shell/navigation' // W9-J
import { TaskLines } from '../attribution/TaskLines' // W8-B
import type { SessionSummary } from '../../../../core/sessions/summary'
import { summaryOneLine } from '../wall/summaryText' // W9-I
import '../wall/wall.css'
import './plan.css'

/** How often the "resumes in …" and "… ago" texts refresh. */
const TICK_MS = 5_000
/** Files a card lists before "+N more". */
const FILES_SHOWN = 3

export function TaskBoard({
  tasks,
  accounts,
  selected,
  onSelect,
  layers = [],
  events = [],
  activity = [],
  sessions = {},
  replanning = false,
  refreshed = null,
  questions = [],
  onAnswer,
  canOpenSession,
  onOpenSession,
  projectPath,
  summaries
}: {
  tasks: readonly JobTask[]
  accounts: Account[] | null
  selected: string | undefined
  onSelect: (taskId: string) => void
  /** W6-E: the plan's dependency depths (RunDetail `layers`). Empty puts every Task in one wave. */
  layers?: readonly string[][]
  /** W6-E: the Run's timeline, for a question to the coordinator still unanswered. */
  events?: readonly JobEvent[]
  /** W6-E: the activity feed's lines of this plan (auto-answered questions). */
  activity?: readonly ActivityEvent[]
  /** W6-E: the Host's word on each session, by session id. */
  sessions?: Readonly<Record<string, LiveSession>>
  replanning?: boolean
  /** Coordinator rotation: why the plan's coordinator was last refreshed (planBoard coordinatorRefreshOf). */
  refreshed?: string | null
  /** W7-C (#72): open asks and escalations; a Task's get an answer box. */
  questions?: readonly OpenQuestion[]
  /** Sends the owner's answer (`questions-answer`); resolves to an error text, or null when it went through. */
  onAnswer?: (id: string, answer: string) => Promise<string | null>
  canOpenSession?: (sessionId: string) => boolean
  onOpenSession?: (sessionId: string) => void
  /** W8-B: present, each card shows its AI and human lines (components/attribution) */
  projectPath?: string
  /** W9-I: the plan's tab summaries by Task; a card whose Task has one says what it did */
  summaries?: ReadonlyMap<string, SessionSummary>
}): React.JSX.Element {
  const { t } = useI18n()
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  const [roleModels, setRoleModels] = useState<RoleModelSettings>({})
  useEffect(() => {
    void window.api?.settings?.getRoleModels?.().then(setRoleModels).catch(() => {})
  }, [])
  const label = (id: string): string => accounts?.find((a) => a.id === id)?.label ?? id
  const waves = wavesOf(tasks, layers)
  const current = currentWaveOf(waves)
  const rank = (tk: JobTask): number => CATEGORIES.indexOf(categoryOf(tk))
  return (
    <div className="plan-board plan-waves">
      {waves.map((w) => {
        const isCurrent = w.index === current
        const percent = Math.floor((w.done * 100) / w.tasks.length)
        return (
          <section key={w.index} className={`plan-wave${isCurrent ? ' plan-wave-current' : ''}`} aria-current={isCurrent ? 'step' : undefined}>
            <h3 className="plan-wave-head">
              <span className="plan-wave-name">{t('plan.wave.title', { n: w.index + 1 })}</span>
              <span className="plan-wave-count">{t('plan.wave.progress', { done: w.done, total: w.tasks.length })}</span>
              <span
                className="plan-progress plan-wave-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={t('plan.wave.progress', { done: w.done, total: w.tasks.length })}
              >
                <span className="plan-progress-fill" style={{ width: `${percent}%` }} />
              </span>
              {isCurrent && <span className="plan-wave-now">{t('plan.wave.current')}</span>}
            </h3>
            {isCurrent && refreshed !== null && (
              <div className="plan-wave-banner" role="status">
                {t('plan.wave.coordinatorRefreshed', { reason: refreshed })}
              </div>
            )}
            {isCurrent && replanning && (
              <div className="plan-wave-banner" role="status">
                {t('plan.wave.replanning', { n: w.index + 1 })}
              </div>
            )}
            <div className="plan-wave-cards">
              {[...w.tasks]
                .sort((a, b) => rank(a) - rank(b))
                .map((tk) => (
                  <TaskCard
                    key={tk.id}
                    task={tk}
                    selected={selected === tk.id}
                    nowMs={nowMs}
                    label={label}
                    model={cardModelOf(tk, roleModels, accounts ?? [])}
                    now={nowOf(tk, tk.sessionId ? sessions[tk.sessionId] : undefined, events, nowMs)}
                    answers={autoAnswersOf(activity, tk.id)}
                    questions={onAnswer ? [...questionsOfTask(questions, tk.id), ...gateQuestionsOfTask(tk)] : []}
                    onAnswer={onAnswer}
                    onSelect={onSelect}
                    projectPath={projectPath}
                    summary={summaries?.get(tk.id)}
                    onFocus={
                      tk.sessionId && categoryOf(tk) === 'running' && onOpenSession && canOpenSession?.(tk.sessionId)
                        ? () => onOpenSession(tk.sessionId!)
                        : undefined
                    }
                  />
                ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function TaskCard({
  task: tk,
  selected,
  nowMs,
  label,
  model,
  now,
  answers,
  questions,
  onAnswer,
  onSelect,
  onFocus,
  projectPath,
  summary
}: {
  task: JobTask
  selected: boolean
  nowMs: number
  label: (id: string) => string
  model: string | undefined
  now: ReturnType<typeof nowOf>
  answers: ReturnType<typeof autoAnswersOf>
  questions: OpenQuestion[]
  onAnswer?: (id: string, answer: string) => Promise<string | null>
  onSelect: (taskId: string) => void
  /** Present for a running Task whose tab is open: a click on the card goes there. */
  onFocus?: () => void
  projectPath?: string // W8-B
  summary?: SessionSummary // W9-I
}): React.JSX.Element {
  const { t } = useI18n()
  const [allFiles, setAllFiles] = useState(false)
  const [showAnswers, setShowAnswers] = useState(false)
  const reason = tk.board?.reason
  const text = reason ? reasonText(reason, nowMs, label) : undefined
  const account = tk.accountId ?? tk.accountIds?.[0]
  const files = tk.affectedPaths ?? []
  const shown = allFiles ? files : files.slice(0, FILES_SHOWN)
  const activate = onFocus ?? (() => onSelect(tk.id))
  return (
    // The card is the click target; its title is the keyboard's (a button may not hold the buttons below it)
    <article className={`plan-card plan-cat-${categoryOf(tk)}${selected ? ' selected' : ''}`} onClick={activate}>
      <button
        type="button"
        className="plan-card-title"
        aria-pressed={selected}
        title={onFocus ? t('plan.card.focus') : undefined}
        onClick={(e) => {
          e.stopPropagation()
          activate()
        }}
      >
        <TaskGlyph task={tk} size={12} />
        <span>{tk.title}</span>
      </button>
      {now && <span className="plan-now">{t(now.key, now.params)}</span>}
      {reason && text && <span className={`plan-reason plan-reason-${reasonTone(reason)}`}>{t(text.key, text.params)}</span>}
      {summary && <span className="summary-line" title={summary.text || undefined}>{summaryOneLine(summary, t)}</span>}
      <dl className="plan-card-meta">
        <dt>{t('plan.card.model')}</dt>
        <dd>{model ?? t('plan.card.cliDefault')}</dd>
        {account !== undefined && (
          <>
            <dt>{t('plan.card.account')}</dt>
            <dd>{label(account)}</dd>
          </>
        )}
        {tk.branch !== undefined && (
          <>
            <dt>{t('plan.card.branch')}</dt>
            <dd title={tk.branch}>
              {/* W9-J: the Task's worktree, found by its branch in the registry, on the Worktrees page */}
              <button
                type="button"
                className="branch-link"
                onClick={(e) => {
                  e.stopPropagation()
                  void window.api.worktrees.list().then((ws) => {
                    const w = ws.find((x) => x.branch === tk.branch)
                    if (w) openWorktree(w.path)
                  }, () => {})
                }}
              >
                <Icon icon={GitBranch} size={14} />
                {tk.branch}
              </button>
            </dd>
          </>
        )}
        {projectPath && <TaskLines projectPath={projectPath} commits={tk.links?.commits ?? []} />}
      </dl>
      {files.length > 0 && (
        <ul className="plan-card-files">
          {shown.map((p) => (
            <li key={p} title={p}>
              {p}
            </li>
          ))}
          {files.length > FILES_SHOWN && (
            <li>
              <button
                type="button"
                className="plan-link"
                onClick={(e) => {
                  e.stopPropagation()
                  setAllFiles((v) => !v)
                }}
              >
                {allFiles ? t('plan.card.fewerFiles') : t('plan.card.moreFiles', { n: files.length - FILES_SHOWN })}
              </button>
            </li>
          )}
        </ul>
      )}
      {answers.length > 0 && (
        <div className="plan-answers">
          <button
            type="button"
            className="plan-link"
            aria-expanded={showAnswers}
            onClick={(e) => {
              e.stopPropagation()
              setShowAnswers((v) => !v)
            }}
          >
            {t(answersKey(answers.length), { n: answers.length })}
          </button>
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
      {onAnswer && questions.map((q) => <QuestionAnswer key={q.id} q={q} onAnswer={onAnswer} />)}
      {tk.attempts !== undefined && <span className="plan-card-attempts">{t('plan.card.attempts', { n: tk.attempts })}</span>}
    </article>
  )
}
