// W9-I: what a tab did, once it ended (DESIGN §4). The words are summaryText.ts's; this only lays them out. The
// Agents wall's Finished row (W9-H), the board and the plan roll-up draw it.
import type { SessionSummary } from '../../../../core/sessions/summary'
import { useI18n } from '../../i18n/I18nProvider'
import { Card } from '../ui/Card'
import { Chip } from '../ui/Chip'
import { durationText, outcomeText, outcomeTone, summaryFactsLine } from './summaryText'
import './wall.css'

export function SummaryCard({ summary: s, compact = false, onOpen }: { summary: SessionSummary; compact?: boolean; onOpen?: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const duration = durationText(s.durationMs, t)
  const ended = new Date(s.at)
  const facts = summaryFactsLine(s, t)
  const title = <span className="summary-card__title-text">{s.facts.title}</span>
  return (
    <Card className={compact ? 'summary-card summary-card--compact' : 'summary-card'}>
      <div className="summary-card__head">
        {onOpen ? (
          <button type="button" className="summary-card__title" title={t('summary.card.open')} onClick={onOpen}>
            {title}
          </button>
        ) : (
          <span className="summary-card__title">{title}</span>
        )}
        <span className="summary-card__role">{t(s.facts.role === 'worker' ? 'summary.role.worker' : 'summary.role.session')}</span>
        <Chip tone={outcomeTone(s.outcome)}>{outcomeText(s, t)}</Chip>
      </div>
      <div className="summary-card__when">
        {duration && <span>{duration}</span>}
        {!Number.isNaN(ended.getTime()) && (
          <time dateTime={s.at} title={ended.toLocaleString()}>
            {t('summary.card.ended', { time: ended.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}
          </time>
        )}
      </div>
      {s.text && <p className="summary-card__text">{s.text}</p>}
      {(facts || s.facts.pr) && (
        <div className="summary-card__facts">
          {facts && <span>{facts}</span>}
          {s.facts.pr && (
            <button type="button" className="summary-card__link" title={s.facts.pr} onClick={() => void window.api.system.openExternal(s.facts.pr!)}>
              {t('summary.card.pr')}
            </button>
          )}
        </div>
      )}
    </Card>
  )
}
