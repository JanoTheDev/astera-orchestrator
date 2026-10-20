// W9-H: one console full size (DESIGN.md §2). The slim header and the details panel; the console itself is the
// session's own pane (PaneGrid, mounted for the session's life), so keys go to that PTY and nowhere else. There is no
// Astera input box and no chat UI here (DESIGN §0).
import { ArrowLeft, CheckSquare, GitBranch, Keyboard, Square, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { useI18n } from '../../i18n/I18nProvider'
import { formatElapsed } from '../../../../core/orchestration/elapsed'
import type { Account } from '../../../../core/types'
import { Button, Icon, IconButton, cx } from '../ui'
import { openWorktree } from '../shell/navigation'
import { StateChip } from './Wall'
import type { ConsoleDetails, WallConsole } from './wallModel'

export function ConsoleHeader({
  c,
  projectName,
  detailsOpen,
  onToggleDetails,
  onBack,
  onClose
}: {
  c: WallConsole
  projectName: string | null
  detailsOpen: boolean
  onToggleDetails: () => void
  onBack: () => void
  /** T8: closes this console (the page confirms first when it is busy or plan-owned). */
  onClose: () => void
}): React.JSX.Element {
  const { t } = useI18n()
  const crumbs = [projectName, c.planName, c.label].filter((x): x is string => !!x)
  return (
    <div className="wall-console-head">
      <Button size="sm" variant="ghost" icon={<Icon icon={ArrowLeft} size={14} />} onClick={onBack}>
        {t('wall.console.back')}
      </Button>
      <span className="wall-console-head__sep" aria-hidden="true" />
      <span className="wall-console-head__titles">
        <span className="wall-console-head__crumbs" title={crumbs.join(' › ')}>{crumbs.join(' › ')}</span>
        {c.taskTitle && <span className="wall-console-head__task">{c.taskTitle}</span>}
      </span>
      <StateChip c={c} />
      {c.model && <span className="wall-console-head__meta">{c.model}</span>}
      <span className="wall-console-head__meta wall-console-head__cwd" title={c.cwd}>
        {c.cwd}
      </span>
      <span className="wall-console-head__hold" title={t('wall.console.hold')}>
        <Icon icon={Keyboard} size={14} />
        <span className="wall-console-head__hold-text">{t('wall.console.hold')}</span>
      </span>
      <IconButton
        size="sm"
        label={t('wall.console.details')}
        active={detailsOpen}
        aria-pressed={detailsOpen}
        icon={<Icon icon={detailsOpen ? PanelRightClose : PanelRightOpen} size={14} />}
        onClick={onToggleDetails}
      />
      <IconButton size="sm" label={t('wall.close.label', { name: c.label })} icon={<Icon icon={X} size={14} />} onClick={onClose} />
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="wall-details__row">
      <span className="wall-details__label">{label}</span>
      <span className="wall-details__value">{children}</span>
    </div>
  )
}

/** The details panel, per role, from the Host's data only (wallModel.detailsOf). */
export function DetailsPanel({
  d,
  accounts,
  nowMs,
  onOpenConsole,
  onOpenPlan
}: {
  d: ConsoleDetails
  accounts: readonly Account[]
  nowMs: number
  onOpenConsole: (sessionId: string) => void
  onOpenPlan: (jobId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const account = d.accountId ? (accounts.find((a) => a.id === d.accountId)?.label ?? d.accountId) : undefined
  return (
    <aside className="wall-details">
      {d.task && (
        <section className="wall-details__section">
          <h3 className="wall-details__title">{d.task.title}</h3>
          {d.task.brief && <p className="wall-details__brief">{d.task.brief}</p>}
          {d.task.startedAt && <Row label={t('wall.details.running')}>{formatElapsed(d.task.startedAt, nowMs)}</Row>}
          {d.model && <Row label={t('wall.details.model')}>{d.model}</Row>}
          {account && <Row label={t('wall.details.account')}>{account}</Row>}
          <Row label={t('wall.details.worktree')}>
            {/* W9-J: a Task's console works in its worktree; the link opens it on the Worktrees page */}
            <button type="button" className="branch-link" title={d.cwd} onClick={() => openWorktree(d.cwd)}>
              <Icon icon={GitBranch} size={14} />
              {d.task.branch ?? d.cwd}
            </button>
          </Row>
          <Row label={t('wall.details.files')}>{d.task.files.length > 0 ? d.task.files.join(', ') : t('wall.details.none')}</Row>
          <Row label={t('wall.details.questions')}>{d.task.gate ?? (d.task.openGates > 0 ? String(d.task.openGates) : t('wall.details.none'))}</Row>
        </section>
      )}
      {d.review && (
        <section className="wall-details__section">
          <Row label={t('wall.details.criteria')}>{t('wall.details.round', { round: d.review.round, max: d.review.max })}</Row>
        </section>
      )}
      {d.task && d.task.criteria.length > 0 && (
        <section className="wall-details__section">
          <h4 className="wall-details__head">{d.review ? t('wall.details.criteria') : t('wall.details.doneWhen')}</h4>
          <ul className="wall-details__criteria">
            {d.task.criteria.map((cr) => (
              <li key={cr.text} className={cx(cr.met && 'wall-details__criterion--met')}>
                <Icon icon={cr.met ? CheckSquare : Square} size={14} /> {cr.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      {d.role === 'coordinator' && (
        <section className="wall-details__section">
          <Row label={t('wall.details.answered')}>{d.answered ?? 0}</Row>
          <Row label={t('wall.details.escalated')}>{d.escalated ?? 0}</Row>
        </section>
      )}
      {!d.task && d.role !== 'coordinator' && (
        <section className="wall-details__section">
          {d.model && <Row label={t('wall.details.model')}>{d.model}</Row>}
          {account && <Row label={t('wall.details.account')}>{account}</Row>}
          <Row label={t('wall.details.folder')}>{d.cwd}</Row>
          {!d.plan && <p className="wall-details__brief">{t('wall.details.noPlan')}</p>}
        </section>
      )}
      {d.plan && (
        <section className="wall-details__section">
          <h4 className="wall-details__head">
            {d.role === 'planner' ? t('wall.details.planned') : t('wall.details.tasks')}
            <span className="wall-details__progress">{t('wall.details.progress', { done: d.plan.done, total: d.plan.total })}</span>
          </h4>
          <ul className="wall-details__tasks">
            {d.plan.tasks.map((tk) => (
              <li key={tk.id}>
                <button
                  type="button"
                  className="wall-details__task"
                  onClick={() => (tk.sessionId ? onOpenConsole(tk.sessionId) : onOpenPlan(d.plan!.jobId))}
                >
                  <span className={`wall-dot wall-dot--cat-${tk.category}`} aria-hidden="true" />
                  <span className="wall-details__task-title">{tk.title}</span>
                  <span className="wall-details__task-who">{tk.who ?? t(`plan.cat.${tk.category}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
