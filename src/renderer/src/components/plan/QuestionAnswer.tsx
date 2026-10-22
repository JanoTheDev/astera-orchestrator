// W7-C (#72): the owner's answer box on a Task's card: an open `astera ask` question or an escalation, its options as
// buttons and a text box. The parent sends `questions-answer`; on success the data poll drops the question, and this
// box hides at once.
import { useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Textarea } from '../ui'
import type { OpenQuestion } from './planBoard'

export function QuestionAnswer({
  q,
  onAnswer,
  autoFocus = false
}: {
  q: OpenQuestion
  onAnswer: (id: string, answer: string) => Promise<string | null>
  /** The first option (or the box, with no options) takes the focus. Off by default: a board or the Inbox shows many of
   *  these at once, and a list must not pull the focus to whichever one rendered last. */
  autoFocus?: boolean
}): React.JSX.Element | null {
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
          {q.options.map((o, i) => (
            <Button key={o} size="sm" autoFocus={autoFocus && i === 0} disabled={busy} onClick={() => void send(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      {q.freeText !== false && (
        <>
          <Textarea
            rows={2}
            value={text}
            aria-label={t('plan.question.placeholder')}
            placeholder={t('plan.question.placeholder')}
            autoFocus={autoFocus && !(q.options && q.options.length > 0)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim() && !busy) {
                e.preventDefault()
                void send(text.trim())
              }
            }}
          />
          {/* secondary: many questions can stand on one board, and a view has at most one filled button */}
          <Button size="sm" className="plan-question-send" loading={busy} disabled={!text.trim()} onClick={() => void send(text.trim())}>
            {t('plan.question.send')}
          </Button>
        </>
      )}
      {error && <p className="warn">{error}</p>}
    </div>
  )
}
