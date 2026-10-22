// "Show onboarding again" (Settings > General). A tiny store rather than App state, like wall/wallView.ts: the
// Settings row sets it and App/Overlays read it, without threading a setter through the settings props.
import { useSyncExternalStore } from 'react'

let replaying = false
const listeners = new Set<() => void>()

export function setOnboardingReplay(on: boolean): void {
  if (replaying === on) return
  replaying = on
  for (const l of [...listeners]) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useOnboardingReplay(): boolean {
  return useSyncExternalStore(subscribe, () => replaying)
}
