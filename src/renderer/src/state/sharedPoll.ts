// One poll per key, shared by every subscriber (the workspace tree, a door's summaries). The first subscriber opens a
// visibility-aware timer with one read in flight; later ones join it and get the value already held; the last one to
// leave stops it. A read's result goes through `merge` so an unchanged answer keeps its identity and tells nobody.
import { pollWhileVisible } from '../lib/visiblePoll'

export interface SharedPollSource<V> {
  /** The answer, or undefined to keep what is held (a failed read, no Host yet). */
  read(): Promise<V | undefined>
  /** The value to hold given the last one: `prev` itself when nothing changed. Default: the new answer as it is. */
  merge?(prev: V | undefined, next: V): V
  /** Extra reasons to read now (a push); called once when the poll opens, returns its off. */
  signals?(reload: () => void): () => void
}

interface Entry<V> {
  listeners: Set<(v: V) => void>
  last: V | undefined
  reload: () => void
  stop: () => void
}

export function createSharedPoll<V>(ms: number, doc?: EventTarget & { hidden: boolean }) {
  const entries = new Map<string, Entry<V>>()

  const open = (source: SharedPollSource<V>): Entry<V> => {
    let running = false // a slow Host must not stack reads up behind each other
    let again = false // a load asked while a read ran: one follow-up read covers all of them
    let closed = false
    const entry: Entry<V> = { listeners: new Set(), last: undefined, reload: () => void load(), stop: () => {} }
    const load = async (): Promise<void> => {
      if (closed) return
      if (running) {
        again = true
        return
      }
      running = true
      try {
        const next = await source.read()
        if (next === undefined || closed) return
        const held = source.merge ? source.merge(entry.last, next) : next
        if (held === entry.last) return
        entry.last = held
        for (const l of entry.listeners) l(held)
      } catch {
        /* the next tick tries again */
      } finally {
        running = false
        if (again && !closed) {
          again = false
          void load()
        }
      }
    }
    const stopPoll = pollWhileVisible(() => void load(), ms, doc)
    const offSignals = source.signals?.(() => void load())
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
