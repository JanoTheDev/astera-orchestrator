// Second pass R2-9: the first read of the usage map could land after a pushed update and put the older figures back,
// and it was set even after the panel had unmounted.
import { describe, it, expect } from 'vitest'
import { createUsageStore, followAccountUsage } from './useAccountUsage'

const deferred = <T>() => {
  let resolve!: (v: T) => void
  const p = new Promise<T>((r) => (resolve = r))
  return { p, resolve }
}

describe('followAccountUsage', () => {
  it('a first read that lands after a push does not put the older map back', async () => {
    const first = deferred<Record<string, unknown>>()
    let push: (m: Record<string, unknown>) => void = () => {}
    const got: unknown[] = []
    followAccountUsage({ ask: () => first.p as never, on: (cb) => ((push = cb as never), () => {}), set: (m) => void got.push(m) })
    push({ a: 'new' })
    first.resolve({ a: 'old' })
    await first.p
    await Promise.resolve()
    expect(got).toEqual([{ a: 'new' }])
  })

  it('sets nothing once stopped', async () => {
    const first = deferred<Record<string, unknown>>()
    const got: unknown[] = []
    const stop = followAccountUsage({ ask: () => first.p as never, on: () => () => {}, set: (m) => void got.push(m) })
    stop()
    first.resolve({ a: 'old' })
    await first.p
    await Promise.resolve()
    expect(got).toEqual([])
  })
})

describe('createUsageStore', () => {
  const make = () => {
    const calls = { subscribe: 0, unsubscribe: 0, ask: 0 }
    let push: (m: Record<string, unknown>) => void = () => {}
    const store = createUsageStore({
      ask: () => (calls.ask++, Promise.resolve({})),
      on: (cb) => ((push = cb as never), () => {}),
      subscribe: () => void calls.subscribe++,
      unsubscribe: () => void calls.unsubscribe++
    })
    return { store, calls, push: (m: Record<string, unknown>) => push(m) }
  }

  it('two consumers share one subscription, released with the last one', () => {
    const { store, calls } = make()
    const a = store.subscribe(() => {})
    const b = store.subscribe(() => {})
    expect(calls).toEqual({ subscribe: 1, unsubscribe: 0, ask: 1 })
    a()
    expect(calls.unsubscribe).toBe(0)
    b()
    expect(calls.unsubscribe).toBe(1)
  })

  it('a consumer mounted after a push sees the pushed map at once', () => {
    const { store, push } = make()
    const seen: unknown[] = []
    store.subscribe(() => seen.push(store.get()))
    push({ a: 'new' })
    expect(seen).toEqual([{ a: 'new' }])
    const late = store.subscribe(() => {})
    expect(store.get()).toEqual({ a: 'new' })
    late()
  })
})
