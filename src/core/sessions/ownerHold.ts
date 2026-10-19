/**
 * **The owner hold** (W9-H, DESIGN §2). A console the owner is looking at full size in the app, or has typed into in
 * the last minute, is *held*: an agent's `sessions send` into it is queued in the Host instead of typed, so a
 * coordinator's message never lands in the middle of the owner's line. The queue delivers in order on release —
 * "Back to all" in the app (viewing off), or a minute after the last keystroke while not viewing.
 *
 * Pure: the clock, the timers, what was typed when and whether an app is attached are all handed in, so the Host
 * wires it (host/orch.ts) and the tests drive it with a fake clock.
 */

/** How long a keystroke holds its console. A constant, not a setting (DESIGN §14.6). */
export const OWNER_HOLD_MS = 60_000

export interface OwnerHold {
  /** The app says the owner opened (`true`) or left (`false`) this console full size. */
  setViewing(sessionId: string, viewing: boolean): void
  /** Whether an agent's send into this console must wait, at `now` (epoch ms). */
  isHeld(sessionId: string, now: number): boolean
  /** When a held console is released by the clock alone: the last keystroke plus OWNER_HOLD_MS. null when it is not
   *  held, or held by viewing, which only the app's `viewing: false` (or the app going away) ends. */
  releaseAt(sessionId: string, now: number): number | null
}

export function createOwnerHold(deps: {
  /** When the owner last typed into this console in a window (epoch ms), or null for never. */
  typedAt(sessionId: string): number | null
  /** Whether the app is attached. Viewing counts only while it is, so an app that quit with a console open full
   *  size never holds it forever. Absent: always. */
  viewerPresent?(): boolean
}): OwnerHold {
  const viewing = new Set<string>()
  const viewed = (id: string): boolean => viewing.has(id) && (deps.viewerPresent?.() ?? true)
  const typedUntil = (id: string, now: number): number | null => {
    const at = deps.typedAt(id)
    return at !== null && now - at < OWNER_HOLD_MS ? at + OWNER_HOLD_MS : null
  }
  return {
    setViewing: (id, on) => void (on ? viewing.add(id) : viewing.delete(id)),
    isHeld: (id, now) => viewed(id) || typedUntil(id, now) !== null,
    releaseAt: (id, now) => (viewed(id) ? null : typedUntil(id, now))
  }
}

export interface HeldQueue<T> {
  /** Queues `item` for `target` behind what is already queued, and re-checks the hold (`poke`). */
  enqueue(target: string, item: T): void
  /** Re-checks `target`: released, everything queued for it is delivered in order, one after another; still held, a
   *  timer re-checks it at its release time — or a minute from now when held by viewing, so a vanished app is seen. */
  poke(target: string): Promise<void>
  /** How many items wait for `target` (not counting one being delivered). */
  pending(target: string): number
}

export function createHeldQueue<T>(o: {
  hold: OwnerHold
  deliver(item: T): Promise<void>
  now(): number
  setTimer(run: () => void, ms: number): unknown
  clearTimer(timer: unknown): void
  /** A delivery that threw; the next one still runs. */
  onError?(target: string, err: unknown): void
}): HeldQueue<T> {
  const queues = new Map<string, { items: T[]; timer: unknown; draining: boolean }>()

  const poke = async (target: string): Promise<void> => {
    const q = queues.get(target)
    // A drain under way re-checks the hold before every item, and picks up what was queued meanwhile.
    if (!q || q.draining) return
    if (q.timer !== null) o.clearTimer(q.timer)
    q.timer = null
    const now = o.now()
    if (o.hold.isHeld(target, now)) {
      const at = o.hold.releaseAt(target, now) ?? now + OWNER_HOLD_MS
      q.timer = o.setTimer(() => {
        q.timer = null
        void poke(target)
      }, Math.max(0, at - now))
      return
    }
    q.draining = true
    try {
      // The owner can come back mid-drain (typing again): the rest waits for the next release.
      while (q.items.length > 0 && !o.hold.isHeld(target, o.now())) {
        const item = q.items.shift()!
        try {
          await o.deliver(item)
        } catch (err) {
          o.onError?.(target, err)
        }
      }
    } finally {
      q.draining = false
    }
    if (q.items.length === 0) queues.delete(target)
    else await poke(target)
  }

  return {
    enqueue: (target, item) => {
      const q = queues.get(target) ?? { items: [], timer: null, draining: false }
      queues.set(target, q)
      q.items.push(item)
      void poke(target)
    },
    poke,
    pending: (target) => queues.get(target)?.items.length ?? 0
  }
}
