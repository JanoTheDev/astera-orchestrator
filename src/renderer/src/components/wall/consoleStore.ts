// The consoles the app knows, published by AgentsPage (which holds the Host data for the window's life) so the
// Agents view and the console tabs' headers read one list instead of each polling the Host again.
import { useSyncExternalStore } from 'react'
import type { SessionSummary } from '../../../../core/sessions/summary'
import type { WallConsole } from './wallModel'

export interface ConsoleSnapshot {
  consoles: readonly WallConsole[]
  /** The summary of each ended console, by session id (the Finished pane's rows). */
  summaries: ReadonlyMap<string, SessionSummary>
}

let snapshot: ConsoleSnapshot = { consoles: [], summaries: new Map() }
const listeners = new Set<() => void>()

export function setConsoleSnapshot(next: ConsoleSnapshot): void {
  snapshot = next
  for (const l of [...listeners]) l()
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
const get = (): ConsoleSnapshot => snapshot

export const useConsoleSnapshot = (): ConsoleSnapshot => useSyncExternalStore(subscribe, get, get)
