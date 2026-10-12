// astera.events (SDK spec §6, SDK 1d) against a scripted `call`: what each method sends, how a subscription moves its
// cursor, marks a gap, drops a repeat, and rides out a Host restart.
import { describe, it, expect, vi } from 'vitest'
import { createEventsApi } from './events.js'
import type { CallOptions, CallResult } from './client.js'
import { AsteraError } from './errors.js'
import { FOLLOW_WINDOW_MS, TIMEOUT_HEADROOM_MS } from './deadlines.js'
import type { AsteraEvent, EventGap } from './types.js'

const A = '0123456789ab'
const event = (n: number, type: AsteraEvent['type'] = 'task.started'): AsteraEvent =>
  ({ id: `ev_${A}_${n}`, type, sequence: n, occurredAt: 'T', runId: 'run_1', payload: {} }) as AsteraEvent
const page = (events: AsteraEvent[], cursor: string, gap = false): { events: AsteraEvent[]; cursor: string; gap: boolean } => ({ events, cursor, gap })

type Step = unknown | Error | 'hang'
/** A `call` that answers each events-poll with the next step: a body, an error to throw, or a wait that only the
 *  call's signal ends. Records what it was sent. */
const scripted = (steps: Step[]): { call: (cmd: string, args?: Record<string, unknown>, o?: CallOptions) => Promise<CallResult>; sent: Array<{ cmd: string; args: Record<string, unknown>; o: CallOptions }> } => {
  const sent: Array<{ cmd: string; args: Record<string, unknown>; o: CallOptions }> = []
  return {
    sent,
    call: (cmd, args = {}, o = {}) => {
      sent.push({ cmd, args, o })
      const step = steps.shift()
      if (step === undefined || step === 'hang')
        return new Promise((_, reject) => o.signal?.addEventListener('abort', () => reject(o.signal?.reason), { once: true }))
      if (step instanceof Error) return Promise.reject(step)
      return Promise.resolve({ body: step, replayed: false, observed: false })
    }
  }
}
const withEvents = (): readonly string[] => ['orch', 'requests', 'events']
const take = async <T>(it: AsyncIterator<T>, n: number): Promise<T[]> => {
  const out: T[] = []
  for (let i = 0; i < n; i++) {
    const r = await it.next()
    if (r.done) break
    out.push(r.value)
  }
  return out
}
const rejection = async (p: Promise<unknown>): Promise<AsteraError> => {
  try {
    await p
  } catch (e) {
    if (e instanceof AsteraError) return e
    throw e
  }
  throw new Error('expected a rejection')
}

describe('astera.events.list', () => {
  it('sends events-poll with no wait and answers a page', async () => {
    const s = scripted([page([event(2), event(3)], `ev_${A}_3`)])
    const events = createEventsApi(s.call, withEvents)
    expect(await events.list({ after: `ev_${A}_1`, types: ['task.started', 'run.completed'], limit: 2 })).toEqual({
      items: [event(2), event(3)],
      nextCursor: `ev_${A}_3`,
      gap: false
    })
    expect(s.sent).toEqual([{ cmd: 'events-poll', args: { after: `ev_${A}_1`, types: 'task.started,run.completed', limit: 2, waitMs: 0 }, o: {} }])
  })

  it('reads from the oldest held without a cursor', async () => {
    const s = scripted([page([], `ev_${A}_0`)])
    await createEventsApi(s.call, withEvents).list()
    expect(s.sent[0].args).toEqual({ waitMs: 0 })
  })

  it('refuses what it cannot send, before any call', async () => {
    const s = scripted([])
    const events = createEventsApi(s.call, withEvents)
    for (const filter of [{ after: '' }, { types: [] }, { types: ['run.cancelled'] }, { limit: 0 }, { limit: 501 }, { limit: 1.5 }])
      expect((await rejection(events.list(filter as never))).code, JSON.stringify(filter)).toBe('INVALID_ARGUMENTS')
    expect(s.sent).toEqual([])
  })

  it('says to update a Host that keeps no event log, before any call', async () => {
    const s = scripted([])
    const e = await rejection(createEventsApi(s.call, () => ['orch']).list())
    expect(e.code).toBe('VERSION_MISMATCH')
    expect(s.sent).toEqual([])
  })

  it('refuses an answer that is not a page', async () => {
    const s = scripted([{ events: 'x' }])
    expect((await rejection(createEventsApi(s.call, withEvents).list())).code).toBe('FAILED')
  })
})

// SDK 1e: the cursor a reader takes before reading the state, so a subscription from it misses nothing
describe('astera.events.cursor', () => {
  it('asks the Host where the next event will be, reading none', async () => {
    const s = scripted([page([], `ev_${A}_7`)])
    expect(await createEventsApi(s.call, withEvents).cursor()).toBe(`ev_${A}_7`)
    expect(s.sent).toEqual([{ cmd: 'events-poll', args: { tail: true }, o: {} }])
  })

  it('passes its signal and deadline, and no request id', async () => {
    const s = scripted([page([], `ev_${A}_7`)])
    const signal = new AbortController().signal
    await createEventsApi(s.call, withEvents).cursor({ signal, timeoutMs: 900 })
    expect(s.sent[0].o).toEqual({ signal, timeoutMs: 900 })
  })

  it('says to update a Host that keeps no event log, before any call', async () => {
    const s = scripted([])
    expect((await rejection(createEventsApi(s.call, () => ['orch']).cursor())).code).toBe('VERSION_MISMATCH')
    expect(s.sent).toEqual([])
  })

  it('refuses an answer that is not a page', async () => {
    const s = scripted([{ cursor: 7 }])
    expect((await rejection(createEventsApi(s.call, withEvents).cursor())).code).toBe('FAILED')
  })
})

describe('astera.events.subscribe', () => {
  it('starts at the tail, then waits a window at a time from its cursor', async () => {
    const s = scripted([page([], `ev_${A}_4`), page([event(5)], `ev_${A}_5`), page([event(6), event(7)], `ev_${A}_7`)])
    const it = createEventsApi(s.call, withEvents).subscribe({ types: ['task.started'] })
    expect(await take(it, 3)).toEqual([event(5), event(6), event(7)])
    await it.return?.()
    expect(s.sent[0].args).toEqual({ tail: true })
    expect(s.sent[1].args).toEqual({ after: `ev_${A}_4`, types: 'task.started', waitMs: FOLLOW_WINDOW_MS })
    expect(s.sent[1].o.timeoutMs).toBe(FOLLOW_WINDOW_MS + TIMEOUT_HEADROOM_MS)
    expect(s.sent[2].args.after).toBe(`ev_${A}_5`)
  })

  it('reads on from a cursor it is given', async () => {
    const s = scripted([page([event(3)], `ev_${A}_3`)])
    const it = createEventsApi(s.call, withEvents).subscribe({ after: `ev_${A}_2` })
    expect(await take(it, 1)).toEqual([event(3)])
    await it.return?.()
    expect(s.sent[0].args).toEqual({ after: `ev_${A}_2`, waitMs: FOLLOW_WINDOW_MS })
  })

  // SDK 1e smoke finding: a consumer that saves only the ids it handled keeps a cursor the Host may no longer hold
  it('shows its cursor: the page a handed-over event came from until the next call, then past what it skipped', async () => {
    const s = scripted([page([], `ev_${A}_5`), page([event(6), event(7)], `ev_${A}_9`), page([], `ev_${A}_12`), 'hang'])
    const sub = createEventsApi(s.call, withEvents).subscribe({ types: ['task.started'] })
    expect(sub.cursor).toBeUndefined()
    expect((await sub.next()).value).toEqual(event(6))
    expect(sub.cursor).toBe(`ev_${A}_5`)
    expect((await sub.next()).value).toEqual(event(7))
    expect(sub.cursor).toBe(`ev_${A}_5`)
    const waiting = sub.next()
    await vi.waitFor(() => expect(s.sent).toHaveLength(4))
    expect(sub.cursor).toBe(`ev_${A}_12`)
    await sub.return?.()
    await waiting.catch(() => undefined)
  })

  it('shows the cursor it was given before its first call', () => {
    const sub = createEventsApi(scripted([]).call, withEvents).subscribe({ after: `ev_${A}_2` })
    expect(sub.cursor).toBe(`ev_${A}_2`)
  })

  it('marks a gap before the page that follows it', async () => {
    const s = scripted([page([event(9)], `ev_${A}_9`, true)])
    const it = createEventsApi(s.call, withEvents).subscribe({ after: `ev_${A}_1` })
    expect(await take(it, 2)).toEqual([{ type: 'gap' } satisfies EventGap, event(9)])
    await it.return?.()
  })

  it('never yields an id twice', async () => {
    const s = scripted([page([event(1), event(2)], `ev_${A}_2`), page([event(2), event(3)], `ev_${A}_3`)])
    const it = createEventsApi(s.call, withEvents).subscribe({ after: `ev_${A}_0` })
    expect((await take(it, 3)).map((e) => (e as AsteraEvent).id)).toEqual([`ev_${A}_1`, `ev_${A}_2`, `ev_${A}_3`])
    await it.return?.()
  })

  it('rides out a Host that went away: waits 250 ms, then 1 s, then reads on from the same cursor', async () => {
    const gone = (): AsteraError => new AsteraError('HOST_NOT_RUNNING', 'gone')
    const s = scripted([gone(), new AsteraError('TIMEOUT', 'slow'), gone(), page([event(5)], `ev_${A}_5`), gone(), page([event(6)], `ev_${A}_6`)])
    const slept: number[] = []
    const it = createEventsApi(s.call, withEvents, { sleep: async (ms) => void slept.push(ms) }).subscribe({ after: `ev_${A}_4` })
    expect(await take(it, 2)).toEqual([event(5), event(6)])
    await it.return?.()
    // A success resets the wait
    expect(slept).toEqual([250, 1000, 5000, 250])
    expect(s.sent.map((c) => c.args.after)).toEqual([`ev_${A}_4`, `ev_${A}_4`, `ev_${A}_4`, `ev_${A}_4`, `ev_${A}_5`, `ev_${A}_5`])
  })

  it('throws what waiting cannot mend', async () => {
    for (const code of ['NOT_FOUND', 'VERSION_MISMATCH', 'PERMISSION_DENIED', 'INVALID_ARGUMENTS'] as const) {
      const s = scripted([new AsteraError(code, 'no')])
      const it = createEventsApi(s.call, withEvents).subscribe({ after: `ev_${A}_1` })
      expect((await rejection(it.next())).code).toBe(code)
    }
  })

  it('return() while a window waits ends the wait and sends nothing more', async () => {
    const s = scripted(['hang'])
    const it = createEventsApi(s.call, withEvents).subscribe({ after: `ev_${A}_1` })
    const pending = it.next().catch((e: unknown) => e)
    await new Promise((r) => setTimeout(r, 20))
    expect(await it.return?.()).toEqual({ done: true, value: undefined })
    expect(await pending).toMatchObject({ name: 'AbortError' })
    expect(s.sent).toHaveLength(1)
  })

  it('a caller’s abort ends it with the caller’s reason, a retry wait included', async () => {
    const ac = new AbortController()
    const s = scripted([new AsteraError('HOST_NOT_RUNNING', 'gone')])
    const it = createEventsApi(s.call, withEvents).subscribe({ after: `ev_${A}_1`, signal: ac.signal })
    const pending = it.next().catch((e: unknown) => e)
    await new Promise((r) => setTimeout(r, 20))
    ac.abort(new Error('enough'))
    expect(await pending).toMatchObject({ message: 'enough' })
    expect(s.sent).toHaveLength(1)
  })

  it('checks its arguments and the Host before the first call', async () => {
    const s = scripted([])
    const events = createEventsApi(s.call, withEvents)
    expect((await rejection(events.subscribe({ after: '' }).next())).code).toBe('INVALID_ARGUMENTS')
    expect((await rejection(events.subscribe({ types: ['run.cancelled' as never] }).next())).code).toBe('INVALID_ARGUMENTS')
    expect((await rejection(createEventsApi(s.call, () => ['orch']).subscribe().next())).code).toBe('VERSION_MISMATCH')
    expect(s.sent).toEqual([])
  })

  // Final review Minor 9: close() left a subscription asleep before its next try, holding Node for up to 5 s
  it('ends at once with FAILED when the client closes while it waits to try again', async () => {
    const closing = new AbortController()
    const s = scripted([new AsteraError('HOST_NOT_RUNNING', 'gone')])
    const hang = (_ms: number, signal: AbortSignal): Promise<void> =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    const it = createEventsApi(s.call, withEvents, { sleep: hang, closed: closing.signal }).subscribe({ after: `ev_${A}_1` })
    const pending = it.next().catch((e: unknown) => e)
    await new Promise((r) => setTimeout(r, 20))
    closing.abort()
    expect(await pending).toMatchObject({ code: 'FAILED', message: 'the client is closed' })
    expect(s.sent).toHaveLength(1)
  })

  // Final review Minor 8: the spec's own example (§6) reads `event.runId` with no narrowing
  it('takes the spec’s example as written', () => {
    const it = createEventsApi(scripted([]).call, withEvents).subscribe({ types: ['completion.converged'] })
    const example = async (): Promise<void> => {
      for await (const event of it) console.log(event.runId)
    }
    expect(typeof example).toBe('function')
  })

  it('types its events by the types it asked for (the README example compiles)', () => {
    const it = createEventsApi(scripted([]).call, withEvents).subscribe({ types: ['run.completed', 'run.failed', 'completion.exhausted'] })
    const check = async (): Promise<void> => {
      for await (const e of it) {
        if (e.type === 'gap') continue
        if (e.type === 'completion.exhausted') void e.payload.title
        else void e.payload.outcome
        // @ts-expect-error a type it did not ask for cannot come
        if (e.type === 'job.created') void e
      }
    }
    expect(typeof check).toBe('function')
  })
})
