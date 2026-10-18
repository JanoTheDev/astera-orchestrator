import { useEffect, useState } from 'react'
import { statsOf, type AttributionStats } from './attribution'
import './attribution.css'

/** W8-B: one plan card's AI and human lines, from `attribution-stats` for that Task. Nothing while there is nothing
 *  to say (no stats, or no lines yet). */
export function TaskLines({ projectPath, taskId }: { projectPath: string; taskId: string }): React.JSX.Element | null {
  const [stats, setStats] = useState<AttributionStats | null>(null)
  useEffect(() => {
    let live = true
    // shortcut: `task` is the filter this view needs from W8-A's attribution-stats; agree the argument name on merge
    void window.api.orch
      .command(projectPath, 'attribution-stats', { task: taskId, json: true })
      .then((r) => live && setStats(r.status === 200 ? statsOf(r.body) : null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [projectPath, taskId])
  return <TaskLinesView stats={stats} />
}

export function TaskLinesView({ stats }: { stats: AttributionStats | null }): React.JSX.Element | null {
  if (!stats || stats.ai_additions + stats.human_additions === 0) return null
  return (
    <>
      <dt>Lines</dt>
      <dd className="attr-task-lines">
        <span className="attr-chip attr-ai">AI</span> {stats.ai_additions}{' '}
        <span className="attr-chip attr-human">H</span> {stats.human_additions}
        <span className="attr-sr">
          {' '}
          ({stats.ai_additions} AI lines, {stats.human_additions} human lines)
        </span>
      </dd>
    </>
  )
}
