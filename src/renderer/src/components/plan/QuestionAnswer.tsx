// W7-C (#72): the owner's answer box on a Task's card: an open `astera ask` question or an escalation, its options as
// buttons and a text box. The parent sends `questions-answer`; on success the data poll drops the question, and this
// box hides at once.
import { useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import type { OpenQuestion } from './planBoard'

export function QuestionAnswer({ q, onAnswer }: { q: OpenQuestion; onAnswer: (id: string, answer: string) => Promise<string | null> }): React.JSX.Element | null {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  if (sent) return null
  const send = async (answer: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const err = await onAnswer(q.id, answer)
      if (err === null) setSent(true)
      else setError(err)
    } catch {
      setError(t('plan.question.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="plan-question" onClick={(e) => e.stopPropagation()}>
      <b>{t('plan.question.from')}</b>
      <p className="detail-gate-question">{q.question}</p>
      {q.options && q.options.length > 0 && (
        <div className="detail-gate-options">
          {q.options.map((o) => (
            <button key={o} type="button" disabled={busy} onClick={() => void send(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
      {q.freeText !== false && (
        <>
          <textarea rows={2} value={text} placeholder={t('plan.question.placeholder')} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => void send(text.trim())}>
            {t('plan.question.send')}
          </button>
        </>
      )}
      {error && <p className="warn">{error}</p>}
    </div>
  )
}
