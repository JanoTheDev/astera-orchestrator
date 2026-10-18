// W9-H: what the Agents page shows — the wall, one console full size, or nothing (another page has the window).
// A tiny store rather than App state: navigation.ts's handlers (state/useNavigation.ts) set it, AgentsPage reads it,
// and neither has to thread a setter through App. The app opens on the wall (DESIGN §1: Agents is the default page).
import { useSyncExternalStore } from 'react'

export type WallView = { kind: 'wall' } | { kind: 'console'; sessionId: string } | { kind: 'away' }

let view: WallView = { kind: 'wall' }
const listeners = new Set<() => void>()

export function getWallView(): WallView {
  return view
}

export function setWallView(next: WallView): void {
  if (next.kind === view.kind && (next.kind !== 'console' || (view.kind === 'console' && view.sessionId === next.sessionId))) return
  view = next
  for (const l of [...listeners]) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function useWallView(): WallView {
  return useSyncExternalStore(subscribe, getWallView)
}
