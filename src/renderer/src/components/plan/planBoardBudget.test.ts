// T9: the plan Board at the size that froze the owner's laptop (38 Tasks, 100+ sessions, ~2,600 activity lines), a
// little over: 40 Tasks, 150 sessions, 3,000 Run events and 3,000 activity lines. One 5 s tick is the live read's work
// (usePlanLive's pure part) and the board drawn again; it stays under a frame, and what is held does not grow per tick.
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActivityEvent } from '../../../../core/orchestration/activity'
import type { JobEvent, JobTask } from '../../../../core/types'
import { TaskBoard } from './TaskBoard'
import { coordinatorRefreshOf, replanningOf, type LiveSession, type OpenQuestion } from './planBoard'
import { liveSessionsOf, planActivityOf, PLAN_ACTIVITY_MAX } from './usePlanLive'

vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))

const RUN = 'run-1'
const TASKS = 40
const tasks: JobTask[] = Array.from({ length: TASKS }, (_, i) => ({
  id: `t${i}`,
  title: `Task ${i}`,
  status: i < 10 ? 'completed' : i < 30 ? 'dispatched' : 'pending',
  openGates: 0,
  ...(i >= 10 && i < 30 ? { startedAt: '2026-10-20T09:00:00Z', sessionId: `ses-${i}` } : {}),
  affectedPaths: [`src/a${i}.ts`, `src/b${i}.ts`, `src/c${i}.ts`, `src/d${i}.ts`]
}))
const layers = Array.from({ length: 5 }, (_, w) => tasks.slice(w * 8, w * 8 + 8).map((t) => t.id))
const events: JobEvent[] = Array.from({ length: 3000 }, (_, i) => ({
  at: new Date(Date.parse('2026-10-20T08:00:00Z') + i * 1000).toISOString(),
  kind: i % 3 === 0 ? 'message' : 'dispatch-started',
  sourceId: `e${i}`,
  taskId: `t${i % TASKS}`,
  summary: `event ${i}`,
  ...(i % 3 === 0 ? { messageType: 'question' as const, answered: i % 2 === 0 } : {})
}))
// Ten plans write the feed; this one is a tenth of it
const activityOf = (from: number, n: number): ActivityEvent[] =>
  Array.from({ length: n }, (_, k) => {
    const i = from + k
    const run = `run-${(i % 10) + 1}`
    return {
      id: `a${i}`,
      sequence: i,
      occurredAt: '2026-10-20T09:00:00Z',
      type: i % 4 === 0 ? 'question.auto-answered' : 'task.status',
      runId: run,
      jobId: run,
      taskId: `t${i % TASKS}`,
      payload: { title: `Task ${i % TASKS}`, question: `q${i}`, answer: `a${i}` }
    } as unknown as ActivityEvent
  })
const sessionRows = Array.from({ length: 150 }, (_, i) => ({
  id: `ses-${i}`,
  cwd: `/work/tree-${i}`,
  alive: i % 2 === 0,
  state: 'idle',
  lastAction: { tool: 'Edit', target: `src/file${i}.ts`, at: Date.parse('2026-10-20T09:10:00Z') },
  ...(i % 7 === 0 ? { prompt: 'permission' as const } : {})
}))
const questions: OpenQuestion[] = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, source: 'ask', taskId: `t${10 + i}`, question: `Q${i}?` }))

/** One tick: what usePlanLive does with its three answers, then the board drawn again with them. */
const tick = (held: ActivityEvent[], page: ActivityEvent[], prev: Record<string, LiveSession>, nowMs: number) => {
  const sessions = liveSessionsOf(sessionRows, prev)
  const activity = planActivityOf(held, page, RUN)
  const html = renderToStaticMarkup(
    React.createElement(TaskBoard, {
      tasks,
      accounts: null,
      selected: undefined,
      onSelect: () => {},
      layers,
      events,
      activity,
      sessions,
      questions,
      onAnswer: async () => null,
      replanning: replanningOf(activity, RUN),
      refreshed: coordinatorRefreshOf(activity, RUN),
      nowMs
    })
  )
  return { sessions, activity, html }
}

describe('the plan Board at 40 Tasks, 150 sessions, 3,000 events', () => {
  it('ticks within a frame', () => {
    let held = planActivityOf([], activityOf(0, 3000), RUN)
    let sessions: Record<string, LiveSession> = {}
    for (let i = 0; i < 5; i++) ({ activity: held, sessions } = tick(held, activityOf(3000 + i * 5, 5), sessions, Date.now())) // warm up
    const runs: number[] = []
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now()
      ;({ activity: held, sessions } = tick(held, activityOf(4000 + i * 5, 5), sessions, Date.now()))
      runs.push(performance.now() - t0)
    }
    const median = [...runs].sort((a, b) => a - b)[runs.length >> 1]!
    console.log(`plan board tick: median ${median.toFixed(2)} ms over ${runs.length}`)
    expect(median).toBeLessThan(16)
  })

  it('holds only this plan s lines, bounded, however many ticks pass', () => {
    let held = planActivityOf([], activityOf(0, 3000), RUN)
    expect(held.every((e) => e.runId === RUN)).toBe(true)
    for (let i = 0; i < 500; i++) held = planActivityOf(held, activityOf(3000 + i * 10, 10), RUN)
    expect(held.length).toBeLessThanOrEqual(PLAN_ACTIVITY_MAX)
    const again = planActivityOf(held, [], RUN)
    expect(again).toBe(held) // an empty page keeps the same array: no new render
  })

  it('keeps the session map when nothing changed', () => {
    const first = liveSessionsOf(sessionRows, {})
    expect(liveSessionsOf(sessionRows, first)).toBe(first)
  })
})
