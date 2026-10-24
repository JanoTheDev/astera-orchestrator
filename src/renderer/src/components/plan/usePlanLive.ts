// W6-E: what the plan view reads beside the snapshot, polled while it is open: the Host's word on each session
// (`sessions-list`: a prompt it waits on, its last tool call) and the activity feed's lines (auto-answered questions,
// replans). The feed is read as ActivityPanel reads it (mergePage), from the oldest line the Host holds.
// T9: given a Run (the plan Board), every read is that plan's only: sessions-list and questions-list filtered by the Host
// (`run`), and of the feed only its lines, the newest PLAN_ACTIVITY_MAX. One tick sets everything at once (one render),
// and its clock (`nowMs`) is the board's, so the board has one timer and not two.
import { useEffect, useState } from 'react'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { OrchDoor } from '../../lib/orchDoor'
import { pollWhileVisible } from '../../lib/visiblePoll'
import { mergePage } from '../activity/activityView'
import type { LiveSession, OpenQuestion } from './planBoard'

/** As often as the activity feed and the workspace tree are read. */
const POLL_MS = 5000
/** A full page of the feed: a shorter one is its end. */
const PAGE = 500
/** One plan's feed lines held: far more than its auto-answers and replans, and a bound however long it runs. */
export const PLAN_ACTIVITY_MAX = 1000

/** A `sessions-list` row (command.ts HostSession); the renderer does not import command.ts. */
type SessionRow = { id: string } & LiveSession

/** The rows as the board reads them; `prev` itself when nothing changed, so an idle tick draws nothing again. */
export function liveSessionsOf(rows: readonly SessionRow[], prev: Readonly<Record<string, LiveSession>>): Record<string, LiveSession> {
  const next: Record<string, LiveSession> = {}
  for (const s of rows)
    next[s.id] = { ...(s.prompt ? { prompt: s.prompt } : {}), ...(s.lastAction ? { lastAction: s.lastAction } : {}), ...(s.heavyWait ? { heavyWait: s.heavyWait } : {}) }
  return JSON.stringify(prev) === JSON.stringify(next) ? (prev as Record<string, LiveSession>) : next
}

/** The held lines of one plan with a page of the whole feed after them: its lines only, the newest PLAN_ACTIVITY_MAX.
 *  `held` itself when the page has none of them. A plan's own Run shares its id, so a line's run or Job matches. */
export function planActivityOf(held: ActivityEvent[], page: readonly ActivityEvent[], runId: string): ActivityEvent[] {
  const mine = page.filter((e) => e.runId === runId || e.jobId === runId)
  return mine.length === 0 ? held : mergePage(held, mine, PLAN_ACTIVITY_MAX)
}

export interface PlanLive {
  sessions: Record<string, LiveSession>
  activity: ActivityEvent[]
  questions: OpenQuestion[]
  /** When the last tick ran: the board's clock for "… ago" and "resumes in …". */
  nowMs: number
}

export function usePlanLive(door: OrchDoor, enabled: boolean, runId?: string): PlanLive {
  const [live, setLive] = useState<PlanLive>(() => ({ sessions: {}, activity: [], questions: [], nowMs: Date.now() }))
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let cursor: string | undefined
    let running = false
    const scope = runId === undefined ? {} : { run: runId }
    setLive((p) => (p.activity.length === 0 ? p : { ...p, activity: [] })) // read again from the start: another plan's lines go
    const tick = async (): Promise<void> => {
      if (running) return
      running = true
      let rows: SessionRow[] | undefined
      let asked: OpenQuestion[] | undefined
      const pages: ActivityEvent[][] = []
      try {
        const r = await door.command('sessions-list', scope)
        if (r.status === 200) rows = r.body as SessionRow[]
        // W7-C (#72): the asks and escalations waiting on the owner (Gates have no `source`)
        const q = await door.command('questions-list', { status: 'open', ...scope })
        if (q.status === 200) asked = (q.body as OpenQuestion[]).filter((x) => x.source !== undefined)
        for (;;) {
          const a = await window.api.orch.activity(cursor)
          if (!alive || a.status !== 200) break
          const page = a.body as { events: ActivityEvent[]; cursor: string }
          cursor = page.cursor
          if (page.events.length > 0) pages.push(page.events)
          if (page.events.length < PAGE) break
        }
      } catch {
        /* no Host yet: the next tick tries again */
      } finally {
        running = false
      }
      if (!alive) return
      setLive((p) => {
        let activity = p.activity
        for (const page of pages) activity = runId === undefined ? mergePage(activity, page) : planActivityOf(activity, page, runId)
        const questions = asked === undefined || JSON.stringify(p.questions) === JSON.stringify(asked) ? p.questions : asked
        return { sessions: rows === undefined ? p.sessions : liveSessionsOf(rows, p.sessions), activity, questions, nowMs: Date.now() }
      })
    }
    const stop = pollWhileVisible(() => void tick(), POLL_MS)
    return () => {
      alive = false
      stop()
    }
  }, [door, enabled, runId])
  return live
}
