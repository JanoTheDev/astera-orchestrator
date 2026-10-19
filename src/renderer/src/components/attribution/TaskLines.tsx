import { useEffect, useState } from 'react'
import { statsOf, type AttributionStats } from './attribution'
import './attribution.css'
import { useI18n } from '../../i18n/I18nProvider'

/** W8-B: one plan card's AI and human lines, from `attribution-stats` over that Task's commits (`Task.links.commits`).
 *  Nothing while there is nothing to say (no commits, no stats, or no lines yet). */
export function TaskLines({ projectPath, commits }: { projectPath: string; commits: readonly string[] }): React.JSX.Element | null {
  const [stats, setStats] = useState<AttributionStats | null>(null)
  const key = commits.join(',')
  useEffect(() => {
    let live = true
    if (key === '') return setStats(null)
    void window.api.orch
      .command(projectPath, 'attribution-stats', { commits: key.split(',') })
      .then((r) => live && setStats(r.status === 200 ? statsOf(r.body) : null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [projectPath, key])
  return <TaskLinesView stats={stats} />
}

export function TaskLinesView({ stats }: { stats: AttributionStats | null }): React.JSX.Element | null {
  const { t } = useI18n()
  if (!stats || stats.ai_additions + stats.human_additions === 0) return null
  return (
    <>
      <dt>{t('attribution.lines')}</dt>
      <dd className="attr-task-lines">
        <span className="attr-chip attr-ai">AI</span> {stats.ai_additions}{' '}
        <span className="attr-chip attr-human">H</span> {stats.human_additions}
        <span className="attr-sr">
          {' '}
          {t('attribution.taskLinesSr', { ai: stats.ai_additions, human: stats.human_additions })}
        </span>
      </dd>
    </>
  )
}
