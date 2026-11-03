import { describe, it, expect, vi } from 'vitest'
import { createMovedSignal, createRefill } from './resync'
import { createMirrorStore } from './mirrorStore'
import { emptyState } from '../../core/orchestration/state'
import type { OrchState } from '../../core/orchestration/state'

const noSleep = async (): Promise<void> => {}

describe('createRefill (the mirror after a reconnect)', () => {
  it('tries a failed state-get again until one lands, and puts that state into the mirror', async () => {
    const fresh = { ...emptyState(), gates: [{ id: 'gat_1', status: 'resolved' }] } as unknown as OrchState
    const fetch = vi
      .fn<() => Promise<{ state: OrchState; version: number }>>()
      .mockRejectedValueOnce(new Error('the Host did not answer state-get within 15000ms'))
      .mockRejectedValueOnce(new Error('the Host did not answer state-get within 15000ms'))
      .mockResolvedValue({ state: fresh, version: 9 })
    const mirror = createMirrorStore({ call: vi.fn() })
    mirror.accept({ ...emptyState(), gates: [{ id: 'gat_1', status: 'open' }] } as unknown as OrchState, 3)
    const logs: string[] = []
    const sleeps: number[] = []
    const refill = createRefill({
      fetch,
      apply: (r) => mirror.accept(r.state, r.version),
      log: (l) => logs.push(l),
      delaysMs: [10, 20, 30],
      sleep: async (ms) => void sleeps.push(ms)
    })
    expect(await refill.run()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([10, 20])
    expect(mirror.getState()).toBe(fresh)
    expect(logs.at(-1)).toContain('after 3 tries')
  })

  it('gives up after its last wait, saying so', async () => {
    const apply = vi.fn()
    const logs: string[] = []
    const refill = createRefill({ fetch: () => Promise.reject(new Error('no')), apply, log: (l) => logs.push(l), delaysMs: [1, 1], sleep: noSleep })
    expect(await refill.run()).toBe(false)
    expect(apply).not.toHaveBeenCalled()
    expect(logs.at(-1)).toContain('3 tries')
  })

  it("a newer handshake's refill takes over: the older one's late answer is not applied", async () => {
    let release: (v: string) => void = () => {}
    const answers = [new Promise<string>((r) => (release = r)), Promise.resolve('new')]
    const applied: string[] = []
    const refill = createRefill({ fetch: () => answers.shift()!, apply: (v) => applied.push(v), log: () => {}, sleep: noSleep })
    const first = refill.run()
    const second = refill.run()
    expect(await second).toBe(true)
    release('old')
    expect(await first).toBe(false)
    expect(applied).toEqual(['new'])
  })
})

describe('createMovedSignal', () => {
  it('sends at once, then at most once per gap with the newest generation', () => {
    let t = 0
    const timers: Array<{ at: number; fn: () => void }> = []
    const sent: number[] = []
    const s = createMovedSignal({ send: (g) => sent.push(g), gapMs: 1000, now: () => t, after: (ms, fn) => void timers.push({ at: t + ms, fn }) })
    s.moved(1)
    expect(sent).toEqual([1])
    t = 100
    s.moved(2)
    s.moved(3)
    expect(sent).toEqual([1])
    expect(timers).toHaveLength(1)
    t = timers[0]!.at
    timers.shift()!.fn()
    expect(sent).toEqual([1, 3])
    t = 5000
    s.moved(4)
    expect(sent).toEqual([1, 3, 4])
  })
})

describe('the mirror generation', () => {
  it('moves on a push and on a write, and tells its listener', async () => {
    const told: number[] = []
    const m = createMirrorStore({ call: vi.fn().mockResolvedValue({ status: 200, body: { version: 2 } }), onMoved: (g) => told.push(g) })
    expect(m.generation()).toBe(0)
    m.accept(emptyState(), 1)
    expect(m.generation()).toBe(1)
    await m.setState({ ...emptyState() })
    expect(m.generation()).toBe(2)
    expect(told).toEqual([1, 2])
  })

  it('a listener that throws costs the mirror nothing', () => {
    const m = createMirrorStore({
      call: vi.fn(),
      onMoved: () => {
        throw new Error('window gone')
      }
    })
    const s = emptyState()
    m.accept(s)
    expect(m.getState()).toBe(s)
  })
})
