import { useEffect, useState } from 'react'
import { breakdownOf, lastDeliveryOf, percentAi, statsOf, type AttributionStats } from './attribution'
import './attribution.css'
import { useI18n } from '../../i18n/I18nProvider'

/** W8-B: the project page's "Who wrote this": % AI, split by agent and model (`tool_model_breakdown`), for the last
 *  push delivery and for all time, from `attribution-stats` (W8-A). The last delivery is the newest Run's
 *  `delivery.sha` (`runs-list`). */
export function ProjectAttribution({ anchor, projectId }: { anchor: string; projectId: string }): React.JSX.Element {
  const [all, setAll] = useState<AttributionStats | null>(null)
  const [last, setLast] = useState<AttributionStats | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    const stats = async (args: Record<string, unknown>): Promise<AttributionStats | null> => {
      const r = await window.api.orch.command(anchor, 'attribution-stats', args)
      return r.status === 200 ? statsOf(r.body) : null
    }
    void stats({ range: 'HEAD' }).then((s) => live && setAll(s), () => {})
    void (async () => {
      const runs = await window.api.orch.command(anchor, 'runs-list', { project: projectId })
      const sha = runs.status === 200 ? lastDeliveryOf(runs.body) : undefined
      // the delivery's merge against its first parent: everything that delivery brought in
      const s = sha === undefined ? undefined : await stats({ range: `${sha}^1..${sha}` })
      if (live) setLast(s)
    })().catch(() => {})
    return () => {
      live = false
    }
  }, [anchor, projectId])
  return <ProjectAttributionView all={all} last={last} />
}

export function ProjectAttributionView({
  all,
  last
}: {
  all: AttributionStats | null
  /** undefined: no push delivery yet */
  last?: AttributionStats | null
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <section className="field attr-project" aria-label={t('attribution.whoWrote')}>
      <label>{t('attribution.whoWrote')}</label>
      <StatsBlock title={t('attribution.lastDelivery')} stats={last === undefined ? null : last} empty={last === undefined ? t('attribution.noDelivery') : t('attribution.unrecorded')} />
      <StatsBlock title={t('attribution.allTime')} stats={all} empty={t('attribution.unrecorded')} />
    </section>
  )
}

function StatsBlock({ title, stats, empty }: { title: string; stats: AttributionStats | null; empty: string }): React.JSX.Element {
  const { t } = useI18n()
  const pct = stats ? percentAi(stats) : null
  return (
    <div className="attr-stats">
      <div className="attr-stats-head">
        <span>{title}</span>
        <span>{pct === null ? '—' : t('attribution.pctAi', { percent: pct })}</span>
      </div>
      {stats && pct !== null ? (
        <ul>
          {breakdownOf(stats).map((b) => (
            <li key={b.name}>
              <span className="attr-chip attr-ai">AI</span> {t('attribution.agentLines', { name: b.name, lines: b.lines, percent: b.percent })}
            </li>
          ))}
          <li>
            <span className="attr-chip attr-human">H</span> {t('attribution.humanLines', { lines: stats.human_additions, percent: 100 - pct })}
          </li>
        </ul>
      ) : (
        <p className="attr-empty">{empty}</p>
      )}
    </div>
  )
}
