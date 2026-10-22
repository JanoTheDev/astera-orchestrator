// The session the top bar speaks for (useWorkbench's `active`), for components drawn where App's state
// is not passed down — the accounts popover's "Use for this tab" (AccountPanel).
import { useSyncExternalStore } from 'react'
import type { SessionInfo } from '../../../core/types'

let current: SessionInfo | null = null
const listeners = new Set<() => void>()

export function setActiveSession(s: SessionInfo | null): void {
  if (s === current) return
  current = s
  for (const l of listeners) l()
}

export function useActiveSession(): SessionInfo | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}
