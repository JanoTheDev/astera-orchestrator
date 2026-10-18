// W9-I: the tab summaries (core/sessions/summary.ts) through a door, as the board and History read them. Read again
// when a session ends and on every orchestration push, and on a slow poll: the prose is written a little after the
// tab ends (a model call), and a remote Runtime's tabs send no local event.
import { useEffect, useMemo, useState } from 'react'
import type { SessionSummary } from '../../../core/sessions/summary'
import type { OrchDoor } from '../lib/orchDoor'
import { indexSummaries } from '../components/wall/summaryText'

const POLL_MS = 30_000
/** A burst of pushes (every orchestration write is one) reads once. */
const SETTLE_MS = 1_000

export function useSummaries(
  door: OrchDoor | null,
  jobId?: string
): { summaries: SessionSummary[]; byTask: Map<string, SessionSummary>; bySession: Map<string, SessionSummary> } {
  const [summaries, setSummaries] = useState<SessionSummary[]>([])
  useEffect(() => {
    setSummaries([])
    if (!door) return
    let alive = true
    let running = false
    const load = async (): Promise<void> => {
      if (running) return
      running = true
      try {
        const r = await door.command('summaries', jobId === undefined ? {} : { job: jobId })
        // A 409 (no Host) or a 500 keeps what is shown; a card is never an error on screen.
        if (alive && r.status === 200 && Array.isArray(r.body)) {
          const next = r.body as SessionSummary[]
          setSummaries((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next))
        }
      } catch {
        /* no Host yet: the next signal tries again */
      } finally {
        running = false
      }
    }
    void load()
    let settle: ReturnType<typeof setTimeout> | undefined
    const soon = (): void => {
      clearTimeout(settle)
      settle = setTimeout(() => void load(), SETTLE_MS)
    }
    const offs = [window.api.on('session:exit', soon), window.api.on('session:remote-exit', soon), window.api.on('orch:state', soon)]
    const timer = setInterval(() => void load(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
      clearTimeout(settle)
      for (const off of offs) off()
    }
  }, [door, jobId])
  const index = useMemo(() => indexSummaries(summaries), [summaries])
  return { summaries, ...index }
}
