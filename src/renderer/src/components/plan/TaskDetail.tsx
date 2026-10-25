// T2 Task details: everything about one Task in its expanded row, read from the Host (taskEdit.ts loadTaskInfo): its
// spec, acceptance criteria, deps by title, kind, difficulty and model reason, what the planner found, the worker
// prompt (folded), its result and gaps, and its attempts. Then the owner's two actions: Edit (TaskEditModal, under
// taskEditOf's rules) and Request changes (`jobs-feedback` naming this Task). Simple mode shows the spec and criteria,
// and the two actions; a finished Task adds its result and gaps (taskDoneView) and "Ask about this task".
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JobTask } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { postPlanFeedback, type ActionUi } from '../../lib/jobActions'
import { replyNote, type OrchDoor } from '../../lib/orchDoor'
import { Button, Field, Icon, IconButton } from '../ui'
import { TaskEditModal } from './TaskEditModal'
import { taskActionKey, taskActionOf } from './planCommands'
import { doneViewOf, foldReport } from './taskDoneView'
import { attemptStateOf, feedbackTextOf, loadTaskInfo, taskEditOf, type TaskInfo } from './taskEdit'

export function TaskDetail({
  door,
  jobId,
  task,
  tasks,
  ui,
  compact = false,
  accountLabel,
  onShowTask,
  onRestart,
  onAsk
}: {
  door: OrchDoor
  /** The plan's Job: where a change request goes. */
  jobId: string
  task: JobTask
  /** The plan's Tasks: deps by title, and the edit form's dependency choices. */
  tasks: readonly JobTask[]
  ui: ActionUi
  compact?: boolean
  accountLabel: (id: string) => string
  /** Expands that Task's row and scrolls to it. */
  onShowTask: (taskId: string) => void
  /** Present: Continue / Retry / Restart for a Task taskActionOf names. */
  onRestart?: (taskId: string) => void
  /** Present: "Ask about this task" on a finished Task (planCommands askAboutTaskWithToast). */
  onAsk?: (taskId: string) => Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const [info, setInfo] = useState<TaskInfo | null | 'loading'>('loading')
  const [reload, setReload] = useState(0)
  const [showPrompt, setShowPrompt] = useState(false)
  const [copied, setCopied] = useState(false)
  const [wholeReport, setWholeReport] = useState(false)
  const [starting, setStarting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [asking, setAsking] = useState(false)
  const [request, setRequest] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  /** The Host's refusal of the change request, said in the box ("was not planned: there is no planner…") */
  const [refused, setRefused] = useState<string | null>(null)
  // Read again when the board says the Task moved (a new status or attempt), and after a save
  useEffect(() => {
    let live = true
    loadTaskInfo(door, task.id).then(
      (i) => live && setInfo(i),
      () => live && setInfo(null)
    )
    return () => {
      live = false
    }
    // the door is made per render by its callers; the Task's id and progress are what change the answer
  }, [task.id, task.status, task.attempts, reload])

  if (info === 'loading') return <p className="plan-task-note">{t('plan.task.loading')}</p>
  if (info === null) return <p className="plan-task-note">{t('plan.task.loadFailed')}</p>
  const full = info.task
  const criteria = full.acceptanceCriteria ?? []
  const done = full.status === 'completed'
  const view = doneViewOf(full)
  const report = full.result === undefined ? null : foldReport(full.result)
  // The worker's report and its gaps: a finished Task shows them in simple mode too; advanced mode lists them after the prompt
  const reportBlock = (
    <>
      {report !== null && (
        <section className="plan-task-part" aria-label={t('plan.task.result')}>
          <h4 className="plan-task-head">{t('plan.task.result')}</h4>
          <p className="plan-task-spec plan-task-report">{wholeReport || !report.folded ? full.result : `${report.head}…`}</p>
          {report.folded && (
            <Button variant="ghost" size="sm" className="plan-link" aria-expanded={wholeReport} onClick={() => setWholeReport((v) => !v)}>
              {t(wholeReport ? 'plan.done.showLess' : 'plan.done.showAll')}
            </Button>
          )}
        </section>
      )}
      {full.gaps !== undefined && (
        <section className="plan-task-part" aria-label={t('plan.task.gaps')}>
          <h4 className="plan-task-head">{t('plan.task.gaps')}</h4>
          <p className="plan-task-spec plan-task-gaps">{full.gaps}</p>
        </section>
      )}
    </>
  )
  const action = taskActionOf(task)
  const titleOf = (id: string): string => tasks.find((tk) => tk.id === id)?.title ?? id
  const edit = taskEditOf({ ...full, dispatches: info.attempts.length }, { outcome: info.outcome })

  const send = async (): Promise<void> => {
    if (sending || !request.trim()) return
    setSending(true)
    setRefused(null)
    // a send that throws is already said by postPlanFeedback (ui.error)
    const reply = await postPlanFeedback(door, jobId, feedbackTextOf(full, request), ui)
    setSending(false)
    if (reply === null) return
    if (reply.status >= 400) {
      const said = (reply.body as { error?: unknown } | null)?.error
      setRefused(replyNote(reply, t as never, typeof said === 'string' ? said : t('plan.talk.failed')))
      return
    }
    setSent(true)
    setRequest('')
  }

  return (
    <div className="plan-task">
      {full.spec && <p className="plan-task-spec">{full.spec}</p>}
      {criteria.length > 0 && (
        <section className="plan-task-part" aria-label={t('plan.task.criteria')}>
          <h4 className="plan-task-head">{t('plan.task.criteria')}</h4>
          <ul className="plan-task-criteria">
            {criteria.map((c, i) => (
              <li key={i}>
                <Icon name={done ? 'done' : 'pending'} size={14} />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {compact && view.finished && reportBlock}
      {!compact && (
        <>
          {full.deps.length > 0 && (
            <div className="plan-task-deps">
              <span className="plan-task-head">{t('plan.task.deps')}</span>
              {full.deps.map((id) => (
                <Button key={id} variant="ghost" size="sm" className="plan-link" onClick={() => onShowTask(id)}>
                  {titleOf(id)}
                </Button>
              ))}
            </div>
          )}
          {(full.kind !== undefined || full.difficulty !== undefined || full.effort !== undefined || full.modelReason !== undefined || full.basis !== undefined) && (
            <dl className="plan-card-meta">
              {full.kind !== undefined && (
                <>
                  <dt>{t('plan.task.kind')}</dt>
                  <dd>{t(`plan.kind.${full.kind}`)}</dd>
                </>
              )}
              {full.difficulty !== undefined && (
                <>
                  <dt>{t('plan.task.difficulty')}</dt>
                  <dd>{t(`plan.task.difficulty.${full.difficulty}`)}</dd>
                </>
              )}
              {full.effort !== undefined && (
                <>
                  <dt>{t('plan.task.effort')}</dt>
                  <dd>{full.effort}</dd>
                </>
              )}
              {full.modelReason !== undefined && (
                <>
                  <dt>{t('plan.task.modelReason')}</dt>
                  <dd>{full.modelReason}</dd>
                </>
              )}
              {full.basis !== undefined && (
                <>
                  <dt>{t('plan.task.basis')}</dt>
                  <dd>{t(`plan.task.basis.${full.basis.state}`)}</dd>
                  <dt>{t('plan.task.evidence')}</dt>
                  <dd className="plan-task-evidence">{full.basis.evidence}</dd>
                </>
              )}
            </dl>
          )}
          {full.prompt !== undefined && (
            <div className="plan-task-part">
              <div className="plan-task-prompt-bar">
                <Button
                  variant="ghost"
                  size="sm"
                  className="plan-link"
                  aria-expanded={showPrompt}
                  icon={<Icon name={showPrompt ? 'chevronDown' : 'chevronRight'} size={14} />}
                  onClick={() => setShowPrompt((v) => !v)}
                >
                  {t(showPrompt ? 'plan.task.hidePrompt' : 'plan.task.showPrompt')}
                </Button>
                {showPrompt && (
                  <IconButton
                    size="sm"
                    icon={<Icon name={copied ? 'check' : 'copy'} size={14} />}
                    label={t(copied ? 'plan.task.copied' : 'plan.task.copyPrompt')}
                    onClick={() => {
                      window.api.clipboard.writeText(full.prompt ?? '')
                      setCopied(true)
                    }}
                  />
                )}
              </div>
              {showPrompt && (
                <pre className="plan-task-prompt" tabIndex={0}>
                  {full.prompt}
                </pre>
              )}
            </div>
          )}
          {reportBlock}
          {info.attempts.length > 0 && (
            <section className="plan-task-part" aria-label={t('plan.task.attempts')}>
              <h4 className="plan-task-head">{t('plan.task.attempts')}</h4>
              <ol className="plan-task-attempts">
                {info.attempts.map((a) => (
                  <li key={a.id}>
                    {t(a.review ? 'plan.task.attempt.review' : a.repair ? 'plan.task.attempt.repair' : 'plan.task.attempt.work')}
                    {' · '}
                    {t(`plan.task.attempt.${attemptStateOf(a)}`)}
                    {' · '}
                    {accountLabel(a.accountId)}
                    {' · '}
                    <time dateTime={a.startedAt}>{new Date(a.startedAt).toLocaleString()}</time>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
      {/* Simple mode keeps the owner's two actions: they are how a plan that is not quite right is fixed */}
      <div className="plan-task-actions">
        {action !== undefined && onRestart && (
          <>
            <Button size="sm" icon={<Icon name="refresh" size={14} />} disabled={door.readOnlyReason !== null} title={door.readOnlyReason ?? undefined} onClick={() => onRestart(task.id)}>
              {t(taskActionKey(action))}
            </Button>
            {/* The hold reason; non-compact already shows the result section above */}
            {action === 'continue' && compact && full.result !== undefined && <span className="plan-task-spec">{full.result}</span>}
          </>
        )}
        {view.ask && onAsk && (
          <Button
            size="sm"
            icon={<Icon name="terminal" size={14} />}
            loading={starting}
            disabled={starting || door.readOnlyReason !== null}
            title={door.readOnlyReason ?? t('plan.done.askHint')}
            onClick={() => {
              setStarting(true)
              void onAsk(task.id).finally(() => setStarting(false))
            }}
          >
            {t('plan.done.ask')}
          </Button>
        )}
        <Button
          size="sm"
          icon={<Icon name="edit" size={14} />}
          disabled={edit.fields === 'none' || door.readOnlyReason !== null}
          title={edit.fields === 'none' ? t(edit.reason) : (door.readOnlyReason ?? undefined)}
          onClick={() => setEditing(true)}
        >
          {t('plan.task.edit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Icon name="message" size={14} />}
          aria-expanded={asking}
          disabled={door.readOnlyReason !== null}
          onClick={() => {
            setAsking((v) => !v)
            setSent(false)
            setRefused(null)
          }}
        >
          {t('plan.task.requestChanges')}
        </Button>
      </div>
      {asking && (
        <div className="plan-task-request">
          <Field
            kind="textarea"
            label={t('plan.task.requestLabel')}
            hint={t('plan.task.requestHint')}
            rows={3}
            value={request}
            autoFocus
            onChange={(e) => {
              setRequest(e.target.value)
              setSent(false)
              setRefused(null)
            }}
          />
          <div className="plan-task-actions">
            <Button size="sm" variant="primary" loading={sending} disabled={sending || !request.trim()} onClick={() => void send()}>
              {t('plan.task.requestSend')}
            </Button>
            {sent && (
              <span className="plan-task-sent" role="status">
                <Icon name="done" size={14} />
                {t('plan.task.requestSent')}
              </span>
            )}
          </div>
          {refused !== null && (
            <p className="warn plan-task-refused" role="alert">
              {refused}
            </p>
          )}
        </div>
      )}
      {/* Portalled: a row's content-visibility (plan.css) would hold a fixed overlay inside the row */}
      {editing &&
        createPortal(
          <TaskEditModal
            door={door}
            task={full}
            tasks={tasks}
            edit={edit}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false)
              setReload((n) => n + 1)
            }}
          />,
          document.body
        )}
    </div>
  )
}
