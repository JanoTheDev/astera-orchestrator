// W7-A "Talk to the planner": the owner's feedback on a plan, before approval, while it runs or once it has finished, with
// what the planner changed for each message; reject while it waits; and the notice of a plan that started on its own.
// T4: what a message did is said after it is sent (typed, queued behind a replan, reopened the plan), a queued entry
// carries a mark until the planner answers it, and a planner that waits on a question offers a way to its tab.
import { useState, type JSX } from 'react'
import type { JobRow } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { replyNote } from '../../lib/orchDoor'
import { openPlanChat, postPlanFeedback, rejectPlan, stopRun, type ActionUi } from '../../lib/jobActions'
import { openConsole } from '../shell/navigation'
import { Button, Chip, Icon, Input, Textarea } from '../ui'
import { canChat, feedbackMark, feedbackOutcomeOf, planTalkView, plannerWaitingIn, type FeedbackOutcome } from './planTalkModel'

/** The sentence under the box for what the message did. */
const OUTCOME_KEY = { sent: 'plan.talk.sent', queued: 'plan.talk.queuedNotice', reopened: 'plan.talk.reopened' } as const satisfies Record<FeedbackOutcome, string>

export function PlanTalk({ row, door, ui, name }: { row: JobRow; door: OrchDoor; ui: ActionUi; name: string }): JSX.Element | null {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  // T4: what the last message did, or that the planner is waiting on a question (its tab answers it)
  const [result, setResult] = useState<FeedbackOutcome | 'waiting' | null>(null)
  const view = planTalkView(row)
  if (!view.show) return null

  const send = async (): Promise<void> => {
    if (sending || !text.trim()) return
    setSending(true)
    setResult(null)
    try {
      const reply = await postPlanFeedback(door, row.id, text.trim(), ui)
      if (reply === null) return
      if (reply.status < 400) {
        setText('')
        setResult(feedbackOutcomeOf(reply.body, row))
      } else if (plannerWaitingIn(reply)) setResult('waiting')
      else ui.error(replyNote(reply, ui.t, ui.t('plan.talk.failed')))
    } finally {
      setSending(false)
    }
  }
  const reject = async (): Promise<void> => {
    if (await rejectPlan(door, row.id, name, reason, ui)) setRejecting(false)
  }

  return (
    <section className="plan-talk" aria-label={t('plan.talk.title')}>
      <h4 className="plan-talk-head">{t('plan.talk.title')}</h4>
      {view.autoStarted !== null && (
        <div className="plan-talk-auto">
          <span>{t('plan.talk.autoStarted', { count: view.autoStarted })}</span>
          <Button size="sm" variant="ghost" icon={<Icon name="stop" size={14} />} disabled={door.readOnlyReason != null} onClick={() => void stopRun(door, row.foldedRunId ?? row.id, name, ui)}>
            {t('plan.talk.stop')}
          </Button>
        </div>
      )}
      {/* W8-F (#94): what keeps Run from working, before it is pressed */}
      {row.pendingStart === true && row.planProblems !== undefined && row.planProblems.length > 0 && (
        <div className="plan-talk-problems" role="alert">
          <p>{t(row.autoApprove === true || row.handsOff === true ? 'plan.talk.waitingPlanner' : 'plan.talk.problems')}</p>
          <ul>
            {row.planProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {row.feedback && row.feedback.length > 0 && (
        <ul className="plan-talk-history">
          {row.feedback.map((f) => {
            const mark = feedbackMark(f)
            return (
              <li key={f.at}>
                <span className="plan-talk-msg">{f.text}</span>
                {mark === 'queued' && (
                  <Chip tone="info" className="plan-talk-queued">
                    <Icon name="queued" size={14} />
                    {t('plan.talk.queued')}
                  </Chip>
                )}
                {mark === 'duringRun' && <span className="plan-talk-phase">{t('plan.talk.duringRun')}</span>}
                {f.changes === undefined ? (
                  <p className="plan-talk-wait">{t('plan.talk.waiting')}</p>
                ) : (
                  <ul className="plan-talk-changes">
                    {f.changes.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="plan-talk-form">
        <Textarea
          aria-label={t('plan.talk.input')}
          placeholder={t('plan.talk.placeholder')}
          value={text}
          disabled={sending}
          onChange={(e) => {
            setText(e.target.value)
            setResult(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        {/* secondary, not primary: the overview's Start is this view's one filled button */}
        <Button size="sm" loading={sending} disabled={!text.trim() || door.readOnlyReason != null} title={t('plan.talk.placeholder')} onClick={() => void send()}>
          {t('plan.talk.send')}
        </Button>
        {/* the plan's chat tab, in every phase; a paired Runtime's has no tab on this computer */}
        {canChat(row) && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Icon name="message" size={14} />}
            disabled={door.readOnlyReason != null || door.runtimeId !== undefined}
            title={door.runtimeId !== undefined ? t('plan.chat.remote') : t('plan.chat.hint')}
            onClick={() => void openPlanChat(door, row.id, ui)}
          >
            {t('plan.chat.label')}
          </Button>
        )}
      </div>
      {canChat(row) && <p className="plan-talk-wait">{t('plan.chat.diff')}</p>}
      {result === 'waiting' ? (
        <div className="plan-talk-waiting" role="alert">
          <span>{t('plan.talk.plannerWaiting')}</span>
          {row.plannerSessionId !== undefined && door.runtimeId === undefined && (
            <Button size="sm" variant="ghost" icon={<Icon name="open" size={14} />} onClick={() => openConsole(row.plannerSessionId!)}>
              {t('plan.talk.openPlanner')}
            </Button>
          )}
        </div>
      ) : (
        result !== null && (
          <p className="plan-talk-result" role="status">
            {t(OUTCOME_KEY[result])}
          </p>
        )
      )}
      {view.canReject &&
        (rejecting ? (
          <div className="plan-talk-reject">
            <Input
              autoFocus
              aria-label={t('plan.talk.reason')}
              placeholder={t('plan.talk.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setRejecting(false)
              }}
            />
            <Button size="sm" variant="danger" onClick={() => void reject()}>
              {t('plan.talk.reject')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              {t('plan.talk.cancel')}
            </Button>
          </div>
        ) : (
          <div className="plan-talk-reject">
            <Button size="sm" variant="ghost" disabled={door.readOnlyReason != null} onClick={() => setRejecting(true)}>
              {t('plan.talk.reject')}
            </Button>
          </div>
        ))}
    </section>
  )
}
