import { useState } from 'react'
import { markerOf, type BlameLine } from './attribution'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Modal } from '../ui'

/** W8-B: what a gutter chip opens. First the Task (and its Job), then, on request, the session that wrote the line:
 *  agent, model, account and session id. A human or unknown line shows its commit. It is a ui Modal: Esc and the close
 *  button close it, Tab stays inside, and focus goes back to the chip that opened it. */
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
  const m = markerOf(l, t)
  return (
    <Modal
      size="sm"
      onClose={onClose}
      closeLabel={t('common.close')}
      title={
        <span className="attr-details-title">
          <span className={m.className} title={m.label}>
            {m.text}
          </span>
          {t('attribution.line', { line: l.line })}
        </span>
      }
    >
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
              <Button variant="ghost" size="sm" onClick={() => setStep('session')}>
                {t('attribution.showSession')}
              </Button>
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
    </Modal>
  )
}
