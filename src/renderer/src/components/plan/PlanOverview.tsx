// W2-C plan overview: progress and one count per bucket, each bucket named apart (SPEC §9: done, failed, cancelled
// and awaiting review never read as one another).
import type { JobRow, JobTask } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { CATEGORIES, planProgressOf } from './planBoard'

/** #119 "Picked for this plan" (the issues Let Astera pick took or left out) and #117 "Decided for you" (what the
 *  hands-off plan answered in the owner's place). Each is hidden when empty. */
function PlanDecided({ pick, decisions }: Pick<JobRow, 'pick' | 'decisions'>): React.JSX.Element | null {
  const { t } = useI18n()
  const picked = pick?.picked ?? []
  const skipped = pick?.skipped ?? []
  if (picked.length === 0 && skipped.length === 0 && !decisions?.length) return null
  return (
    <div className="plan-decided">
      {(picked.length > 0 || skipped.length > 0) && (
        <section>
          <h3>{t('plan.pick.title')}</h3>
          <ul>
            {picked.map((i) => (
              <li key={`p${i.number}`}>{t('plan.pick.picked', { n: i.number, title: i.title, why: i.why })}</li>
            ))}
            {skipped.map((i) => (
              <li key={`s${i.number}`} className="plan-decided-skipped">{t('plan.pick.skipped', { n: i.number, title: i.title, why: i.why })}</li>
            ))}
          </ul>
        </section>
      )}
      {decisions && decisions.length > 0 && (
        <section>
          <h3>{t('plan.decisions.title')}</h3>
          <ul>
            {decisions.map((d) => (
              <li key={`${d.at}${d.question}`}>
                <strong>{t(`plan.decisions.kind.${d.kind}` as const)}</strong> {d.question} → {d.choice}
                <span className="plan-decided-why"> {d.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export function PlanOverview({ tasks, pick, decisions }: { tasks: readonly JobTask[] } & Pick<JobRow, 'pick' | 'decisions'>): React.JSX.Element {
  const { t } = useI18n()
  const p = planProgressOf(tasks)
  if (p.total === 0)
    return (
      <div className="plan-overview plan-overview-empty">
        {t('plan.overview.empty')}
        <PlanDecided pick={pick} decisions={decisions} />
      </div>
    )
  return (
    <div className="plan-overview">
      <div
        className="plan-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.percent}
        aria-label={t('plan.overview.progress', { percent: p.percent, done: p.counts.done, total: p.total })}
      >
        <div className="plan-progress-fill" style={{ width: `${p.percent}%` }} />
      </div>
      <span className="plan-progress-text">
        {t('plan.overview.progress', { percent: p.percent, done: p.counts.done, total: p.total })}
      </span>
      <ul className="plan-counts">
        {CATEGORIES.map((c) => (
          <li key={c} className={`plan-count plan-cat-${c}${p.counts[c] === 0 ? ' plan-count-zero' : ''}`}>
            <span className="plan-count-n">{p.counts[c]}</span> {t(`plan.cat.${c}`)}
          </li>
        ))}
      </ul>
      <PlanDecided pick={pick} decisions={decisions} />
    </div>
  )
}
