// The plan tab's Goal and "So far" (T8; once the Overview section, moved out of pages/PlanPage.tsx): the objective,
// folded after four lines, with what was picked, decided and left out; and, in advanced mode, per-account usage and
// what each console did so far.
import { useState } from 'react'
import type { JobRow } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { PlanSummaryRollup } from '../wall/PlanSummaryRollup' // W9-I
import { UsageStrip } from '../usage/UsageStrip'
import { Button } from '../ui'
import { PlanDecided } from './PlanOverview'
import type { PlanPageState } from './usePlanPage'

export function PlanGoal({ run }: { run: JobRow | undefined }): React.JSX.Element | null {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!run) return null
  // A short goal has nothing to unfold; the line count is a guess from its length and its lines, as the clamp is CSS's
  const long = run.objective.length > 400 || run.objective.split('\n').length > 4
  return (
    <>
      <p className={`plan-goal${open ? '' : ' plan-goal--folded'}`}>{run.objective}</p>
      {long && (
        <Button variant="ghost" size="sm" className="plan-link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {t(open ? 'plan.doc.goalLess' : 'plan.doc.goalMore')}
        </Button>
      )}
      {run.approvedFromChat && <p className="ui-field__hint">{t('plan.simple.approvedFromChat', { words: run.approvedFromChat.words })}</p>}
      <PlanDecided pick={run.pick} decisions={run.decisions} leftOut={run.leftOut} />
    </>
  )
}

/** W6-G per-account usage and W9-C what each console did, rolled up (DESIGN.md §4), or the empty hint. */
export function PlanSoFar({
  p,
  canOpenSession,
  onOpenSession
}: {
  p: PlanPageState
  canOpenSession: (sessionId: string) => boolean
  onOpenSession: (sessionId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const { tasks, accounts, summaries } = p
  const workers = summaries.summaries.some((s) => s.facts.role === 'worker')
  return (
    <>
      <UsageStrip accounts={accounts} tasks={tasks} />
      {workers ? (
        <PlanSummaryRollup summaries={summaries.summaries} canOpenSession={canOpenSession} onOpenSession={onOpenSession} />
      ) : (
        <p className="ui-field__hint">{t('pages.plan.soFarEmpty')}</p>
      )}
    </>
  )
}
