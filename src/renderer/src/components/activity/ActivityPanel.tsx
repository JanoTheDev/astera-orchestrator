// W3-A activity feed: every plan's lines (global), or the open plan's workspace only, with the last 15 minutes'
// summary on top. Drawing and polling only: the lines are the Host's (core/orchestration/activity.ts), the words
// activityView.ts's, a blocked Task's reason planBoard.ts's.
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ActivityEvent, ActivitySummary } from '../../../../core/orchestration/activity'
import type { Account, TaskBlockedReason } from '../../../../core/types'
import { useI18n } from '../../i18n/I18nProvider'
import { reasonText } from '../plan/planBoard'
import { feedOf, lineOf, mergePage, summaryOf, whoOf } from './activityView'
import './activity.css'
import { usePanelOpen } from '../../hooks/usePanelOpen'

/** How often the feed reads what is new, and the summary is read again. */
const POLL_MS = 5000
const SUMMARY_MS = 30_000
const SUMMARY_WINDOW_MS = 15 * 60_000

const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function ActivityPanel({
  planId,
  accounts,
  onOpenSession
}: {
  /** The plan whose workspace is open, or null: the feed then shows every plan. */
  planId: string | null
  accounts: Account[] | null
  onOpenSession?: (sessionId: string, jobId: string) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const [open, setOpen] = usePanelOpen('activity') // W7-F (#83): remembered, like History
  const [all, setAll] = useState(false)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [summary, setSummary] = useState<ActivitySummary | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    let alive = true
    let cursor: string | undefined
    let running = false
    const tick = async (): Promise<void> => {
      if (running) return
      running = true
      try {
        // Read on until a page comes back short: the first read starts at the oldest line the Host holds
        for (;;) {
          const r = await window.api.orch.activity(cursor)
          if (!alive || r.status !== 200) return
          const page = r.body as { events: ActivityEvent[]; cursor: string }
          cursor = page.cursor
          if (page.events.length > 0) setEvents((held) => mergePage(held, page.events))
          if (page.events.length < 500) return
        }
      } catch {
        /* no Host yet: the next tick tries again */
      } finally {
        running = false
      }
    }
    const readSummary = async (): Promise<void> => {
      setNowMs(Date.now())
      try {
        const r = await window.api.orch.activitySummary(new Date(Date.now() - SUMMARY_WINDOW_MS).toISOString())
        if (alive && r.status === 200) setSummary(r.body as ActivitySummary)
      } catch {
        /* as above */
      }
    }
    void tick()
    void readSummary()
    const a = setInterval(() => void tick(), POLL_MS)
    const b = setInterval(() => void readSummary(), SUMMARY_MS)
    return () => {
      alive = false
      clearInterval(a)
      clearInterval(b)
    }
  }, [open])

  const label = (id: string): string => accounts?.find((a) => a.id === id)?.label ?? id
  const reasonLine = (reason: TaskBlockedReason): string => {
    const r = reasonText(reason, nowMs, label)
    return t(r.key, r.params)
  }
  const scope = planId !== null && !all ? planId : null
  const lines = feedOf(events, scope).reverse()
  const buckets = summary ? summaryOf(summary, scope) : []

  return (
    <section className="worktree-panel activity-panel">
      <header className="panel-header">
        <button className="panel-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Activity
        </button>
        {planId !== null && (
          <div className="panel-actions">
            <button className="ws-link" onClick={() => setAll((v) => !v)} title={all ? 'Only the open plan' : 'Every plan'}>
              {all ? 'This plan' : 'All plans'}
            </button>
          </div>
        )}
      </header>
      {open && (
        <>
          <div className="act-summary" aria-label="Last 15 minutes">
            <span className="act-summary-head">Last 15 min</span>
            {buckets.length === 0 && <span className="act-faint">nothing new</span>}
            {buckets.map((b) => (
              <details key={b.label} className={`act-bucket act-${b.tone}`}>
                <summary>
                  {b.items.length} {b.label}
                </summary>
                <ul>
                  {b.items.map((x) => (
                    <li key={`${x.taskId ?? x.jobId}-${x.at}`}>
                      {x.title}
                      {x.reason && <span className="act-faint"> — {reasonLine(x.reason)}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
          <ul className="act-feed">
            {lines.length === 0 && <li className="ws-empty">No activity yet</li>}
            {lines.map((e) => {
              const { text, tone } = lineOf(e, label)
              const who = whoOf(e, label)
              const openable = e.sessionId !== undefined && e.jobId !== undefined && onOpenSession !== undefined
              return (
                <li key={e.id} className={`act-line act-${tone}`}>
                  <button
                    className="act-row"
                    disabled={!openable}
                    title={openable ? 'Open its session' : undefined}
                    onClick={() => openable && onOpenSession!(e.sessionId!, e.jobId!)}
                  >
                    <span className="act-time">{timeOf(e.occurredAt)}</span>
                    <span className="act-text">{text}</span>
                  </button>
                  {who && <div className="act-who">{who}</div>}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
