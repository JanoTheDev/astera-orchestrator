import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createReadCache, setCached, useCachedRead } from './readCache'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** A cache whose push channels the test fires by hand. */
function setup(max?: number) {
  const subs = new Map<string, Set<() => void>>()
  const on = vi.fn((channel: string, cb: () => void) => {
    if (!subs.has(channel)) subs.set(channel, new Set())
    subs.get(channel)!.add(cb)
    return () => subs.get(channel)!.delete(cb)
  })
  const cache = createReadCache({ on, max })
  const push = (channel: string): void => subs.get(channel)?.forEach((cb) => cb())
  return { cache, on, push, subs }
}

describe('readCache', () => {
  it('returns cached data at once, then updates in place after the background fetch', async () => {
    const { cache } = setup()
    cache.set('k', { n: 1 })
    cache.invalidate('k')
    const d = deferred<{ n: number }>()
    const seen = vi.fn()
    cache.subscribe('k', seen)
    cache.start('k', () => d.promise)
    expect(cache.get('k')).toMatchObject({ data: { n: 1 }, stale: true })
    d.resolve({ n: 2 })
    await flush()
    expect(cache.get('k')).toMatchObject({ data: { n: 2 }, stale: false })
    expect(seen).toHaveBeenCalled()
  })

  it('has no data until the first fetch answers', async () => {
    const { cache } = setup()
    const d = deferred<number>()
    cache.start('k', () => d.promise)
    expect(cache.get('k')).toMatchObject({ data: undefined, stale: true })
    d.resolve(7)
    await flush()
    expect(cache.get('k')).toMatchObject({ data: 7, stale: false })
  })

  it('fetches once for concurrent reads of one key', async () => {
    const { cache } = setup()
    const d = deferred<number>()
    const fetcher = vi.fn(() => d.promise)
    const a = cache.read('k', fetcher)
    const b = cache.read('k', fetcher)
    cache.start('k', fetcher)
    d.resolve(1)
    expect(await Promise.all([a, b])).toEqual([1, 1])
    expect(fetcher).toHaveBeenCalledTimes(1)
    await cache.read('k', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps the newest answer when an older fetch answers last', async () => {
    const { cache } = setup()
    const first = deferred<string>()
    const second = deferred<string>()
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    cache.subscribe('k', () => undefined)
    cache.start('k', fetcher)
    cache.invalidate('k') // a push while the first fetch is out: the second one is newer
    second.resolve('new')
    await flush()
    first.resolve('old')
    await flush()
    expect(cache.get('k')).toMatchObject({ data: 'new', stale: false })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('keeps the old data when a fetch fails, and tries again on the next start', async () => {
    const { cache } = setup()
    cache.set('k', 'kept')
    cache.invalidate('k')
    const boom = new Error('boom')
    cache.start('k', () => Promise.reject(boom))
    await flush()
    expect(cache.get('k')).toEqual({ data: 'kept', stale: true, error: boom })
    cache.start('k', () => Promise.resolve('fresh'))
    await flush()
    expect(cache.get('k')).toEqual({ data: 'fresh', stale: false, error: undefined })
  })

  it('rejects a read whose fetch failed', async () => {
    const { cache } = setup()
    await expect(cache.read('k', () => Promise.reject(new Error('nope')))).rejects.toThrow('nope')
  })

  it('a push on the channel invalidates and refetches a mounted key', async () => {
    const { cache, push } = setup()
    let n = 0
    const fetcher = vi.fn(async () => ++n)
    cache.subscribe('k', () => undefined)
    cache.watch('k', ['git:changed'])
    cache.start('k', fetcher)
    await flush()
    expect(cache.get('k').data).toBe(1)
    push('git:changed')
    expect(cache.get('k').stale).toBe(true)
    await flush()
    expect(cache.get('k')).toMatchObject({ data: 2, stale: false })
  })

  it('a push marks an unmounted key stale without fetching; the next start fetches', async () => {
    const { cache, push } = setup()
    const fetcher = vi.fn(async () => 'v')
    cache.watch('k', ['git:changed'])
    cache.start('k', fetcher)
    await flush()
    push('git:changed')
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cache.get('k').stale).toBe(true)
    cache.start('k', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('subscribes to a channel once however many keys watch it', () => {
    const { cache, on, push } = setup()
    const l = vi.fn()
    cache.subscribe('a', l)
    cache.watch('a', ['c1', 'c2'])
    cache.watch('b', ['c1'])
    cache.watch('a', ['c1'])
    expect(on).toHaveBeenCalledTimes(2)
    push('c1')
    expect(cache.get('a').stale).toBe(true)
  })

  it('invalidate refetches the mounted keys under a prefix only', async () => {
    const { cache } = setup()
    const fa = vi.fn(async () => 'a')
    const fb = vi.fn(async () => 'b')
    const fc = vi.fn(async () => 'c')
    cache.subscribe('scm:1', () => undefined)
    cache.subscribe('other', () => undefined)
    cache.start('scm:1', fa)
    cache.start('scm:2', fb) // not mounted
    cache.start('other', fc)
    await flush()
    cache.invalidate('scm:')
    await flush()
    expect(fa).toHaveBeenCalledTimes(2)
    expect(fb).toHaveBeenCalledTimes(1)
    expect(fc).toHaveBeenCalledTimes(1)
    expect(cache.get('scm:2').stale).toBe(true)
  })

  it('setCached replaces the value, drops an older fetch and clears stale', async () => {
    const { cache } = setup()
    const d = deferred<string>()
    cache.start('k', () => d.promise)
    cache.set('k', 'pushed')
    d.resolve('older')
    await flush()
    expect(cache.get('k')).toMatchObject({ data: 'pushed', stale: false })
  })

  it('keeps the old object when a refetch returns an equal value', async () => {
    const { cache } = setup()
    const first = { list: [1, 2] }
    cache.start('k', async () => first)
    await flush()
    cache.invalidate('k')
    cache.start('k', async () => ({ list: [1, 2] }))
    await flush()
    expect(cache.get('k').data).toBe(first)
    cache.set('k', { list: [1, 2] })
    expect(cache.get('k').data).toBe(first)
    cache.set('k', { list: [3] })
    expect(cache.get('k').data).not.toBe(first)
  })

  it('does not notify when nothing changed', async () => {
    const { cache } = setup()
    cache.set('k', { a: 1 })
    const l = vi.fn()
    cache.subscribe('k', l)
    cache.set('k', { a: 1 })
    expect(l).not.toHaveBeenCalled()
  })

  it('evicts the least recently used entry over the cap, never a mounted one', () => {
    const { cache } = setup(2)
    cache.subscribe('mounted', () => undefined)
    cache.set('mounted', 1)
    cache.set('a', 1)
    cache.set('b', 1) // over the cap: `mounted` is oldest but mounted, so `a` goes
    expect(cache.get('mounted').data).toBe(1)
    expect(cache.get('a').data).toBeUndefined()
    expect(cache.get('b').data).toBe(1)
    cache.set('c', 1) // `mounted` is exempt again, so b is the oldest unmounted
    expect(cache.get('b').data).toBeUndefined()
    expect(cache.get('c').data).toBe(1)
  })

  it('a read makes its key the most recent', async () => {
    const { cache } = setup(2)
    cache.set('a', 1)
    cache.set('b', 1)
    await cache.read('a', async () => 2)
    cache.set('c', 1)
    expect(cache.get('a').data).toBe(1)
    expect(cache.get('b').data).toBeUndefined()
  })

  it('drops the push subscription with the last evicted key of a channel', () => {
    const { cache, subs } = setup(1)
    cache.watch('a', ['c1'])
    expect(subs.get('c1')!.size).toBe(1)
    cache.set('b', 1)
    expect(subs.get('c1')!.size).toBe(0)
  })

  it('an answer for an evicted key is dropped', async () => {
    const { cache } = setup(1)
    const d = deferred<string>()
    cache.start('a', () => d.promise)
    cache.set('b', 1) // evicts a
    d.resolve('late')
    await flush()
    expect(cache.get('a').data).toBeUndefined()
  })
})

describe('useCachedRead', () => {
  function View({ k }: { k: string | null }) {
    const { data, stale } = useCachedRead<{ n: number }>(k, async () => ({ n: 0 }))
    return React.createElement('span', null, `${data ? data.n : 'none'}/${stale}`)
  }

  it('renders cached data on the first paint', () => {
    setCached('hook:cached', { n: 5 })
    expect(renderToStaticMarkup(React.createElement(View, { k: 'hook:cached' }))).toContain('5/false')
  })

  it('renders no data for an unread or null key', () => {
    expect(renderToStaticMarkup(React.createElement(View, { k: 'hook:unread' }))).toContain('none/true')
    expect(renderToStaticMarkup(React.createElement(View, { k: null }))).toContain('none/true')
  })
})
