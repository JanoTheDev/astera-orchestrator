// Hands a plugin the Host's public events (plugin Phase 3 N1, N6-N10): every event of the log, in order, one at a time,
// to the `event` capability's onEvent and the `notification` capability's send, from a cursor kept for that plugin. A
// failed delivery is tried again after DELIVERY_RETRY_MS.first, doubling to its max, and given up after
// DELIVERY_GIVE_UP_MS of failures on one event. The cursor moves when a delivery succeeds or is given up, and is written
// behind it, one write in flight and the latest waiting: a write lost repeats a delivery, never skips one. Nothing is
// delivered while the plugin does not run.
import type { AsteraEvent, EventGap } from '../../core/publicContract'
import type { RingRead } from '../../core/events/eventRing'
import { PluginCursorUnreadable, type CursorStore } from './pluginData'

/** How long onEvent may take; a late settle is ignored. */
export const DELIVERY_TIMEOUT_MS = 30_000
/** The wait after a failed delivery: the first, doubling to the max. */
export const DELIVERY_RETRY_MS = Object.freeze({ first: 1_000, max: 5 * 60_000 })
/** How long one event is tried, counted while the plugin runs, before it is given up and the next one follows. */
export const DELIVERY_GIVE_UP_MS = 60 * 60_000
/** While one event keeps failing, the log gets its first failure and then every this many. */
export const DELIVERY_LOG_EVERY = 10

export interface DeliveryTimings {
  timeoutMs: number
  retryFirstMs: number
  retryMaxMs: number
  giveUpMs: number
  logEvery: number
}

export const DELIVERY_TIMINGS: DeliveryTimings = {
  timeoutMs: DELIVERY_TIMEOUT_MS,
  retryFirstMs: DELIVERY_RETRY_MS.first,
  retryMaxMs: DELIVERY_RETRY_MS.max,
  giveUpMs: DELIVERY_GIVE_UP_MS,
  logEvery: DELIVERY_LOG_EVERY
}

/** How many events one read takes, and how long one wait for more lasts before the loop looks again. */
const READ_LIMIT = 100
const IDLE_WAIT_MS = 30_000

/** The Host's public event log, as the deliverer reads it (src/host/eventLog.ts). */
export interface DeliverySource {
  read(q: { after?: string; limit: number }): RingRead | { error: string }
  tail(): string
  next(ms: number): Promise<void>
}

/** The plugin's process ended while a delivery was in flight: not its handler's failure. The event is handed over
 *  again once the plugin runs again (N8). */
export class DeliveryInterrupted extends Error {}

class TimedOut extends Error {}

export interface Deliverer {
  /** The plugin runs (again): deliver. */
  wake(): void
  /** Ends delivery for good; settles once the cursor is written. No cursor is moved or written after it. */
  stop(): Promise<void>
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const seconds = (ms: number): string => `${ms / 1000} s`

export function createDeliverer(d: {
  source: DeliverySource
  cursor: CursorStore
  /** Whether the plugin runs now: nothing is handed over while it does not. */
  running(): boolean
  /** Hands one event, or a gap, to the plugin: settles when its handler did, rejects with its error, or with
   *  DeliveryInterrupted when its process ended first. */
  /** `signal` aborts when this try runs out of time (5d): the plugin is told, and its late answer is dropped. */
  deliver(item: AsteraEvent | EventGap, signal: AbortSignal): Promise<void>
  /** A line for the plugin's log. */
  log(m: string): void
  /** Called each time it has handed over everything the log holds, before it waits for more (plugin Phase 3c: where
   *  the stale notifications skipped on the way are counted in one line). */
  idle?(): void
  /** A clock that only goes forward (final review M1): the give-up hour must not move with the time of day. */
  now?: () => number
  timings?: Partial<DeliveryTimings>
}): Deliverer {
  const t: DeliveryTimings = { ...DELIVERY_TIMINGS, ...d.timings }
  const now = d.now ?? (() => performance.now())
  let stopped = false
  /** Counts the wakes, so a delivery the plugin's end interrupted waits for the next run, not one already begun. */
  let generation = 0
  let cursor: string | null = null
  let kick: () => void = () => {}

  /** Settles after `ms` (never, without it), or at the next wake, or at the stop. */
  const pause = (ms?: number): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        if (timer !== undefined) clearTimeout(timer)
        if (kick === done) kick = () => {}
        resolve()
      }
      const timer = ms === undefined ? undefined : setTimeout(done, ms)
      kick = done
    })

  // The cursor behind the deliveries: one write in flight, the latest waiting (N6).
  let written: string | null = null
  let writing: Promise<void> | null = null
  let dirty = false
  let writeFailing = false
  const persist = (): Promise<void> => {
    dirty = true
    if (writing) return writing
    writing = (async () => {
      while (dirty) {
        dirty = false
        const c = cursor
        if (c === null || c === written) continue
        try {
          await d.cursor.write(c)
          written = c
          writeFailing = false
        } catch (e) {
          // Said once, not at every event while the disk refuses; the next move or the stop tries again
          if (!writeFailing) d.log(`the event cursor could not be written: ${messageOf(e)}`)
          writeFailing = true
          return
        }
      }
    })().finally(() => {
      writing = null
    })
    return writing
  }
  const move = (to: string): void => {
    if (stopped) return
    cursor = to
    void persist()
  }

  /** One try, cancelled when it runs past the time limit (5d): its signal aborts, which tells the plugin. */
  const withTimeout = (start: (signal: AbortSignal) => Promise<void>): Promise<void> =>
    new Promise((resolve, reject) => {
      const ctl = new AbortController()
      const p = start(ctl.signal)
      const timer = setTimeout(() => {
        reject(new TimedOut())
        ctl.abort()
      }, t.timeoutMs)
      p.then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        (e: unknown) => {
          clearTimeout(timer)
          reject(e)
        }
      )
    })

  /** Hands one item over until it is taken or given up (true: the cursor may move past it), or until delivery stops
   *  (false). */
  async function handOver(item: AsteraEvent | EventGap, label: string): Promise<boolean> {
    let tries = 0
    let firstFailure: number | null = null
    let wait = t.retryFirstMs
    /** Waits for the plugin to run again. That time is not time spent failing (final review M1): a plugin stopped for a
     *  night does not give an event up after one more try. */
    const idle = async (): Promise<void> => {
      const from = now()
      await pause()
      if (firstFailure !== null) firstFailure += now() - from
    }
    for (;;) {
      if (stopped) return false
      if (!d.running()) {
        await idle()
        continue
      }
      const gen = generation
      let problem: string
      try {
        await withTimeout((signal) => d.deliver(item, signal))
        return !stopped
      } catch (e) {
        if (stopped) return false
        if (e instanceof DeliveryInterrupted) {
          // Not counted: the plugin is started again by its restart policy, and the event goes again once it runs
          if (generation === gen) await idle()
          continue
        }
        problem = e instanceof TimedOut ? `the plugin did not finish with it within ${seconds(t.timeoutMs)}` : messageOf(e)
      }
      tries += 1
      firstFailure ??= now()
      if (now() - firstFailure >= t.giveUpMs) {
        d.log(`gave up delivering ${label} after ${tries} tries: ${problem}`)
        return true
      }
      if (tries === 1 || tries % t.logEvery === 0) d.log(`delivering ${label} failed (try ${tries}): ${problem}; trying again in ${seconds(wait)}`)
      await pause(wait)
      wait = Math.min(wait * 2, t.retryMaxMs)
    }
  }

  async function run(): Promise<void> {
    let stored: string | null = null
    // A file that holds no cursor is gone for good, and delivery goes on from now. A read the system refused (a file
    // being moved, on Windows) is tried again, since going on from now would skip the backlog (final review M2).
    let wait = t.retryFirstMs
    for (let tries = 1; !stopped; tries++) {
      try {
        stored = await d.cursor.read()
        break
      } catch (e) {
        if (e instanceof PluginCursorUnreadable) {
          d.log(`the event cursor could not be read (${messageOf(e)}); delivering from now on`)
          break
        }
        if (tries === 1 || tries % t.logEvery === 0) d.log(`the event cursor could not be read (${messageOf(e)}); trying again in ${seconds(wait)}`)
        await pause(wait)
        wait = Math.min(wait * 2, t.retryMaxMs)
      }
    }
    if (stopped) return
    // No cursor yet: from the tail, written at once, so an install replays no history and a first stop has a place
    if (stored === null) move(d.source.tail())
    else cursor = written = stored
    /** The cursor a gap was handed over for, so it goes once. */
    let gapFor: string | null = null
    while (!stopped) {
      if (!d.running()) {
        await pause()
        continue
      }
      const r = d.source.read({ ...(cursor !== null ? { after: cursor } : {}), limit: READ_LIMIT })
      if ('error' in r) {
        d.log(`the event cursor ${cursor ?? ''} is not one the log reads (${r.error}); delivering from now on`)
        move(d.source.tail())
        continue
      }
      if (r.gap && gapFor !== cursor) {
        if (!(await handOver({ type: 'gap' }, 'a gap'))) continue
        gapFor = cursor
        if (r.events.length === 0) move(r.cursor)
      }
      if (r.events.length === 0) {
        d.idle?.()
        await Promise.race([d.source.next(IDLE_WAIT_MS), pause()])
        continue
      }
      for (const e of r.events) {
        if (!(await handOver(e, `${e.type} ${e.id}`))) break
        move(e.id)
      }
    }
  }

  void run().catch((e: unknown) => d.log(`event delivery stopped: ${messageOf(e)}`))

  return {
    wake: () => {
      generation += 1
      kick()
    },
    stop: async () => {
      if (stopped) return
      stopped = true
      kick()
      await persist()
      // A write in flight that failed leaves the latest cursor unwritten: the stop writes it (final review M3)
      if (cursor !== null && cursor !== written) await persist()
    }
  }
}
