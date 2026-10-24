// Stale-while-revalidate reads: a view shows its last data at once and refreshes in the background.
//   const { data, stale, error } = useCachedRead(projectId ? `scm:${projectId}` : null, () => window.api.scm.status(projectId), {
//     invalidateOn: ['git:changed']              // push channels that make this key stale (subscribed once per channel)
//   })
//   if (data === undefined) return <Loading />   // only the first read of a key has no data; later mounts paint at once
// A push that carries the new value skips the refetch:  window.api.on('x:changed', (v) => setCached('x', v))
// Another view's write makes a key stale:               invalidate('scm:')   // prefix; mounted readers refetch now
// A fetch that fails keeps the old data and sets `error`; the next mount or invalidate tries again. A fetch that
// returns what the cache holds (JSON-equal) keeps the old object, so memoised derived data does not recompute.
// Keys are per window and live in memory only; fetcher results must be JSON-able (they are compared as JSON).
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { CoreEventChannel } from '../../../core/types'
import { createLatest } from './latest'

export interface CachedRead<T> {
  data: T | undefined
  /** True until a fetch has answered since the last invalidate (data may still be shown meanwhile). */
  stale: boolean
  error?: unknown
}

export interface ReadCacheDeps {
  /** Subscribes to a push channel and returns the unsubscribe. */
  on?: (channel: string, cb: () => void) => () => void
  max?: number
}

interface Entry {
  snap: CachedRead<unknown>
  latest: ReturnType<typeof createLatest>
  inflight: Promise<unknown> | null
  /** The fetcher a mounted reader gave last; what an invalidate refetches with. */
  fetcher: (() => Promise<unknown>) | null
}

const MAX_ENTRIES = 200
const EMPTY: CachedRead<never> = { data: undefined, stale: true }
const noop = (): void => undefined

function sameJson(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function createReadCache({ on, max = MAX_ENTRIES }: ReadCacheDeps = {}) {
  // shortcut: Map insertion order is the recency (touch = delete + set), eviction scans from the oldest; fine for 200 keys.
  const entries = new Map<string, Entry>()
  const listeners = new Map<string, Set<() => void>>()
  const channels = new Map<string, { off: () => void; keys: Set<string> }>()

  const drop = (key: string): void => {
    entries.delete(key)
    for (const [c, ch] of channels) {
      ch.keys.delete(key)
      if (ch.keys.size === 0) {
        ch.off()
        channels.delete(c)
      }
    }
  }
  /** The entry of `key`, made the most recent; the oldest unmounted ones go when over the cap. */
  const entryOf = (key: string): Entry => {
    let e = entries.get(key)
    if (e) entries.delete(key)
    else e = { snap: EMPTY, latest: createLatest(), inflight: null, fetcher: null }
    entries.set(key, e)
    for (const k of entries.keys()) {
      if (entries.size <= max) break
      if (k !== key && !listeners.has(k)) drop(k)
    }
    return e
  }
  const publish = (key: string, e: Entry, patch: Partial<CachedRead<unknown>>): void => {
    const next = { ...e.snap, ...patch }
    if (next.data === e.snap.data && next.stale === e.snap.stale && next.error === e.snap.error) return
    e.snap = next
    listeners.get(key)?.forEach((l) => l())
  }

  const revalidate = <T>(key: string, e: Entry, fetcher: () => Promise<T>): Promise<T> => {
    if (e.inflight) return e.inflight as Promise<T>
    const ticket = e.latest.next()
    // A late answer is dropped when a newer fetch, an invalidate, a set or an eviction came after this one started.
    const live = (): boolean => e.latest.isCurrent(ticket) && entries.get(key) === e
    const p = (async () => {
      try {
        const value = await fetcher()
        if (!live()) return value
        e.inflight = null
        const data = sameJson(e.snap.data, value) ? (e.snap.data as T) : value
        publish(key, e, { data, stale: false, error: undefined })
        return data
      } catch (error) {
        if (live()) {
          e.inflight = null
          publish(key, e, { error })
        }
        throw error
      }
    })()
    e.inflight = p
    p.catch(noop) // the hook has nobody to hand the rejection to; `read` callers get their own
    return p
  }

  const invalidateWhere = (match: (key: string) => boolean): void => {
    for (const [key, e] of [...entries]) {
      if (!match(key)) continue
      if (e.inflight) {
        e.inflight = null
        e.latest.next()
      }
      publish(key, e, { stale: true })
      if (listeners.has(key) && e.fetcher) void revalidate(key, e, e.fetcher)
    }
  }

  return {
    get: <T>(key: string): CachedRead<T> => (entries.get(key)?.snap ?? EMPTY) as CachedRead<T>,
    subscribe(key: string, l: () => void): () => void {
      let set = listeners.get(key)
      if (!set) listeners.set(key, (set = new Set()))
      set.add(l)
      return () => {
        set.delete(l)
        if (set.size === 0) listeners.delete(key)
      }
    },
    /** A reader of `key` mounted: remember its fetcher and fetch in the background when there is nothing fresh. */
    start(key: string, fetcher: () => Promise<unknown>): void {
      const e = entryOf(key)
      e.fetcher = fetcher
      if (e.snap.stale) void revalidate(key, e, fetcher)
    },
    /** Makes `key` stale on each push of the channels. Kept after the reader unmounts: a push missed while the view
     *  was away must still mark what it left behind. Ends with the entry (eviction). */
    watch(key: string, channelNames: readonly string[]): void {
      entryOf(key)
      for (const name of channelNames) {
        let ch = channels.get(name)
        if (!ch) {
          const keys = new Set<string>()
          ch = { keys, off: on!(name, () => invalidateWhere((k) => keys.has(k))) }
          channels.set(name, ch)
        }
        ch.keys.add(key)
      }
    },
    /** The value of `key` if it is fresh, else what one fetch (shared with every concurrent caller) answers. */
    read<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
      const e = entryOf(key)
      return e.snap.stale ? revalidate(key, e, fetcher) : Promise.resolve(e.snap.data as T)
    },
    set<T>(key: string, value: T): void {
      const e = entryOf(key)
      e.inflight = null
      e.latest.next()
      publish(key, e, { data: sameJson(e.snap.data, value) ? e.snap.data : value, stale: false, error: undefined })
    },
    /** Marks the keys that start with `prefix` stale; those with a mounted reader refetch now. */
    invalidate: (prefix: string): void => invalidateWhere((k) => k.startsWith(prefix))
  }
}

const cache = createReadCache({ on: (channel, cb) => window.api.on(channel as CoreEventChannel, cb) })

export const readCached = cache.read
export const setCached = cache.set
export const invalidate = cache.invalidate

export function useCachedRead<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts?: { invalidateOn?: string[] }
): CachedRead<T> {
  const latestFetcher = useRef(fetcher)
  useEffect(() => {
    latestFetcher.current = fetcher
  })
  const channelList = opts?.invalidateOn?.join('\n') ?? ''
  useEffect(() => {
    if (key === null) return
    if (channelList) cache.watch(key, channelList.split('\n'))
    cache.start(key, () => latestFetcher.current())
  }, [key, channelList])
  const subscribe = useCallback((l: () => void) => (key === null ? noop : cache.subscribe(key, l)), [key])
  const snapshot = (): CachedRead<T> => (key === null ? EMPTY : cache.get<T>(key))
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
