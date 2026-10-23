// T30: whether the help panel is open. A tiny store rather than App state (like onboarding/replay.ts): F1 in the global
// key handler, the top bar's More menu and the command box set it, and Overlays reads it, with no setter threaded through.
import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()

export function setHelpOpen(next: boolean | ((was: boolean) => boolean)): void {
  const value = typeof next === 'function' ? next(open) : next
  if (value === open) return
  open = value
  for (const l of [...listeners]) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useHelpOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}
