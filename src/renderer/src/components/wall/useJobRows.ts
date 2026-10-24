// W9-H: each project's Jobs fold (JobRow, JobTask with taskBoardsOf's `board`), keyed for the wall's progress and
// details by every id a plan looks up (indexJobRows). Read through `jobs-view`, the fold the Host already makes for a
// remote Jobs view, rather than `orch.list`: that one is the Jobs sidebar's single subscription, and a second
// subscriber would unwatch it.
import { useEffect, useState } from 'react'
import type { JobRow, OrchSnapshot } from '../../../../core/types'
import { pollWhileVisible } from '../../lib/visiblePoll'
import { indexJobRows } from './wallModel'

/** As often as the workspace tree is read (useWorkspaceData). `enabled` is false while the page is hidden. */
const POLL_MS = 5000

export function useJobRows(anchor: string | null, projectIds: readonly string[], enabled: boolean): Record<string, JobRow> {
  const [rows, setRows] = useState<Record<string, JobRow>>({})
  const key = projectIds.join('\n')
  useEffect(() => {
    if (!enabled || !anchor || projectIds.length === 0) return
    let alive = true
    let running = false
    const tick = async (): Promise<void> => {
      if (running) return
      running = true
      try {
        const views = await Promise.all(
          projectIds.map((project) =>
            window.api.orch.command(anchor, 'jobs-view', { project }).then(
              (r) => (r.status === 200 ? (r.body as { snapshot: OrchSnapshot }).snapshot.runs : []),
              () => [] as JobRow[]
            )
          )
        )
        if (!alive) return
        const next = indexJobRows(views.flat())
        setRows((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next))
      } finally {
        running = false
      }
    }
    const stop = pollWhileVisible(() => void tick(), POLL_MS)
    return () => {
      alive = false
      stop()
    }
    // `key` stands for the project ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, key, enabled])
  return rows
}
