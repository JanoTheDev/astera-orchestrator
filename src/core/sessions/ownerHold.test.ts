import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OWNER_HOLD_MS, createHeldQueue, createOwnerHold } from './ownerHold'

const T0 = 1_000_000_000_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => vi.useRealTimers())

describe('createOwnerHold', () => {
  it('holds a console typed into less than OWNER_HOLD_MS ago, and not at OWNER_HOLD_MS', () => {
    const hold = createOwnerHold({ typedAt: () => T0 })
    expect(hold.isHeld('s', T0 + OWNER_HOLD_MS - 1)).toBe(true)
    expect(hold.releaseAt('s', T0 + 1)).toBe(T0 + OWNER_HOLD_MS)
    expect(hold.isHeld('s', T0 + OWNER_HOLD_MS)).toBe(false)
    expect(hold.releaseAt('s', T0 + OWNER_HOLD_MS)).toBeNull()
  })

  it('holds a viewed console whatever the typing, only while the app is there', () => {
    let present = true
    const hold = createOwnerHold({ typedAt: () => null, viewerPresent: () => present })
    expect(hold.isHeld('s', T0)).toBe(false)
    hold.setViewing('s', true)
    expect(hold.isHeld('s', T0 + 10 * OWNER_HOLD_MS)).toBe(true)
    expect(hold.releaseAt('s', T0)).toBeNull()
    expect(hold.isHeld('other', T0)).toBe(false)
    present = false
    expect(hold.isHeld('s', T0)).toBe(false)
    present = true
    hold.setViewing('s', false)
    expect(hold.isHeld('s', T0)).toBe(false)
  })
})

describe('createHeldQueue', () => {
  const setup = (typedAt: () => number | null = () => null, deliver?: (x: string) => Promise<void>) => {
    const hold = createOwnerHold({ typedAt })
    const got: string[] = []
    const q = createHeldQueue<string>({
      hold,
      deliver: deliver ?? (async (x) => void got.push(x)),
      now: Date.now,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>)
    })
    return { hold, q, got }
  }

  it('delivers in order when viewing goes off', async () => {
    const { hold, q, got } = setup()
    hold.setViewing('s', true)
    q.enqueue('s', 'a')
    q.enqueue('s', 'b')
    await vi.advanceTimersByTimeAsync(0)
    expect(got).toEqual([])
    expect(q.pending('s')).toBe(2)
    hold.setViewing('s', false)
    await q.poke('s')
    expect(got).toEqual(['a', 'b'])
    expect(q.pending('s')).toBe(0)
  })

  it('delivers OWNER_HOLD_MS after the last keystroke, by its timer', async () => {
    const { q, got } = setup(() => T0 - 10_000)
    q.enqueue('s', 'a')
    await vi.advanceTimersByTimeAsync(OWNER_HOLD_MS - 10_001)
    expect(got).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(got).toEqual(['a'])
  })

  it('holds on when the owner types again before the timer fires', async () => {
    let typed = T0
    const { q, got } = setup(() => typed)
    q.enqueue('s', 'a')
    await vi.advanceTimersByTimeAsync(30_000)
    typed = Date.now()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(got, 'delivered while the owner was still typing').toEqual([])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(got).toEqual(['a'])
  })

  it('re-checks a viewed console a minute later, so a vanished app does not hold it forever', async () => {
    let present = true
    const hold = createOwnerHold({ typedAt: () => null, viewerPresent: () => present })
    const got: string[] = []
    const q = createHeldQueue<string>({ hold, deliver: async (x) => void got.push(x), now: Date.now, setTimer: setTimeout, clearTimer: (t) => clearTimeout(t as never) })
    hold.setViewing('s', true)
    q.enqueue('s', 'a')
    present = false
    await vi.advanceTimersByTimeAsync(OWNER_HOLD_MS)
    expect(got).toEqual(['a'])
  })

  it('a delivery that throws does not stop the next, and items queued mid-drain go last', async () => {
    const got: string[] = []
    const errors: unknown[] = []
    const hold = createOwnerHold({ typedAt: () => null })
    let q!: ReturnType<typeof createHeldQueue<string>>
    q = createHeldQueue<string>({
      hold,
      deliver: async (x) => {
        if (x === 'a') {
          q.enqueue('s', 'c')
          throw new Error('boom')
        }
        got.push(x)
      },
      now: Date.now,
      setTimer: setTimeout,
      clearTimer: (t) => clearTimeout(t as never),
      onError: (_t, e) => errors.push(e)
    })
    hold.setViewing('s', true)
    q.enqueue('s', 'a')
    q.enqueue('s', 'b')
    hold.setViewing('s', false)
    await q.poke('s')
    expect(got).toEqual(['b', 'c'])
    expect(errors).toHaveLength(1)
  })
})
