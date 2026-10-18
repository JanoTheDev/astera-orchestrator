// W7-A "Talk to the planner": the owner's feedback on a plan, before approval or while it runs, with what the planner
// changed for each message; reject while it waits; and the notice of a plan that started on its own.
import { useState, type JSX } from 'react'
import type { JobRow } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import type { OrchDoor } from '../../lib/orchDoor'
import { rejectPlan, sendPlanFeedback, stopRun, type ActionUi } from '../../lib/jobActions'
import { planTalkView } from './planTalk'

export function PlanTalk({ row, door, ui, name }: { row: JobRow; door: OrchDoor; ui: ActionUi; name: string }): JSX.Element | null {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const view = planTalkView(row)
  if (!view.show) return null

  const send = async (): Promise<void> => {
    if (sending || !text.trim()) return
    setSending(true)
    try {
      if (await sendPlanFeedback(door, row.id, text.trim(), ui)) setText('')
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
          <button type="button" disabled={door.readOnlyReason != null} onClick={() => void stopRun(door, row.foldedRunId ?? row.id, name, ui)}>
            {t('plan.talk.stop')}
          </button>
        </div>
      )}
      {/* W8-F (#94): what keeps Run from working, before it is pressed */}
      {row.pendingStart === true && row.planProblems !== undefined && row.planProblems.length > 0 && (
        <div className="plan-talk-problems" role="alert">
          <p>{t('plan.talk.problems')}</p>
          <ul>
            {row.planProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {row.feedback && row.feedback.length > 0 && (
        <ul className="plan-talk-history">
          {row.feedback.map((f) => (
            <li key={f.at}>
              <span className="plan-talk-msg">{f.text}</span>
              {f.phase === 'run' && <span className="plan-talk-phase">{t('plan.talk.duringRun')}</span>}
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
          ))}
        </ul>
      )}
      <div className="plan-talk-form">
        <textarea
          aria-label={t('plan.talk.input')}
          placeholder={t('plan.talk.placeholder')}
          value={text}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button type="button" disabled={sending || !text.trim() || door.readOnlyReason != null} onClick={() => void send()}>
          {t('plan.talk.send')}
        </button>
      </div>
      {view.canReject &&
        (rejecting ? (
          <div className="plan-talk-reject">
            <input aria-label={t('plan.talk.reason')} placeholder={t('plan.talk.reasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" onClick={() => void reject()}>
              {t('plan.talk.reject')}
            </button>
            <button type="button" onClick={() => setRejecting(false)}>
              {t('plan.talk.cancel')}
            </button>
          </div>
        ) : (
          <div className="plan-talk-reject">
            <button type="button" disabled={door.readOnlyReason != null} onClick={() => setRejecting(true)}>
              {t('plan.talk.reject')}
            </button>
          </div>
        ))}
    </section>
  )
}
