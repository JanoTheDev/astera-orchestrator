/** Notification toast store. Replaces window.alert — alert halts the renderer synchronously, which stops
 *  the stream rendering of other sessions too, so notifications go through non-blocking toasts. It is the
 *  same module-singleton pattern as sessionBus, so it can be called from App, AccountPanel,
 *  HistoryBrowser or anywhere else without props. Displaying them is ToastViewport's job (components/ui/Toast.tsx). */

export type ToastKind = 'info' | 'success' | 'error'
/** The single action button a toast can carry — no toast needs more than one. Since an action toast
 *  never auto-dismisses, onClick is expected to close its own toast (via the id `push` returns) so
 *  pressing it has visible effect; an outcome message, if any, arrives as a separate toast after. */
export type ToastAction = { label: string; onClick: () => void }
export type Toast = {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
  /** Called once when it is closed with ✕. Used for the update campaign's dismiss ack. */
  onDismiss?: () => void
}
export type ToastOptions = {
  action?: ToastAction
  onDismiss?: () => void
  /** W8-F (#94): an error that closes on its own after this long (it would otherwise stay until ✕). */
  ttlMs?: number
}

/** Auto-dismiss for info/success. An error must not be missed, so it does not auto-dismiss and closes only via ✕. */
const AUTO_DISMISS_MS = 4000
/** A cap so the screen is not covered — repeated failures (hammering a failing save, etc.) can keep piling errors up. */
const MAX_VISIBLE = 5

const listeners = new Set<(items: Toast[]) => void>()
let items: Toast[] = []
let seq = 0

/** Auto-dismiss timers by toast id. `remaining` is what is left to run once `startedAt` is subtracted; a paused
 *  timer has no handle. */
const timers = new Map<number, { handle: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number }>()
let paused = false

function arm(id: number, ms: number): void {
  timers.set(id, { handle: paused ? null : setTimeout(() => dismiss(id), ms), remaining: ms, startedAt: Date.now() })
}

/** Holds every auto-dismiss — the viewport calls it while the pointer or focus is on a toast, so a message being read
 *  (or an action about to be pressed) does not vanish under it. */
export function pauseTimers(): void {
  if (paused) return
  paused = true
  const now = Date.now()
  for (const t of timers.values()) {
    if (t.handle !== null) clearTimeout(t.handle)
    t.handle = null
    t.remaining -= now - t.startedAt
  }
}

/** Lets the held timers run again with the time each had left. */
export function resumeTimers(): void {
  if (!paused) return
  paused = false
  const now = Date.now()
  for (const [id, t] of timers) {
    t.startedAt = now
    t.handle = setTimeout(() => dismiss(id), Math.max(0, t.remaining))
  }
}

function emit(): void {
  for (const listener of listeners) listener(items)
}

export function subscribe(listener: (items: Toast[]) => void): () => void {
  listeners.add(listener)
  listener(items)
  return () => {
    listeners.delete(listener)
  }
}

export function dismiss(id: number): void {
  const timer = timers.get(id)
  if (timer?.handle) clearTimeout(timer.handle)
  timers.delete(id)
  const closing = items.find((t) => t.id === id)
  const next = items.filter((t) => t.id !== id)
  if (next.length === items.length) return
  items = next
  emit()
  closing?.onDismiss?.()
}

/** Returns the new toast's id. A toast with an action does not auto-dismiss (see below), so its
 *  onClick is expected to call `dismiss(id)` itself once pressed — otherwise the toast would sit
 *  there with no visible sign the button did anything. Callers that don't need that (plain info/
 *  error toasts) just ignore the return value, same as before. */
function push(kind: ToastKind, message: string, options?: ToastOptions): number {
  const id = ++seq
  items = [
    ...items,
    { id, kind, message, action: options?.action, onDismiss: options?.onDismiss }
  ].slice(-MAX_VISIBLE)
  emit()
  // A toast with an action is never auto-dismissed — vanishing after 4 seconds leaves no chance to press the button.
  // Instead it is expected to close the moment the action fires, via the id returned below.
  if (options?.ttlMs !== undefined) arm(id, options.ttlMs)
  else if (kind !== 'error' && !options?.action) arm(id, AUTO_DISMISS_MS)
  return id
}

export const toast = {
  info: (message: string, options?: ToastOptions): number => push('info', message, options),
  success: (message: string, options?: ToastOptions): number => push('success', message, options),
  error: (message: string, options?: ToastOptions): number => push('error', message, options)
}
