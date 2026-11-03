// One poll per key, shared by every subscriber (the workspace tree, a door's summaries). The first subscriber opens a
// visibility-aware timer with one read in flight; later ones join it and get the value already held; the last one to
// leave stops it. A read's result goes through `merge` so an unchanged answer keeps its identity and tells nobody.
//
// Staying current without the owner reopening the window (2026-11-03): a read that never settles, or takes minutes
// behind a busy Host, used to hold `running` and so every refresh after it; a read now has a deadline past which the
// next turn reads again (its late answer is dropped). A `probe` makes the turns cheap: the poll asks it first and reads
// the whole thing only when its answer moved, or the last whole read is `maxAgeMs` old. A signal (a push) reads at once.
import { pollWhileVisible } from '../lib/visiblePoll'

export interface SharedPollSource<V> {
  /** The answer, or undefined to keep what is held (a failed read, no Host yet). `prev` is what is held now, for a
   *  read that keeps the parts it could not read this time. */
  read(prev?: V): Promise<V | undefined>
  /** The value to hold given the last one: `prev` itself when nothing changed. Default: the new answer as it is. */
  merge?(prev: V | undefined, next: V): V
  /** Extra reasons to read now (a push); called once when the poll opens, returns its off. A signal skips the probe. */
  signals?(reload: () => void): () => void
  /** A cheap word on whether the whole read could have changed (main's state generation). A turn whose `key()` equals
   *  the one taken before the last whole read, within `maxAgeMs` of it, reads nothing. A throw reads the whole thing. */
  probe?: { key(): Promise<unknown>; maxAgeMs: number }
}

interface Entry<V> {
  listeners: Set<(v: V) => void>
  last: V | undefined
  reload: () => void
  stop: () => void
}

/** How long one read may take before the poll stops waiting for it: six turns, and never under 30 s. */
export const readDeadlineMs = (ms: number): number => Math.max(30_000, ms * 6)

export function createSharedPoll<V>(ms: number, doc?: EventTarget & { hidden: boolean }, o: { now?: () => number; readTimeoutMs?: number } = {}) {
  const entries = new Map<string, Entry<V>>()
  const now = o.now ?? Date.now
  const deadline = o.readTimeoutMs ?? readDeadlineMs(ms)

  const open = (source: SharedPollSource<V>): Entry<V> => {
    let running = false // a slow Host must not stack reads up behind each other
    let again = false // a load asked while a read ran: one follow-up read covers all of them
    let againForced = false
    let closed = false
    let seq = 0 // which read is the current one: a read past its deadline answers nobody
    let lastKey: unknown = undefined
    let lastFullAt = -Infinity
    const entry: Entry<V> = { listeners: new Set(), last: undefined, reload: () => void load(true), stop: () => {} }
    const load = async (forced: boolean): Promise<void> => {
      if (closed) return
      if (running) {
        again = true
        againForced ||= forced
        return
      }
      running = true
      const mine = ++seq
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        let key: unknown = undefined
        if (source.probe) {
          try {
            key = await source.probe.key()
          } catch {
            key = undefined
          }
          if (closed || mine !== seq) return
          const fresh = now() - lastFullAt < source.probe.maxAgeMs
          if (!forced && fresh && key !== undefined && lastKey !== undefined && Object.is(key, lastKey)) return
        }
        const late = new Promise<'late'>((resolve) => {
          timer = setTimeout(() => resolve('late'), deadline)
        })
        const next = await Promise.race([source.read(entry.last), late])
        if (next === 'late' || closed || mine !== seq) return
        lastFullAt = now()
        lastKey = key
        if (next === undefined) {
          lastKey = undefined // nothing was read: the next turn reads again whatever the probe says
          return
        }
        const held = source.merge ? source.merge(entry.last, next) : next
        if (held === entry.last) return
        entry.last = held
        for (const l of entry.listeners) l(held)
      } catch {
        /* the next tick tries again */
      } finally {
        clearTimeout(timer)
        if (mine === seq) {
          running = false
          if (again && !closed) {
            const f = againForced
            again = false
            againForced = false
            void load(f)
          }
        }
      }
    }
    const stopPoll = pollWhileVisible(() => void load(false), ms, doc)
    const offSignals = source.signals?.(() => void load(true))
    entry.stop = () => {
      closed = true
      stopPoll()
      offSignals?.()
    }
    return entry
  }

  return {
    subscribe(key: string, source: SharedPollSource<V>, listener: (v: V) => void): () => void {
      let entry = entries.get(key)
      if (!entry) {
        entry = open(source)
        entries.set(key, entry)
      }
      entry.listeners.add(listener)
      if (entry.last !== undefined) listener(entry.last)
      const e = entry
      return () => {
        e.listeners.delete(listener)
        if (e.listeners.size === 0) {
          e.stop()
          entries.delete(key)
        }
      }
    },
    /** Read now, for a change the poll cannot see (the project list was edited). No-op when nobody is subscribed. */
    reload(key: string): void {
      entries.get(key)?.reload()
    },
    /** How many polls are open. */
    size: (): number => entries.size
  }
}
