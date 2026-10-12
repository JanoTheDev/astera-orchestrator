// astera.events (SDK spec §6): the Host's public event log, read a page at a time (`list`) or followed (`subscribe`),
// both over the Host command `events-poll`.
//
// **At least once, never twice in a row.** The Host gives each event an id that never repeats; a subscription drops
// an id it already yielded (the last 1000), and a consumer that keeps a cursor across runs drops one it has seen.
// Events are notifications, not the state: after a `{ type: 'gap' }` (events were lost: older than the Host keeps,
// or a cursor from a log this Host does not hold), read the objects again.
//
// **A subscription outlives a Host restart.** A call that fails because the Host went away or did not answer in time
// is sent again from the same cursor after 250 ms, 1 s, then every 5 s, and the new Host reads on from it. Anything
// else (a Host too old for events, a refused argument) ends the subscription with its error.
import type { CallOptions, CallResult } from './client.js'
import { FOLLOW_WINDOW_MS, TIMEOUT_HEADROOM_MS } from './deadlines.js'
import { AsteraError, isAsteraError } from './errors.js'
import { EVENT_TYPES } from './fields.js'
import type { ReadOptions } from './namespaces.js'
import { HOST_FEATURE_EVENTS } from './protocol.js'
import type { AsteraEvent, EventGap, EventList, EventType } from './types.js'

export interface ListEventsFilter {
  /** Read on after this event id (or a cursor an earlier page gave). Default: the oldest event the Host holds. */
  readonly after?: string
  /** Only these types. Default: all. */
  readonly types?: readonly EventType[]
  /** At most this many events, 1 to 500. Default 100. */
  readonly limit?: number
}

export interface SubscribeOptions<K extends EventType = EventType> {
  /** Read on after this event id or cursor. Default: only what happens after the subscription starts. */
  readonly after?: string
  /** Only these types. Default: all. A gap is yielded whatever the filter. */
  readonly types?: readonly K[]
  /** Ends the subscription with its reason. */
  readonly signal?: AbortSignal
}

export interface EventsApi {
  /** One page of events, with the cursor to read on from. Does not wait. */
  list(filter?: ListEventsFilter, options?: ReadOptions): Promise<EventList>
  /** The events as they happen, and a `{ type: 'gap' }` where some were lost. Ends only on `return()`, `break`, the
   *  signal, or an error waiting cannot mend. */
  subscribe<K extends EventType = EventType>(options?: SubscribeOptions<K>): AsyncIterableIterator<AsteraEvent<K> | EventGap>
}

type Call = (cmd: string, args?: Record<string, unknown>, options?: CallOptions) => Promise<CallResult>

/** How long to wait before sending a failed call again: the first, the second, and every later time. */
export const EVENTS_RETRY_MS = Object.freeze([250, 1000, 5000] as const)
/** The ids a subscription remembers, to drop a repeat. */
const REMEMBERED = 1000
const PAGE_MAX = 500

const invalid = (message: string): AsteraError => new AsteraError('INVALID_ARGUMENTS', message)

/** A wait that the signal ends with its reason. */
const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * An async iterator over `loop` that `return()` ends at once. An async generator holds a return() until its pending
 * next() settles, so a return() while a call waits would let the loop run on; the loop gets a signal of its own that
 * return() aborts, joined with the caller's.
 */
export function stoppable<T>(loop: (signal: AbortSignal) => AsyncGenerator<T>, caller?: AbortSignal): AsyncIterableIterator<T> {
  const stop = new AbortController()
  const signal = caller !== undefined ? AbortSignal.any([caller, stop.signal]) : stop.signal
  const gen = loop(signal)
  return {
    next: () => gen.next(),
    return: async () => {
      stop.abort(new DOMException('the iteration was ended', 'AbortError'))
      await gen.return(undefined).catch(() => undefined)
      return { done: true, value: undefined }
    },
    throw: (e?: unknown) => gen.throw(e),
    [Symbol.asyncIterator]() {
      return this
    }
  }
}

export function createEventsApi(
  call: Call,
  features: () => readonly string[],
  o: {
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
    /** The client's close(): a subscription waiting to try again ends at once with FAILED. */
    closed?: AbortSignal
  } = {}
): EventsApi {
  const sleep = o.sleep ?? abortableSleep
  /** Waits before a try again, ended by the subscription's signal or the client's close(). */
  const waitToRetry = async (ms: number, signal: AbortSignal): Promise<void> => {
    if (o.closed === undefined) return sleep(ms, signal)
    try {
      await sleep(ms, AbortSignal.any([signal, o.closed]))
    } catch (e) {
      if (o.closed.aborted && !signal.aborted) throw new AsteraError('FAILED', 'the client is closed')
      throw e
    }
  }
  const needEvents = (): void => {
    if (!features().includes(HOST_FEATURE_EVENTS))
      throw new AsteraError('VERSION_MISMATCH', `this Host keeps no public event log (no '${HOST_FEATURE_EVENTS}' feature); update the Astera app`)
  }
  const cursorArg = (after: unknown): Record<string, unknown> => {
    if (after === undefined) return {}
    if (typeof after !== 'string' || after === '') throw invalid('after is an event id or a cursor (a non-empty string)')
    return { after }
  }
  const typesArg = (types: readonly unknown[] | undefined): Record<string, unknown> => {
    if (types === undefined) return {}
    if (!Array.isArray(types) || types.length === 0 || types.some((t) => !(EVENT_TYPES as readonly unknown[]).includes(t)))
      throw invalid(`types is a non-empty list of: ${EVENT_TYPES.join(', ')}`)
    return { types: types.join(',') }
  }
  /** One `events-poll` answer, checked: a page is events, a cursor and a gap mark. */
  const pageOf = (body: unknown): { events: AsteraEvent[]; cursor: string; gap: boolean } => {
    const p = body as { events?: unknown; cursor?: unknown; gap?: unknown } | null
    if (p === null || typeof p !== 'object' || !Array.isArray(p.events) || typeof p.cursor !== 'string' || typeof p.gap !== 'boolean')
      throw new AsteraError('FAILED', 'the Host answered events-poll with something that is not a page of events')
    return p as { events: AsteraEvent[]; cursor: string; gap: boolean }
  }

  async function* follow<K extends EventType>(opts: SubscribeOptions<K>, signal: AbortSignal): AsyncGenerator<AsteraEvent<K> | EventGap> {
    const filter = { ...typesArg(opts.types) }
    let cursor = opts.after === undefined ? undefined : (cursorArg(opts.after).after as string)
    needEvents()
    const seen = new Set<string>()
    const order: string[] = []
    let failures = 0
    for (;;) {
      let page: { events: AsteraEvent[]; cursor: string; gap: boolean }
      try {
        needEvents()
        page =
          cursor === undefined
            ? pageOf((await call('events-poll', { tail: true }, { signal })).body)
            : pageOf(
                (await call('events-poll', { after: cursor, ...filter, waitMs: FOLLOW_WINDOW_MS }, { signal, timeoutMs: FOLLOW_WINDOW_MS + TIMEOUT_HEADROOM_MS })).body
              )
        failures = 0
      } catch (e) {
        if (!isAsteraError(e) || (e.code !== 'HOST_NOT_RUNNING' && e.code !== 'TIMEOUT')) throw e
        await waitToRetry(EVENTS_RETRY_MS[Math.min(failures, EVENTS_RETRY_MS.length - 1)], signal)
        failures += 1
        continue
      }
      if (page.gap) yield { type: 'gap' }
      for (const e of page.events) {
        if (seen.has(e.id)) continue
        seen.add(e.id)
        order.push(e.id)
        if (order.length > REMEMBERED) seen.delete(order.shift()!)
        yield e as AsteraEvent<K>
      }
      cursor = page.cursor
    }
  }

  return {
    list: async (filter = {}, options) => {
      const args: Record<string, unknown> = { ...cursorArg(filter.after), ...typesArg(filter.types) }
      if (filter.limit !== undefined) {
        if (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > PAGE_MAX) throw invalid(`limit must be an integer from 1 to ${PAGE_MAX}`)
        args.limit = filter.limit
      }
      needEvents()
      const callOptions: CallOptions = {
        ...(options?.signal !== undefined ? { signal: options.signal } : {}),
        ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {})
      }
      const page = pageOf((await call('events-poll', { ...args, waitMs: 0 }, callOptions)).body)
      return { items: page.events, nextCursor: page.cursor, gap: page.gap }
    },
    subscribe: <K extends EventType = EventType>(opts: SubscribeOptions<K> = {}) => stoppable((signal) => follow<K>(opts, signal), opts.signal)
  }
}
