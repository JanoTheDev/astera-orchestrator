// W9-I: the tab summaries (core/sessions/summary.ts) through a door, as the board and History read them. Read again
// when a session ends and on every orchestration push, and on a slow poll: the prose is written a little after the
// tab ends (a model call), and a remote Runtime's tabs send no local event.
import { useEffect, useMemo, useState } from 'react'
import type { SessionSummary } from '../../../core/sessions/summary'
import type { OrchDoor } from '../lib/orchDoor'
import { sameOrNext } from '../lib/remoteSessions'
import { createSharedPoll } from './sharedPoll'
import { indexSummaries } from '../components/wall/summaryText'

const POLL_MS = 30_000
/** A burst of pushes (every orchestration write is one) reads once. */
const SETTLE_MS = 1_000

/** One poll per door and Job, shared by every reader (the board, the Agents page, each expanded History project). */
const summaryPoll = createSharedPoll<SessionSummary[]>(POLL_MS)

export function useSummaries(
  door: OrchDoor | null,
  jobId?: string
): { summaries: SessionSummary[]; byTask: Map<string, SessionSummary>; bySession: Map<string, SessionSummary> } {
  const [summaries, setSummaries] = useState<SessionSummary[]>([])
  const key = door ? `${door.runtimeId ?? ''}\n${door.projectKey}\n${jobId ?? ''}` : null
  useEffect(() => {
    setSummaries((p) => (p.length === 0 ? p : []))
    if (!door || key === null) return
    return summaryPoll.subscribe(
      key,
      {
        read: async () => {
          try {
            const r = await door.command('summaries', jobId === undefined ? {} : { job: jobId })
            // A 409 (no Host) or a 500 keeps what is shown; a card is never an error on screen.
            return r.status === 200 && Array.isArray(r.body) ? (r.body as SessionSummary[]) : undefined
          } catch {
            return undefined // no Host yet: the next signal tries again
          }
        },
        merge: (prev, next) => sameOrNext(prev ?? null, next),
        signals: (reload) => {
          let settle: ReturnType<typeof setTimeout> | undefined
          const soon = (): void => {
            clearTimeout(settle)
            settle = setTimeout(reload, SETTLE_MS)
          }
          const offs = [window.api.on('session:exit', soon), window.api.on('session:remote-exit', soon), window.api.on('orch:state', soon)]
          return () => {
            clearTimeout(settle)
            for (const off of offs) off()
          }
        }
      },
      setSummaries
    )
    // `key` stands for the door and the Job
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const index = useMemo(() => indexSummaries(summaries), [summaries])
  return { summaries, ...index }
}
