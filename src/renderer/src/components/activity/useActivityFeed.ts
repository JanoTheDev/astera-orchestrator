// W9-D: the activity feed as a hook, read the way ActivityPanel and usePlanLive read it (mergePage, from the oldest
// line the Host holds), for the Inbox's "Handled for you".
import { useEffect, useState } from 'react'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import { mergePage } from './activityView'

const POLL_MS = 5000
/** A full page of the feed: a shorter one is its end. */
const PAGE = 500

export function useActivityFeed(enabled: boolean): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let cursor: string | undefined
    let running = false
    const tick = async (): Promise<void> => {
      if (running) return
      running = true
      try {
        for (;;) {
          const a = await window.api.orch.activity(cursor)
          if (!alive || a.status !== 200) break
          const page = a.body as { events: ActivityEvent[]; cursor: string }
          cursor = page.cursor
          if (page.events.length > 0) setEvents((held) => mergePage(held, page.events))
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
  }, [enabled])
  return events
}
