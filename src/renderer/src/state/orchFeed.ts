// The per-project data useLiveData shows at once on a view or project switch: the orchestration snapshot, the Run
// panel's run.list and History's understanding. Each is kept per project (keys `orch:<project>`, `run:<project>`,
// `understanding:<project>`), shown from there the moment its project is current again, and read again in the
// background. Snapshot pushes are applied at most once per animation frame, through acceptSnapshot.
import { useEffect, useSyncExternalStore } from 'react'
import { createReadCache } from '../lib/readCache'
import { coalescePerFrame, type FrameCoalesceOptions } from '../lib/frameCoalesce'
import { acceptSnapshot } from '../../../core/orchestration/snapshot'
import type { OrchSnapshot } from '../../../core/types'

export type LiveCache = Pick<ReturnType<typeof createReadCache>, 'get' | 'set'>

/** This window's per-project reads. Its own instance: nothing else reads these keys, and it needs no push channels. */
export const liveCache: LiveCache = createReadCache()

/** What the orchestration views draw for `project` before anything has been read: no project has nothing to ask
 *  about and no answer is coming, so an empty snapshot (the empty state); a project not read yet is null ("not known
 *  yet", which the views draw nothing for); a project read before is its last snapshot. */
export function orchSnapshotFor(cache: LiveCache, project: string | null): OrchSnapshot | null {
  if (project === null) return { runs: [], projectFolderBusy: false }
  return cache.get<OrchSnapshot>(`orch:${project}`).data ?? null
}

export interface OrchFeedDeps {
  project: string
  cache: LiveCache
  /** orch.list: the first state, and what arms main's watch of `project`. */
  list: (project: string) => Promise<OrchSnapshot>
  /** Subscribes to 'orch:state'; returns the unsubscribe. */
  onState: (cb: (snapshot: OrchSnapshot) => void) => () => void
  unwatch: () => void
  /** The one setState; called only when the held snapshot changes. */
  show: (snapshot: OrchSnapshot) => void
  schedule?: FrameCoalesceOptions<OrchSnapshot>['schedule']
}

/** Arms the watch of `project` and feeds its snapshot to `show` until the returned stop. The list answer and the
 *  pushes go through one frame coalescer, then acceptSnapshot against what `project` holds: another project's push
 *  (a second window's, or one from before a switch) and a same-version one change nothing. */
export function startOrchFeed(d: OrchFeedDeps): () => void {
  const key = `orch:${d.project}`
  const feed = coalescePerFrame<OrchSnapshot>(
    (next) => {
      const held = d.cache.get<OrchSnapshot>(key).data ?? null
      const accepted = acceptSnapshot(held, next, d.project)
      if (accepted === null || accepted === held) return
      d.cache.set(key, accepted)
      // The cache keeps the object it had when the new one serializes the same.
      const kept = d.cache.get<OrchSnapshot>(key).data!
      if (kept !== held) d.show(kept)
    },
    { schedule: d.schedule }
  )
  let stopped = false
  // A failed list leaves the snapshot held; the next arm asks again.
  d.list(d.project).then((s) => !stopped && feed.push(s), () => {})
  const off = d.onState(feed.push)
  return () => {
    stopped = true
    off()
    feed.cancel()
    d.unwatch()
  }
}

/** Shows what `key` held (a value read before, or null after a failed read) at once, then reads it again: the answer,
 *  or null on failure, is stored under `key` and shown with `fresh` set. A failure clears only this key, so another
 *  project's entry never stands in for this one. Returns the cancel; an answer after it is still stored. */
export function readThrough<T>(cache: LiveCache, key: string, read: () => Promise<T>, show: (value: T | null, fresh: boolean) => void): () => void {
  const held = cache.get<T | null>(key).data
  if (held !== undefined) show(held, false)
  let alive = true
  const settle = (value: T | null): void => {
    cache.set(key, value)
    if (alive) show(cache.get<T | null>(key).data ?? null, true)
  }
  read().then(settle, () => settle(null))
  return () => {
    alive = false
  }
}

// The orchestration views outside the sidebar (the Main plan tab) count themselves here while mounted; the watch stays
// armed while any is. A view kept in a hidden <Activity> runs its effect cleanups, so it stops counting while hidden.
let consumers = 0
const consumerListeners = new Set<() => void>()
const changeConsumers = (by: number): void => {
  consumers += by
  consumerListeners.forEach((l) => l())
}
const subscribeConsumers = (l: () => void): (() => void) => {
  consumerListeners.add(l)
  return () => consumerListeners.delete(l)
}
const anyConsumer = (): boolean => consumers > 0

/** Marks the calling component as one that draws the orchestration snapshot. */
export function useOrchConsumer(): void {
  useEffect(() => {
    changeConsumers(1)
    return () => changeConsumers(-1)
  }, [])
}

/** Whether any component counted by useOrchConsumer is mounted. */
export function useOrchConsumed(): boolean {
  return useSyncExternalStore(subscribeConsumers, anyConsumer, anyConsumer)
}
