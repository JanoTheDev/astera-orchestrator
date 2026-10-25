// T19: what the bell remembers (the items marked read, "All projects"), in one store so the bell and the status bar count
// the same cards. Read state is set only by "Mark all read" and by opening an item from the bell.
// T12: the bell follows the title bar's scope (scopedData); `allProjects` deliberately widens it to every project's
// cards without changing the window's project, so it stays the bell's own.
import { useSyncExternalStore } from 'react'
import { loadRead, saveRead } from './bellView'

export interface BellState {
  read: ReadonlySet<string>
  allProjects: boolean
}

let state: BellState | null = null
const listeners = new Set<() => void>()

export const getBellState = (): BellState => (state ??= { read: loadRead(), allProjects: false })

function set(next: BellState): void {
  state = next
  listeners.forEach((l) => l())
}

/** Replace the read set ("Mark all read"). */
export function setRead(keys: readonly string[]): void {
  saveRead(keys)
  set({ ...getBellState(), read: new Set(keys) })
}

/** Opening one item marks that item read. */
export function markRead(key: string): void {
  const cur = getBellState().read
  if (cur.has(key)) return
  setRead([...cur, key])
}

/** "Mark unread": the item counts again. */
export function markUnread(key: string): void {
  const cur = getBellState().read
  if (cur.has(key)) setRead([...cur].filter((k) => k !== key))
}

export const toggleAllProjects = (): void => set({ ...getBellState(), allProjects: !getBellState().allProjects })

/** Test seam: forget the cached state. */
export const resetBellStore = (): void => {
  state = null
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useBellState = (): BellState => useSyncExternalStore(subscribe, getBellState, getBellState)
