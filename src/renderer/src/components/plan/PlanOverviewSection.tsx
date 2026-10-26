// The plan tab's summary card, Goal and "So far" (T8; once the Overview section, moved out of pages/PlanPage.tsx): T3's
// card of counts, progress, time, step and delivery; the objective, folded after four lines, with what was picked, decided
// and left out; and, in advanced mode, per-account usage and what each console did so far.
import { useState } from 'react'
import type { JobRow } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { PlanSummaryRollup } from '../wall/PlanSummaryRollup' // W9-I
import { UsageStrip } from '../usage/UsageStrip'
import { openPr } from '../../lib/jobActions'
import type { OrchDoor } from '../../lib/orchDoor'
import { toast } from '../../lib/toast'
import { Button, Card, Icon, Meter, type IconName } from '../ui'
import { PlanDecided } from './PlanOverview'
import { durationText, planSummaryOf, type SummaryState } from './planSummary'
import type { PlanPageState } from './usePlanPage'

/** Each count's icon: the state reads from the icon and the word, never the colour alone. */
const STATE_ICON: Record<SummaryState, IconName> = { done: 'done', running: 'active', waiting: 'queued', failed: 'error', cancelled: 'remove' }

/** T3: the plan at a glance, from the row already on the page (no fetch). The time is read at render, to the minute. */
export function PlanSummaryCard({ run, door }: { run: JobRow; door?: OrchDoor }): React.JSX.Element {
  const { t } = useI18n()
  const s = planSummaryOf(run, Date.now())
  const link = s.link
  return (
    <Card className="plan-summary">
      <h2 className="plan-summary-title">{t('plan.summary.title')}</h2>
      {s.total === 0 ? (
        <p className="plan-summary-empty">{t('plan.summary.noTasks')}</p>
      ) : (
        <>
          <div className="plan-summary-progress">
            <span className="plan-summary-percent">{`${s.percent}%`}</span>
            <span className="plan-summary-done">{t('plan.wave.progress', { done: s.counts.find((c) => c.state === 'done')?.n ?? 0, total: s.total })}</span>
          </div>
          <Meter className="plan-meter" value={s.percent} />
          <ul className="plan-summary-counts">
            {s.counts.map(({ state, n }) => (
              <li key={state} className={`plan-summary-count plan-summary-count--${state}`}>
                <Icon name={STATE_ICON[state]} size={14} />
                <span className="plan-summary-n">{n}</span>
                <span>{t(`plan.summary.state.${state}`)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <dl className="plan-summary-facts">
        {s.wave && (
          <>
            <dt>{t('plan.summary.step')}</dt>
            <dd>{t('plan.steps.of', { at: s.wave.at, of: s.wave.of })}</dd>
          </>
        )}
        {s.time && (
          <>
            <dt>{t(s.time.kind === 'running' ? 'plan.summary.elapsed' : 'plan.summary.took')}</dt>
            <dd title={s.time.finishedAt !== undefined ? new Date(s.time.finishedAt).toLocaleString() : undefined}>{durationText(s.time.ms)}</dd>
          </>
        )}
        {(s.delivery || link) && (
          <>
            <dt>{t('plan.summary.delivery')}</dt>
            <dd className="plan-summary-delivery">
              {s.delivery && (
                <span className={s.delivery.kind === 'failed' ? 'plan-summary-delivery--fault' : undefined} title={'reason' in s.delivery ? s.delivery.reason : undefined}>
                  {s.delivery.kind === 'deliveredBy'
                    ? t('plan.summary.delivery.deliveredBy', { plan: s.delivery.title })
                    : t(`plan.summary.delivery.${s.delivery.kind}`)}
                </span>
              )}
              {link?.kind === 'pr' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="plan-summary-link"
                  icon={<Icon name={link.draft ? 'pullRequestDraft' : 'pullRequest'} size={14} />}
                  title={link.url}
                  onClick={() => void window.api.system.openExternal(link.url)}
                >
                  {[link.number !== undefined ? `#${link.number}` : t('github.link.runPr'), link.draft ? t('plan.summary.draft') : null].filter(Boolean).join(' · ')}
                </Button>
              )}
              {link?.kind === 'branch' && (
                <span className="plan-summary-branch">
                  <Icon name="branch" size={14} />
                  <span>{link.branch}</span>
                </span>
              )}
              {link?.kind === 'prFailed' && (
                <>
                  <span title={link.error}>{t('github.link.runPrFailed')}</span>
                  {door && door.readOnlyReason === null && (
                    <Button size="sm" variant="ghost" icon={<Icon name="rerun" size={14} />} onClick={() => void openPr(door, run.foldedRunId ?? run.id, { t: t as never, error: toast.error })}>
                      {t('plan.summary.retryPr')}
                    </Button>
                  )}
                </>
              )}
            </dd>
          </>
        )}
        {s.areas.length > 0 && (
          <>
            <dt>{t('plan.summary.areas')}</dt>
            <dd className="plan-summary-areas">{s.areas.join(', ')}</dd>
          </>
        )}
      </dl>
    </Card>
  )
}

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
