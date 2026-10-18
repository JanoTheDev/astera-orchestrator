import { useEffect, useRef, useState } from 'react'
import { markerOf, type BlameLine } from './attribution'

/** W8-B: what a gutter chip opens. First the Task (and its Job), then, on request, the session that wrote the line:
 *  agent, model, account and session id. A human or unknown line shows its commit. Escape closes; focus starts on the
 *  first button so the keyboard path continues from the chip. */
export function BlameDetails({
  line: l,
  initialStep = 'task',
  onClose
}: {
  line: BlameLine
  initialStep?: 'task' | 'session'
  onClose: () => void
}): React.JSX.Element {
  const [step, setStep] = useState(initialStep)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [l])
  const m = markerOf(l)
  return (
    <div
      className="attr-details"
      role="dialog"
      aria-label={m.label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="attr-details-head">
        <span className={m.className} aria-hidden="true">
          {m.text}
        </span>
        <span>Line {l.line}</span>
        <button type="button" ref={first} className="attr-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {l.kind === 'ai' ? (
        <dl className="attr-meta">
          <dt>Task</dt>
          <dd>{l.task ?? 'none recorded'}</dd>
          {l.job && (
            <>
              <dt>Job</dt>
              <dd>{l.job}</dd>
            </>
          )}
          {step === 'session' ? (
            <>
              <dt>Session</dt>
              <dd>{l.session ?? 'none recorded'}</dd>
              <dt>Agent</dt>
              <dd>{[l.agent, l.model].filter(Boolean).join(' / ') || 'unknown'}</dd>
              {l.account && (
                <>
                  <dt>Account</dt>
                  <dd>{l.account}</dd>
                </>
              )}
              {l.role && (
                <>
                  <dt>Role</dt>
                  <dd>{l.role}</dd>
                </>
              )}
            </>
          ) : (
            <dd className="attr-more">
              <button type="button" onClick={() => setStep('session')}>
                Show session
              </button>
            </dd>
          )}
        </dl>
      ) : (
        <p className="attr-meta">
          {l.kind === 'human' ? 'Written by a person' : 'No attribution recorded'}
          {l.sha ? ` in ${l.sha.slice(0, 8)}` : ''}.
        </p>
      )}
    </div>
  )
}
