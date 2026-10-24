import { useEffect, useRef } from 'react'
import { invalidate, setCached, useCachedRead } from '../lib/readCache'

type Update<T> = T | ((prev: T) => T)

/** `useState` for a setting that lives in main: the last value shows at once on reopen (readCache), the getter
 *  refreshes it on every mount — a setting has no push, so open is the one moment to revalidate. The setter writes
 *  the cache, so an optimistic change, its revert and a saved value are what the next open starts from. */
export function useSetting<T>(key: string, getter: () => Promise<T>): [T | undefined, (v: Update<T | undefined>) => void]
export function useSetting<T>(key: string, getter: () => Promise<T>, initial: T): [T, (v: Update<T>) => void]
export function useSetting<T>(key: string, getter: () => Promise<T>, initial?: T): [T | undefined, (v: Update<T | undefined>) => void] {
  const cacheKey = `setting:${key}`
  // Declared before useCachedRead so its start effect finds the key stale and fetches once.
  useEffect(() => invalidate(cacheKey), [cacheKey])
  const { data } = useCachedRead(cacheKey, getter)
  const value = data === undefined ? initial : data
  const latest = useRef(value)
  latest.current = value
  const set = (v: Update<T | undefined>): void => {
    const next = typeof v === 'function' ? (v as (prev: T | undefined) => T | undefined)(latest.current) : v
    latest.current = next
    if (next !== undefined) setCached(cacheKey, next)
  }
  return [value, set]
}
