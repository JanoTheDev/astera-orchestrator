// W9-I: what a tab did, once it ended (DESIGN §4). The words are summaryText.ts's; this only lays them out. The
// Agents wall's Finished row (W9-H), the board and the plan roll-up draw it.
import type { SessionSummary } from '../../../../core/sessions/summary'
import { useI18n } from '../../i18n/I18nProvider'
import { Button, Card, Chip, Icon } from '../ui'
import { durationText, outcomeText, outcomeTone, summaryFactsLine } from './summaryText'
import './wall.css'

export function SummaryCard({ summary: s, compact = false, onOpen }: { summary: SessionSummary; compact?: boolean; onOpen?: () => void }): React.JSX.Element {
  const { t } = useI18n()
  const duration = durationText(s.durationMs, t)
  const ended = new Date(s.at)
  const facts = summaryFactsLine(s, t)
  const title = <span className="summary-card__title-text">{s.facts.title}</span>
  const ago = !Number.isNaN(ended.getTime()) && (
    <time dateTime={s.at} title={ended.toLocaleString()}>
      {t('summary.card.ended', { time: ended.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}
    </time>
  )
  // T13: the wall's card layout (wall.css `.wall-card`): title and outcome, one meta line, then the summary text
  return (
    <Card className={compact ? 'wall-card summary-card summary-card--compact' : 'wall-card summary-card'}>
      <div className="wall-card__head">
        {onOpen ? (
          <Button size="sm" variant="ghost" className="wall-card__title summary-card__title" title={t('summary.card.open')} onClick={onOpen}>
            {title}
          </Button>
        ) : (
          <span className="wall-card__title summary-card__title">{title}</span>
        )}
        <Chip tone={outcomeTone(s.outcome)}>{outcomeText(s, t)}</Chip>
      </div>
      <div className="wall-card__meta summary-card__meta">
        <span>{t(s.facts.role === 'worker' ? 'summary.role.worker' : 'summary.role.session')}</span>
        {duration && <span>{duration}</span>}
        {ago}
        {facts && <span>{facts}</span>}
        {s.facts.pr && (
          <Button
            size="sm"
            variant="ghost"
            className="summary-card__link"
            icon={<Icon name="external" size={14} />}
            title={s.facts.pr}
            onClick={() => void window.api.system.openExternal(s.facts.pr!)}
          >
            {t('summary.card.pr')}
          </Button>
        )}
      </div>
      {s.text && (
        <p className="wall-card__line summary-card__text" title={s.text}>
          {s.text}
        </p>
      )}
    </Card>
  )
}
