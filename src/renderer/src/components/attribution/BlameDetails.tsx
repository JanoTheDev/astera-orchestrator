import { useEffect, useRef, useState } from 'react'
import { markerOf, type BlameLine } from './attribution'
import { useI18n } from '../../i18n/I18nProvider'

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
  const { t } = useI18n()
  const [step, setStep] = useState(initialStep)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [l])
  const m = markerOf(l, t)
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
        <span>{t('attribution.line', { line: l.line })}</span>
        <button type="button" ref={first} className="attr-close" aria-label={t('common.close')} onClick={onClose}>
          ×
        </button>
      </div>
      {l.kind === 'ai' ? (
        <dl className="attr-meta">
          <dt>{t('attribution.field.task')}</dt>
          <dd>{l.task ?? t('attribution.none')}</dd>
          {l.job && (
            <>
              <dt>{t('attribution.field.job')}</dt>
              <dd>{l.job}</dd>
            </>
          )}
          {step === 'session' ? (
            <>
              <dt>{t('attribution.field.session')}</dt>
              <dd>{l.session ?? t('attribution.none')}</dd>
              <dt>{t('attribution.field.agent')}</dt>
              <dd>{[l.agent, l.model].filter(Boolean).join(' / ') || t('attribution.unknown')}</dd>
              {l.account && (
                <>
                  <dt>{t('attribution.field.account')}</dt>
                  <dd>{l.account}</dd>
                </>
              )}
              {l.role && (
                <>
                  <dt>{t('attribution.field.role')}</dt>
                  <dd>{l.role}</dd>
                </>
              )}
            </>
          ) : (
            <dd className="attr-more">
              <button type="button" onClick={() => setStep('session')}>
                {t('attribution.showSession')}
              </button>
            </dd>
          )}
        </dl>
      ) : (
        <p className="attr-meta">
          {l.sha
            ? t(l.kind === 'human' ? 'attribution.byPersonIn' : 'attribution.unrecordedIn', { sha: l.sha.slice(0, 8) })
            : t(l.kind === 'human' ? 'attribution.byPerson' : 'attribution.unrecorded')}
        </p>
      )}
    </div>
  )
}
