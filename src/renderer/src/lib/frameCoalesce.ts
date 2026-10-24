// One apply per animation frame, so a burst of Host pushes causes one render.
//   const push = coalescePerFrame<Snapshot>((latest) => setSnap(latest))   // once, e.g. in a useEffect
//   const off = window.api.on('orch:state', push)                          // many pushes in a frame -> one setSnap
//   return () => { off(); push.cancel() }                                  // drop the pending apply on unmount
// A keyed map of partial updates merges instead of keeping only the last:
//   coalescePerFrame<Record<string, Row>>(apply, { merge: (acc, next) => ({ ...acc, ...next }) })
// For snapshot-type pushes only (the newest value replaces the older ones). Never for terminal data or other event
// streams, where every push matters and dropping or reordering one loses output.

export interface FrameCoalescer<T> {
  push(value: T): void
  /** Drops the pending apply, if any. */
  cancel(): void
}

export interface FrameCoalesceOptions<T> {
  /** Folds the next pushed value into the one already waiting for the frame; without it the last value wins. */
  merge?: (acc: T, next: T) => T
  /** Runs `run` once later and returns the cancel; a test's frame. Defaults to requestAnimationFrame, else setTimeout(0). */
  schedule?: (run: () => void) => () => void
}

const defaultSchedule = (run: () => void): (() => void) => {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(run)
    return () => cancelAnimationFrame(id)
  }
  const id = setTimeout(run, 0)
  return () => clearTimeout(id)
}

export function coalescePerFrame<T>(apply: (latest: T) => void, opts: FrameCoalesceOptions<T> = {}): FrameCoalescer<T> {
  const schedule = opts.schedule ?? defaultSchedule
  let waiting: { value: T } | null = null
  let cancelFrame: (() => void) | null = null
  const run = (): void => {
    const { value } = waiting!
    waiting = null
    cancelFrame = null
    apply(value)
  }
  return {
    push(value) {
      waiting = waiting && opts.merge ? { value: opts.merge(waiting.value, value) } : { value }
      cancelFrame ??= schedule(run)
    },
    cancel() {
      cancelFrame?.()
      waiting = null
      cancelFrame = null
    }
  }
}
