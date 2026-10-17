// W2-C plan overview: progress and one count per bucket, each bucket named apart (SPEC §9: done, failed, cancelled
// and awaiting review never read as one another).
import type { JobTask } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { CATEGORIES, planProgressOf } from './planBoard'

export function PlanOverview({ tasks }: { tasks: readonly JobTask[] }): React.JSX.Element {
  const { t } = useI18n()
  const p = planProgressOf(tasks)
  if (p.total === 0) return <div className="plan-overview plan-overview-empty">{t('plan.overview.empty')}</div>
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
    </div>
  )
}
