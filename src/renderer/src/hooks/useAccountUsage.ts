import { useSyncExternalStore } from 'react'
import type { AccountUsage } from '../../../core/types'

/**
 * Per-account usage for the account rows (design doc §4). Keyed by `configDir`, matching main's cache
 * key — a row reads `usage[account.configDir]`.
 *
 * Subscribing on mount and unsubscribing on unmount is what paces the feature: the panel is not
 * always on screen (the sidebar closes, and the rail swaps it for Jobs or How It Works), and a panel
 * nobody is looking at should not be spending requests. This is the zero-subscriber stop githubPrs
 * already has, for the same reason.
 *
 * There is no `accounts` argument and no refresh: main decides which accounts it can answer for, and
 * pushes the whole map whenever it changes. A failed fetch is silent by design (§9) — the row falls
 * back to its remembered reading, or to nothing.
 */
/** The hook's reads without React (second pass R2-9): the map main holds, then each pushed map. A first read that
 *  lands after a push is older than it and is dropped, and nothing is set once stopped. Returns the stop. */
export function followAccountUsage(o: {
  ask: () => Promise<Record<string, AccountUsage>>
  on: (cb: (m: Record<string, AccountUsage>) => void) => () => void
  set: (m: Record<string, AccountUsage>) => void
}): () => void {
  let alive = true
  let pushed = false
  const off = o.on((m) => {
    if (!alive) return
    pushed = true
    o.set(m)
  })
  o.ask().then(
    (m) => {
      if (alive && !pushed) o.set(m)
    },
    () => {}
  )
  return () => {
    alive = false
    off()
  }
}

type UsageMap = Record<string, AccountUsage>

/** One window-wide copy of the usage map. The first listener starts the single main-side subscription, the last one
 *  stops it; the map outlives that, so a panel that opens later paints the last figures before its own read answers. */
export function createUsageStore(io: {
  ask: () => Promise<UsageMap>
  on: (cb: (m: UsageMap) => void) => () => void
  subscribe: () => void
  unsubscribe: () => void
}) {
  let map: UsageMap = {}
  let stop: (() => void) | null = null
  const listeners = new Set<() => void>()
  return {
    get: (): UsageMap => map,
    subscribe(l: () => void): () => void {
      listeners.add(l)
      if (listeners.size === 1) {
        stop = followAccountUsage({
          ask: io.ask,
          on: io.on,
          set: (m) => {
            map = m
            listeners.forEach((f) => f())
          }
        })
        io.subscribe()
      }
      return () => {
        listeners.delete(l)
        if (listeners.size > 0) return
        stop?.()
        stop = null
        io.unsubscribe()
      }
    }
  }
}

const store = createUsageStore({
  ask: () => window.api.usage.accounts(),
  on: (cb) => window.api.on('usage:accounts-updated', cb),
  subscribe: () => void window.api.usage.subscribe(),
  unsubscribe: () => void window.api.usage.unsubscribe()
})

export function useAccountUsage(): UsageMap {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
