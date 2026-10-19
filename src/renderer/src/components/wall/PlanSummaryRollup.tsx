// W9-I: the plan Overview's "What happened so far": the plan's worker cards, oldest first (the order
// rollupMarkdown gives the PR body). Nothing until a Task's tab has ended.
import type { SessionSummary } from '../../../../core/sessions/summary'
import { useI18n } from '../../i18n/I18nProvider'
import { Section } from '../ui/Section'
import { SummaryCard } from './SummaryCard'

export function PlanSummaryRollup({
  summaries,
  canOpenSession,
  onOpenSession
}: {
  summaries: readonly SessionSummary[]
  canOpenSession?: (sessionId: string) => boolean
  onOpenSession?: (sessionId: string) => void
}): React.JSX.Element | null {
  const { t } = useI18n()
  const rows = summaries.filter((s) => s.facts.role === 'worker').sort((a, b) => a.at.localeCompare(b.at))
  if (rows.length === 0) return null
  return (
    <Section id="plan-summary-rollup" label={t('summary.rollup.title')} count={rows.length}>
      <div className="summary-rollup">
        {rows.map((s) => (
          <SummaryCard key={s.sessionId} summary={s} compact {...(onOpenSession && canOpenSession?.(s.sessionId) !== false ? { onOpen: () => onOpenSession(s.sessionId) } : {})} />
        ))}
      </div>
    </Section>
  )
}
