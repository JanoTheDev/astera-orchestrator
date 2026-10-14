// The deliverer under fake timers (plugin Phase 3 N6-N9): where it starts, one event at a time in order, the retry
// schedule, the give-up at an hour, the 30 s limit, a gap, a pause while the plugin does not run, a process that ended
// mid-delivery, and a cursor written behind it and never after the stop. The log is a real event ring.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createEventRing, type EventRing } from '../../core/events/eventRing'
import type { AsteraEvent } from '../../core/publicContract'
import type { EventDraft } from '../../core/orchestration/publicEvents'
import { DELIVERY_GIVE_UP_MS, DELIVERY_RETRY_MS, DELIVERY_TIMEOUT_MS, DeliveryInterrupted, createDeliverer, type Deliverer } from './deliverer'

const RUN = { id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: 'T', outcome: 'completed', progress: { done: 2, total: 2 }, questionsOpen: 0 }
const ev = (n: number): string => `ev_aaaaaaaaaaaa_${n}`

let ring: EventRing
const live: Deliverer[] = []
beforeEach(() => {
  vi.useFakeTimers({ now: 0 })
  // Five events held, so a cursor older than that reads with a gap
  ring = createEventRing({ boot: 'aaaaaaaaaaaa', retainEvents: 5, retainChars: 1 << 20 })
})
afterEach(async () => {
  for (const d of live.splice(0)) await d.stop()
  vi.useRealTimers()
})

const add = (n: number): void => {
  for (let i = 0; i < n; i++) ring.append([{ type: 'run.completed', jobId: 'job_1', runId: 'run_1', payload: RUN } as EventDraft], 'T')
}
/** Lets the deliverer's promises settle without moving the clock. */
const flush = async (): Promise<void> => void (await vi.advanceTimersByTimeAsync(0))

interface RigOptions {
  /** The cursor the store holds. */
  stored?: string
  /** The store's read throws this. */
  unreadable?: string
  /** Each write waits for `store.finish()`. */
  slowWrites?: boolean
  /** Each delivery waits for `settle()`; with `fail`, it then fails. */
  slow?: boolean
  /** Every delivery fails with this. */
  fail?: string
  /** These ids fail, with "boom". */
  failIds?: string[]
  /** Every delivery waits for ever (or for `settleAll()`). */
  hang?: boolean
  running?: boolean
  /** The first delivery finds the plugin's process gone. */
  interruptOnce?: boolean
}

function rig(o: RigOptions = {}) {
  const got: string[] = []
  const logs: string[] = []
  const calls: number[] = []
  const waiting: Array<() => void> = []
  const writes: string[] = []
  const unwritten: Array<() => void> = []
  let running = o.running ?? true
  let interrupted = false
  const store = {
    writes,
    finish: (): void => unwritten.splice(0).forEach((f) => f()),
    read: async (): Promise<string | null> => {
      if (o.unreadable !== undefined) throw new Error(o.unreadable)
      return o.stored ?? null
    },
    write: (c: string): Promise<void> => {
      writes.push(c)
      return o.slowWrites ? new Promise<void>((r) => unwritten.push(r)) : Promise.resolve()
    }
  }
  const d = createDeliverer({
    source: ring,
    cursor: store,
    running: () => running,
    deliver: (item) => {
      calls.push(Date.now())
      const label = item.type === 'gap' ? 'gap' : (item as AsteraEvent).id
      if (o.interruptOnce && !interrupted) {
        interrupted = true
        return Promise.reject(new DeliveryInterrupted('the plugin exited'))
      }
      if (o.hang) return new Promise<void>((resolve) => waiting.push(resolve))
      if (o.slow)
        return new Promise<void>((resolve, reject) =>
          waiting.push(() => {
            if (o.fail !== undefined) return reject(new Error(o.fail))
            got.push(label)
            resolve()
          })
        )
      if (o.fail !== undefined || o.failIds?.includes(label)) return Promise.reject(new Error(o.fail ?? 'boom'))
      got.push(label)
      return Promise.resolve()
    },
    log: (m) => logs.push(m)
  })
  live.push(d)
  return {
    d,
    got,
    logs,
    store,
    inFlight: (): number => waiting.length,
    settle: (): void => waiting.shift()?.(),
    settleAll: (): void => waiting.splice(0).forEach((f) => f()),
    setRunning: (v: boolean): void => {
      running = v
    },
    /** The time between one delivery and the next. */
    gaps: (): number[] => calls.slice(1).map((t, i) => t - calls[i])
  }
}

describe('createDeliverer (plugin Phase 3 N6-N9)', () => {
  it('starts at the log’s tail with no cursor, writes that at once, and hands over only what comes after', async () => {
    add(2)
    const r = rig()
    await flush()
    expect(r.store.writes).toEqual([ev(2)])
    add(1)
    await flush()
    expect(r.got).toEqual([ev(3)])
    await r.d.stop()
    expect(r.store.writes.at(-1)).toBe(ev(3))
  })

  it('reads on from a stored cursor, one event at a time, in order', async () => {
    add(3)
    const r = rig({ stored: ev(1), slow: true })
    await flush()
    expect(r.inFlight()).toBe(1)
    r.settle()
    await flush()
    expect(r.inFlight()).toBe(1)
    r.settle()
    await flush()
    expect(r.got).toEqual([ev(2), ev(3)])
    expect(r.store.writes).toEqual([ev(2), ev(3)])
  })

  it('tries a failed event again after 1 s, doubling to 5 min, and logs the first failure and every tenth', async () => {
    add(1)
    const r = rig({ stored: ev(0), fail: 'boom' })
    await flush()
    const waits = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000]
    for (const ms of waits) await vi.advanceTimersByTimeAsync(ms)
    expect(r.gaps()).toEqual(waits)
    expect(r.logs).toEqual([
      `delivering run.completed ${ev(1)} failed (try 1): boom; trying again in 1 s`,
      `delivering run.completed ${ev(1)} failed (try 10): boom; trying again in 300 s`
    ])
    expect(r.store.writes).toEqual([])
  })

  it('gives an event up after an hour of failures, says which, and goes on to the next', async () => {
    add(2)
    const r = rig({ stored: ev(0), failIds: [ev(1)] })
    await vi.advanceTimersByTimeAsync(DELIVERY_GIVE_UP_MS + DELIVERY_RETRY_MS.max)
    expect(r.logs.filter((l) => /^gave up delivering run\.completed ev_aaaaaaaaaaaa_1 after \d+ tries: boom$/.test(l))).toHaveLength(1)
    expect(r.got).toEqual([ev(2)])
    expect(r.store.writes).toEqual([ev(1), ev(2)])
  })

  it('counts a handler that has not settled within 30 s as failed, and ignores its late settle', async () => {
    add(1)
    const r = rig({ stored: ev(0), hang: true })
    await flush()
    await vi.advanceTimersByTimeAsync(DELIVERY_TIMEOUT_MS)
    expect(r.logs).toEqual([`delivering run.completed ${ev(1)} failed (try 1): onEvent did not finish within 30 s; trying again in 1 s`])
    r.settleAll()
    await flush()
    expect(r.store.writes).toEqual([])
  })

  it('hands over a gap first when the cursor is older than the log holds, then the oldest event held', async () => {
    add(8)
    const r = rig({ stored: ev(1) })
    await flush()
    expect(r.got).toEqual(['gap', ev(4), ev(5), ev(6), ev(7), ev(8)])
  })

  it('hands over a gap once, and moves to the tail, when the log holds nothing of the cursor and nothing after it', async () => {
    const r = rig({ stored: 'ev_bbbbbbbbbbbb_7' })
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.got).toEqual(['gap'])
    expect(r.store.writes).toEqual([ev(0)])
  })

  it('holds deliveries while the plugin does not run, and goes on when it is woken', async () => {
    add(1)
    const r = rig({ stored: ev(0), running: false })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.got).toEqual([])
    r.setRunning(true)
    r.d.wake()
    await flush()
    expect(r.got).toEqual([ev(1)])
  })

  it('starts an event over, without counting a failure, once the plugin runs again after its process ended mid-delivery', async () => {
    add(1)
    const r = rig({ stored: ev(0), interruptOnce: true })
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(r.got).toEqual([])
    r.d.wake()
    await flush()
    expect(r.got).toEqual([ev(1)])
    expect(r.logs).toEqual([])
  })

  // Review Focus 2
  it('stops at once during a retry wait, and writes no cursor after the stop', async () => {
    add(1)
    const r = rig({ stored: ev(0), fail: 'boom', slow: true })
    await flush()
    r.settle()
    await flush()
    expect(r.logs).toHaveLength(1)
    await r.d.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(r.inFlight()).toBe(0)
    expect(r.store.writes).toEqual([])
  })

  it('moves and writes no cursor when the delivery in flight settles after the stop', async () => {
    add(1)
    const r = rig({ stored: ev(0), slow: true })
    await flush()
    await r.d.stop()
    r.settle()
    await flush()
    expect(r.store.writes).toEqual([])
  })

  it('writes the cursor it moved to when it stops, after a write that failed', async () => {
    add(1)
    let fails = 1
    const writes: string[] = []
    const logs: string[] = []
    const d = createDeliverer({
      source: ring,
      cursor: {
        read: async () => ev(0),
        write: async (c) => {
          if (fails-- > 0) throw new Error('disk full')
          writes.push(c)
        }
      },
      running: () => true,
      deliver: async () => {},
      log: (m) => logs.push(m)
    })
    await flush()
    expect(logs).toEqual(['the event cursor could not be written: disk full'])
    await d.stop()
    expect(writes).toEqual([ev(1)])
  })

  // Review Focus 3
  it('goes on from now when the cursor file cannot be read, and says so', async () => {
    add(2)
    const r = rig({ unreadable: 'x.json is not JSON' })
    await flush()
    expect(r.logs).toEqual(['the event cursor could not be read (x.json is not JSON); delivering from now on'])
    expect(r.store.writes).toEqual([ev(2)])
  })

  it('writes one cursor at a time, the latest after the one in flight', async () => {
    add(3)
    const r = rig({ stored: ev(0), slowWrites: true })
    await flush()
    expect(r.got).toEqual([ev(1), ev(2), ev(3)])
    expect(r.store.writes).toEqual([ev(1)])
    r.store.finish()
    await flush()
    expect(r.store.writes).toEqual([ev(1), ev(3)])
    r.store.finish()
  })
})
