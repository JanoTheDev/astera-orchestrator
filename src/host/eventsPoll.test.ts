// SDK 1d: `events-poll`, the read the SDK's events.list and events.subscribe make. Answered by the Host beside
// `jobs-view` (not a CLI command); it waits on the ring for at most its window.
import { afterEach, describe, it, expect, vi } from 'vitest'
import { pollEvents } from './eventsPoll'
import { createEventRing, type EventRing } from '../core/events/eventRing'
import type { EventDraft } from '../core/orchestration/publicEvents'

const A = '0123456789ab'
const draft = (type: EventDraft['type']): EventDraft => ({ type, runId: 'run_1', payload: { id: 'run_1' } })
const ring = (): EventRing => createEventRing({ boot: A, retainEvents: 100, retainChars: 1_000_000 })

afterEach(() => {
  vi.useRealTimers()
})

describe('events-poll', () => {
  it('answers 501 without an event log', async () => {
    expect(await pollEvents(null, {})).toEqual({ status: 501, body: { error: expect.stringContaining('event log') } })
  })

  it('tail: a cursor for what comes next, at once', async () => {
    const r = ring()
    r.append([draft('run.started')], 'T')
    expect(await pollEvents(r, { tail: true })).toEqual({ status: 200, body: { events: [], cursor: `ev_${A}_1`, gap: false } })
  })

  it('answers what is there at once', async () => {
    const r = ring()
    r.append([draft('run.started'), draft('task.started')], 'T')
    const out = await pollEvents(r, { after: `ev_${A}_1`, waitMs: 20_000 })
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ events: [{ id: `ev_${A}_2` }], cursor: `ev_${A}_2`, gap: false })
  })

  it('refuses arguments it cannot use', async () => {
    const r = ring()
    for (const args of [
      { after: '' },
      { after: 7 },
      { after: 'nope' },
      { types: 'run.started,run.cancelled' },
      { types: ['run.started'] },
      { types: '' },
      { limit: 0 },
      { limit: 501 },
      { limit: 1.5 },
      { waitMs: -1 },
      { waitMs: 60_001 }
    ])
      expect((await pollEvents(r, args)).status, JSON.stringify(args)).toBe(400)
  })

  it('waits within its window for the next event and answers it', async () => {
    vi.useFakeTimers()
    const r = ring()
    const tail = r.tail()
    const answer = pollEvents(r, { after: tail, waitMs: 20_000 })
    await vi.advanceTimersByTimeAsync(5_000)
    r.append([draft('run.completed')], 'T')
    expect((await answer).body).toMatchObject({ events: [{ id: `ev_${A}_1`, type: 'run.completed' }], gap: false })
  })

  it('keeps waiting past events its types skip, and answers empty at the window with the cursor moved', async () => {
    vi.useFakeTimers()
    const r = ring()
    const answer = pollEvents(r, { after: r.tail(), types: 'run.completed', waitMs: 10_000 })
    await vi.advanceTimersByTimeAsync(2_000)
    r.append([draft('task.started')], 'T')
    await vi.advanceTimersByTimeAsync(8_000)
    expect((await answer).body).toEqual({ events: [], cursor: `ev_${A}_1`, gap: false })
  })

  it('a gap answers at once', async () => {
    const r = createEventRing({ boot: A, retainEvents: 1, retainChars: 1_000_000 })
    r.append([draft('task.started'), draft('task.started'), draft('task.started')], 'T')
    const out = await pollEvents(r, { after: `ev_${A}_1`, waitMs: 20_000 })
    expect(out.body).toMatchObject({ events: [{ id: `ev_${A}_3` }], gap: true })
  })

  it('pages with limit, 100 by default', async () => {
    const r = createEventRing({ boot: A, retainEvents: 1000, retainChars: 1_000_000 })
    r.append(Array.from({ length: 120 }, () => draft('task.started')), 'T')
    expect(((await pollEvents(r, {})).body as { events: unknown[] }).events).toHaveLength(100)
    expect(((await pollEvents(r, { limit: 5 })).body as { events: unknown[]; cursor: string }).cursor).toBe(`ev_${A}_5`)
  })
})
