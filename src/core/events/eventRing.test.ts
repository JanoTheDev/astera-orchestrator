// SDK 1d: the ring the Host's public event log reads from. Ids carry the Host's boot, so a cursor names an event even
// after a Host restart; a cursor the ring cannot place exactly says whether events were lost (`gap`).
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createEventRing, type EventRing } from './eventRing'
import type { EventDraft } from '../orchestration/publicEvents'

const A = '0123456789ab'
const B = 'ba9876543210'
const draft = (type: EventDraft['type'], runId = 'run_1'): EventDraft => ({ type, runId, payload: { id: runId } })
const ring = (boot = A, over: { retainEvents?: number; retainChars?: number } = {}): EventRing =>
  createEventRing({ boot, retainEvents: over.retainEvents ?? 100, retainChars: over.retainChars ?? 1_000_000 })
const ids = (r: { events: Array<{ id: string }> }): string[] => r.events.map((e) => e.id)
const read = (r: EventRing, q: Parameters<EventRing['read']>[0]): { events: Array<{ id: string; type: string; sequence: number }>; cursor: string; gap: boolean } => {
  const out = r.read(q)
  if ('error' in out) throw new Error(out.error)
  return out
}
/** A ring of boot B holding what a ring of boot A wrote: what a Host finds after a restart. */
const restarted = (from: EventRing, over: { retainEvents?: number } = {}): EventRing => {
  const next = ring(B, over)
  next.restore(read(from, { limit: 1000 }).events.map((event) => ({ event: event as never, line: JSON.stringify(event) })))
  return next
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the event ring', () => {
  it('numbers events from 1 and puts its boot in each id', () => {
    const r = ring()
    const written = r.append([draft('run.started'), draft('task.started')], 'T')
    expect(written.map((w) => w.event.id)).toEqual([`ev_${A}_1`, `ev_${A}_2`])
    expect(written[0].event).toEqual({ id: `ev_${A}_1`, type: 'run.started', sequence: 1, occurredAt: 'T', runId: 'run_1', payload: { id: 'run_1' } })
    expect(JSON.parse(written[1].line)).toEqual(written[1].event)
    expect(r.lastSequence()).toBe(2)
  })

  it('reads from the oldest without a cursor, and after a cursor', () => {
    const r = ring()
    r.append([draft('run.started'), draft('task.started'), draft('task.completed')], 'T')
    expect(read(r, { limit: 10 })).toEqual({ events: expect.any(Array), cursor: `ev_${A}_3`, gap: false })
    expect(ids(read(r, { limit: 10 }))).toEqual([`ev_${A}_1`, `ev_${A}_2`, `ev_${A}_3`])
    expect(ids(read(r, { after: `ev_${A}_1`, limit: 10 }))).toEqual([`ev_${A}_2`, `ev_${A}_3`])
    expect(read(r, { after: `ev_${A}_3`, limit: 10 })).toEqual({ events: [], cursor: `ev_${A}_3`, gap: false })
  })

  it('stops at the limit, the cursor on the last event given', () => {
    const r = ring()
    r.append([draft('run.started'), draft('task.started'), draft('task.completed')], 'T')
    const page = read(r, { limit: 2 })
    expect(ids(page)).toEqual([`ev_${A}_1`, `ev_${A}_2`])
    expect(page.cursor).toBe(`ev_${A}_2`)
  })

  it('moves the cursor past the events a types filter skips', () => {
    const r = ring()
    r.append([draft('task.started'), draft('run.completed'), draft('task.started')], 'T')
    const page = read(r, { types: new Set(['run.completed']), limit: 10 })
    expect(ids(page)).toEqual([`ev_${A}_2`])
    expect(page.cursor).toBe(`ev_${A}_3`)
    expect(read(r, { types: new Set(['question.created']), limit: 10 })).toEqual({ events: [], cursor: `ev_${A}_3`, gap: false })
  })

  it('a tail cursor waits for what comes next', () => {
    const r = ring()
    expect(r.tail()).toBe(`ev_${A}_0`)
    const tail = r.tail()
    expect(read(r, { after: tail, limit: 10 })).toEqual({ events: [], cursor: `ev_${A}_0`, gap: false })
    r.append([draft('run.started')], 'T')
    expect(ids(read(r, { after: tail, limit: 10 }))).toEqual([`ev_${A}_1`])
    expect(r.tail()).toBe(`ev_${A}_1`)
  })

  it('says gap for a cursor whose events fell off, and starts at the oldest held', () => {
    const r = ring(A, { retainEvents: 3 })
    r.append([1, 2, 3, 4, 5].map(() => draft('task.started')), 'T')
    const page = read(r, { after: `ev_${A}_1`, limit: 10 })
    expect(page.gap).toBe(true)
    expect(ids(page)).toEqual([`ev_${A}_3`, `ev_${A}_4`, `ev_${A}_5`])
    // The event right before the oldest held is not a gap: nothing between them was lost
    expect(read(r, { after: `ev_${A}_2`, limit: 10 }).gap).toBe(false)
  })

  it('says gap for a cursor of a boot it does not hold, unless that cursor had seen nothing', () => {
    const r = ring()
    r.append([draft('run.started')], 'T')
    expect(read(r, { after: `ev_${B}_7`, limit: 10 })).toEqual({ events: expect.any(Array), cursor: `ev_${A}_1`, gap: true })
    expect(ids(read(r, { after: `ev_${B}_7`, limit: 10 }))).toEqual([`ev_${A}_1`])
    expect(read(r, { after: `ev_${B}_0`, limit: 10 }).gap).toBe(false)
  })

  it('reads on across a restart from a cursor the old Host gave', () => {
    const a = ring()
    a.append([draft('run.started'), draft('task.started')], 'T')
    const b = restarted(a)
    expect(b.lastSequence()).toBe(2)
    b.append([draft('task.completed')], 'U')
    expect(ids(read(b, { after: `ev_${A}_1`, limit: 10 }))).toEqual([`ev_${A}_2`, `ev_${B}_3`])
    expect(read(b, { after: `ev_${A}_2`, limit: 10 })).toEqual({ events: [expect.objectContaining({ id: `ev_${B}_3`, sequence: 3 })], cursor: `ev_${B}_3`, gap: false })
  })

  it('a cursor past what the old Host wrote reads on from the new boot, with no gap', () => {
    // The old Host delivered event 3 and died before writing it: the new Host never held it, the client had it
    const a = ring()
    a.append([draft('run.started'), draft('task.started')], 'T')
    const b = restarted(a)
    b.append([draft('task.completed')], 'U')
    expect(read(b, { after: `ev_${A}_3`, limit: 10 })).toEqual({ events: [expect.objectContaining({ id: `ev_${B}_3` })], cursor: `ev_${B}_3`, gap: false })
  })

  // Final review Important 3: lines a shut disk dropped, or a torn last line, leave a hole in one boot's numbers after
  // a restart. A cursor before the hole reads on with a gap mark; one right before what is held does not.
  it('says gap for a hole inside one boot', () => {
    const r = ring(B)
    r.restore([1, 2, 5, 6].map((n) => {
      const event = { id: `ev_${A}_${n}`, type: 'task.started', sequence: n, occurredAt: 'T', payload: {} } as never
      return { event, line: JSON.stringify(event) }
    }))
    const page = read(r, { after: `ev_${A}_2`, limit: 10 })
    expect(ids(page)).toEqual([`ev_${A}_5`, `ev_${A}_6`])
    expect(page.gap).toBe(true)
    expect(read(r, { after: `ev_${A}_1`, limit: 10 }).gap).toBe(false)
    expect(read(r, { after: `ev_${A}_4`, limit: 10 }).gap).toBe(false)
  })

  // A write retried after a partial one can leave a line twice
  it('holds an event once when the files have it twice', () => {
    const event = { id: `ev_${A}_1`, type: 'task.started', sequence: 1, occurredAt: 'T', payload: {} } as never
    const r = ring(B)
    r.restore([{ event, line: JSON.stringify(event) }, { event, line: JSON.stringify(event) }])
    expect(ids(read(r, { limit: 10 }))).toEqual([`ev_${A}_1`])
  })

  it('refuses a cursor that is not an event id', () => {
    const r = ring()
    for (const bad of ['x', 'ev_zz_1', `ev_${A}_-1`, `ev_${A}_01`, `ev_${A}_1.5`, `ev_${A.toUpperCase()}_1`])
      expect(r.read({ after: bad, limit: 10 }), bad).toEqual({ error: expect.stringContaining(bad) })
  })

  it('keeps no more characters than it may, but always the newest event', () => {
    const r = ring(A, { retainChars: 300 })
    r.append([1, 2, 3, 4, 5].map(() => draft('task.started')), 'T')
    const held = ids(read(r, { limit: 10 }))
    expect(held.length).toBeLessThan(5)
    expect(held.at(-1)).toBe(`ev_${A}_5`)
    const tiny = ring(A, { retainChars: 1 })
    tiny.append([draft('task.started'), draft('task.started')], 'T')
    expect(ids(read(tiny, { limit: 10 }))).toEqual([`ev_${A}_2`])
  })

  it('next() settles at the next append, or when its time is up', async () => {
    vi.useFakeTimers()
    const r = ring()
    let woke = false
    const waiting = r.next(10_000).then(() => {
      woke = true
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(woke).toBe(false)
    r.append([draft('run.started')], 'T')
    await waiting
    expect(woke).toBe(true)
    let timedOut = false
    const idle = r.next(1_000).then(() => {
      timedOut = true
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await idle
    expect(timedOut).toBe(true)
  })
})
