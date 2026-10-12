import { isSubPath } from './ops'
import { parentDir } from './paths'

/** Per-folder single flight for the explorer's directory reads.
 *
 *  A watcher batch, a toggle and a refresh can all ask for the same folder while a read of it is
 *  still out — on a shared drive a readdir can take seconds. Running them side by side wastes the
 *  drive and lets an older answer land after a newer one. So: at most one read per folder at a time,
 *  and a request that arrives during a read turns into exactly one more read after it (however many
 *  arrived), because the running read may already have passed the change that triggered them.
 *
 *  **At most DIR_READ_CONCURRENCY folders are read at once**, the rest wait in arrival order. A refresh
 *  re-reads every open folder, and on a share that stopped answering each readdir holds a libuv thread
 *  until it times out: with no cap they took the whole pool (4 by default) and every other fs call in
 *  main waited behind them, a file tab's save and the session path probes included. Half the pool stays
 *  free, the rule pathProbe.ts keeps for the same reason. A follow-up read goes to the back of the line,
 *  so one folder that keeps changing (npm install writing into it) cannot hold a slot forever.
 *
 *  `onChange` reports the set of folders being read or waiting — the explorer's loading indicator. A
 *  folder stays in it across the follow-up read, so the spinner does not blink off and on between the
 *  two. */
export interface DirLoadQueue {
  request: (dir: string) => void
  isPending: (dir: string) => boolean
}

/** How many folders the explorer reads at once: half of libuv's default pool of 4 (see createDirLoadQueue). */
export const DIR_READ_CONCURRENCY = 2

export function createDirLoadQueue(
  load: (dir: string) => Promise<void>,
  onChange?: (pending: ReadonlySet<string>) => void,
  max: number = DIR_READ_CONCURRENCY
): DirLoadQueue {
  /** Being read now, or waiting for a slot. */
  const pending = new Set<string>()
  const running = new Set<string>()
  const waiting: string[] = []
  const again = new Set<string>()
  const notify = (): void => onChange?.(new Set(pending))

  const drain = (): void => {
    while (running.size < max && waiting.length > 0) start(waiting.shift()!)
  }

  const start = (dir: string): void => {
    running.add(dir)
    let p: Promise<void>
    try {
      p = load(dir)
    } catch (e) {
      p = Promise.reject(e)
    }
    // Both outcomes end the same way; a failed read is the loader's to report (it caches the error
    // for the tree), so the rejection is consumed here and never goes unhandled.
    const done = (): void => {
      running.delete(dir)
      if (again.delete(dir)) waiting.push(dir)
      else {
        pending.delete(dir)
        notify()
      }
      drain()
    }
    p.then(done, done)
  }

  return {
    request: (dir) => {
      if (running.has(dir)) {
        again.add(dir)
        return
      }
      // Already in line: the read it is waiting for has not started, so it covers this request too
      if (pending.has(dir)) return
      pending.add(dir)
      waiting.push(dir)
      notify()
      drain()
    },
    isPending: (dir) => pending.has(dir)
  }
}

/** How long a folder must have been reading before its row shows the spinner. An expanded folder that
 *  npm install keeps writing into is re-read on every 100ms batch; each read is short, and showing the
 *  spinner for each one would make the row blink. A read that lasts past this is one worth showing. */
export const ROW_SPINNER_DELAY_MS = 150

export interface DelayedPending {
  /** The current set of folders being read (DirLoadQueue's onChange) */
  update: (pending: ReadonlySet<string>) => void
  /** Drops every timer and the shown set without reporting (unmount); the object stays usable */
  clear: () => void
}

/** Turns the queue's pending set into the set to show: a folder enters it only after it has stayed
 *  pending for delayMs, and leaves it the moment its read ends. */
export function createDelayedPending(
  onChange: (shown: ReadonlySet<string>) => void,
  delayMs: number = ROW_SPINNER_DELAY_MS
): DelayedPending {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const shown = new Set<string>()
  const report = (): void => onChange(new Set(shown))
  return {
    update: (pending) => {
      let changed = false
      for (const [dir, timer] of timers) {
        if (pending.has(dir)) continue
        clearTimeout(timer)
        timers.delete(dir)
      }
      for (const dir of [...shown]) {
        if (pending.has(dir)) continue
        shown.delete(dir)
        changed = true
      }
      for (const dir of pending) {
        if (shown.has(dir) || timers.has(dir)) continue
        timers.set(
          dir,
          setTimeout(() => {
            timers.delete(dir)
            shown.add(dir)
            report()
          }, delayMs)
        )
      }
      if (changed) report()
    },
    clear: () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      shown.clear()
    }
  }
}

/** Which folders one watcher batch re-reads. Only folders already in the cache matter (an uncached
 *  one is read fresh when it is first expanded). Of those, the root and the expanded folders are on
 *  screen and are re-read; a collapsed folder is not re-read now — its cache is dropped instead, so
 *  expanding it later reads it fresh rather than showing a listing from before the change. Each
 *  folder appears once however often the batch names it. */
export function planBatchReload(
  parents: readonly string[],
  o: { root: string; isCached: (dir: string) => boolean; isExpanded: (dir: string) => boolean }
): { reload: string[]; evict: string[] } {
  const reload: string[] = []
  const evict: string[] = []
  for (const dir of new Set(parents)) {
    if (!o.isCached(dir)) continue
    if (dir === o.root || o.isExpanded(dir)) reload.push(dir)
    else evict.push(dir)
  }
  return { reload, evict }
}

/** What a refresh re-reads (the explorer's refresh button). The folders the person opened stay open:
 *  the root and every expanded folder under it are read again, an expanded one inside a collapsed parent
 *  included, so opening the parent later shows the disk as it is now. A cached folder that is not read
 *  again (collapsed, or outside the root after a root switch) is dropped, so opening it later reads it
 *  fresh, the rule a watcher batch follows (planBatchReload).
 *
 *  The order is the order the reads wait in (createDirLoadQueue's cap): the root, then the folders on
 *  screen (every folder between them and the root open too), then the ones hidden under a collapsed
 *  parent. A parent comes before its children. A key that names the root in another spelling (a trailing
 *  separator, another case where the platform folds it) is the root, not a second read of it. */
export function planRefresh(o: {
  root: string
  cached: Iterable<string>
  expanded: Iterable<string>
}): { reload: string[]; evict: string[] } {
  const open = new Set(o.expanded)
  const under = [...open].filter((d) => isSubPath(o.root, d) && !isSubPath(d, o.root)).sort()
  const onScreen = (d: string): boolean => {
    for (let p = parentDir(d); !isSubPath(p, o.root); p = parentDir(p)) {
      if (!open.has(p)) return false
      // parentDir of a drive or filesystem root is itself; never loop on it
      if (parentDir(p) === p) return false
    }
    return true
  }
  const reload = [o.root, ...under.filter(onScreen), ...under.filter((d) => !onScreen(d))]
  const keep = new Set(reload)
  const evict = [...new Set(o.cached)].filter((d) => !keep.has(d))
  return { reload, evict }
}
