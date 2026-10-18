// W6-E: what the plan view reads beside the snapshot, polled while it is open: the Host's word on each session
// (`sessions-list`: a prompt it waits on, its last tool call) and the activity feed's lines (auto-answered questions,
// replans). The feed is read as ActivityPanel reads it (mergePage), from the oldest line the Host holds.
import { useEffect, useState } from 'react'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { OrchDoor } from '../../lib/orchDoor'
import { mergePage } from '../activity/activityView'
import type { LiveSession, OpenQuestion } from './planBoard'

/** As often as the activity feed and the workspace tree are read. */
const POLL_MS = 5000
/** A full page of the feed: a shorter one is its end. */
const PAGE = 500

export function usePlanLive(door: OrchDoor, enabled: boolean): { sessions: Record<string, LiveSession>; activity: ActivityEvent[]; questions: OpenQuestion[] } {
  const [sessions, setSessions] = useState<Record<string, LiveSession>>({})
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [questions, setQuestions] = useState<OpenQuestion[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let cursor: string | undefined
    let running = false
    const tick = async (): Promise<void> => {
      if (running) return
      running = true
      try {
        const r = await door.command('sessions-list', {})
        if (alive && r.status === 200) {
          const next: Record<string, LiveSession> = {}
          // A `sessions-list` row (command.ts HostSession); the renderer does not import command.ts
          for (const s of r.body as Array<{ id: string } & LiveSession>)
            next[s.id] = { ...(s.prompt ? { prompt: s.prompt } : {}), ...(s.lastAction ? { lastAction: s.lastAction } : {}), ...(s.heavyWait ? { heavyWait: s.heavyWait } : {}) }
          setSessions((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next))
        }
        // W7-C (#72): the asks and escalations waiting on the owner (Gates have no `source`)
        const q = await door.command('questions-list', { status: 'open' })
        if (alive && q.status === 200) {
          const next = (q.body as OpenQuestion[]).filter((x) => x.source !== undefined)
          setQuestions((p) => (JSON.stringify(p) === JSON.stringify(next) ? p : next))
        }
        for (;;) {
          const a = await window.api.orch.activity(cursor)
          if (!alive || a.status !== 200) break
          const page = a.body as { events: ActivityEvent[]; cursor: string }
          cursor = page.cursor
          if (page.events.length > 0) setActivity((held) => mergePage(held, page.events))
          if (page.events.length < PAGE) break
        }
      } catch {
        /* no Host yet: the next tick tries again */
      } finally {
        running = false
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [door, enabled])
  return { sessions, activity, questions }
}
