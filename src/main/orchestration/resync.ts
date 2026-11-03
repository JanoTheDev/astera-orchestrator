// Keeping the window current after the Host comes back (the owner's "the window needs to update automatically").
//
// Two pieces, out of ipc.ts so they can be tested (ipc.ts imports electron):
// - `createRefill`: the mirror's refill after a handshake. It used to be one `state-get` whose failure was only logged,
//   and after a restart or handover the Host is at its slowest (its command chain held 30-90 s on 2026-11-03): one
//   timeout left main's mirror, and with it every list the window reads, on the state from before the restart until
//   the next commit happened to push. Now a failed refill is tried again with backoff, and a newer handshake's refill
//   takes over from an older one.
// - `createMovedSignal`: tells the window the mirror moved ('orch:moved'), at most once per gap, always with the newest
//   generation. The window's lists are polled; this is what makes a change made elsewhere (a Gate answered from the
//   CLI) show at once instead of at the next poll, and a poll that missed it is caught by the generation check.

export interface RefillDeps<T> {
  /** One `state-get`. Rejects (or throws) when the Host gave no usable answer. */
  fetch(): Promise<T>
  /** Puts the answer into the mirror. */
  apply(answer: T): void
  log(line: string): void
  /** The waits between tries; the refill gives up after the last one (the next handshake or push corrects it). */
  delaysMs?: readonly number[]
  sleep?(ms: number): Promise<void>
}

export const REFILL_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000]

const realSleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    const t = setTimeout(r, ms)
    t.unref?.()
  })

/** `run()` starts a refill and resolves once it landed (true), was taken over by a newer run, or gave up (false). */
export function createRefill<T>(d: RefillDeps<T>): { run(): Promise<boolean> } {
  const delays = d.delaysMs ?? REFILL_DELAYS_MS
  const sleep = d.sleep ?? realSleep
  let current = 0
  return {
    async run(): Promise<boolean> {
      const mine = ++current
      for (let attempt = 0; ; attempt++) {
        if (mine !== current) return false
        try {
          const answer = await d.fetch()
          if (mine !== current) return false // a newer handshake's refill has the newer answer
          d.apply(answer)
          if (attempt > 0) d.log(`refilled the orchestration mirror after ${attempt + 1} tries`)
          return true
        } catch (e) {
          if (attempt >= delays.length) {
            d.log(`could not refill the orchestration mirror after reconnecting (${attempt + 1} tries): ${String(e)} — the next push or handshake corrects it`)
            return false
          }
          d.log(`could not refill the orchestration mirror after reconnecting: ${String(e)} — trying again in ${Math.round(delays[attempt]! / 1000)} s`)
          await sleep(delays[attempt]!)
        }
      }
    }
  }
}

export interface MovedSignalDeps {
  send(generation: number): void
  /** The least time between two sends. */
  gapMs?: number
  now?(): number
  after?(ms: number, fn: () => void): void
}

/** Two seconds: a change made elsewhere shows within about that, and a busy Host's stream of commits (each a whole
 *  state) costs the window at most one read of its lists per gap rather than one per commit. */
export const MOVED_GAP_MS = 2_000

/** `moved(g)`: the mirror is at generation `g`. Sent at once when the last send is a gap ago, else once the gap has
 *  passed, with whatever generation is newest by then: a burst of pushes is one message. */
export function createMovedSignal(d: MovedSignalDeps): { moved(generation: number): void } {
  const gap = d.gapMs ?? MOVED_GAP_MS
  const now = d.now ?? Date.now
  const after =
    d.after ??
    ((ms: number, fn: () => void): void => {
      const t = setTimeout(fn, ms)
      t.unref?.()
    })
  let lastAt = -Infinity
  let pending: number | null = null
  let waiting = false
  const flush = (): void => {
    waiting = false
    if (pending === null) return
    const g = pending
    pending = null
    lastAt = now()
    try {
      d.send(g)
    } catch {
      /* a window that is gone */
    }
  }
  return {
    moved(generation) {
      pending = generation
      if (waiting) return
      const since = now() - lastAt
      if (since >= gap) return flush()
      waiting = true
      after(Math.max(0, gap - since), flush)
    }
  }
}
