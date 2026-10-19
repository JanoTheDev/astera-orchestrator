// W9-J: which worktree the Worktrees page shows. `openWorktree(path)` (shell/navigation.ts) lands here; the page reads
// it. A module store, because the page is mounted from the shell and the caller can be anywhere (a console's details
// panel, a Task card).
import { useSyncExternalStore } from 'react'

export interface WorktreeViewState {
  /** The page is showing. */
  open: boolean
  /** The folder of the worktree whose detail is open. */
  selected: string | null
}

let state: WorktreeViewState = { open: false, selected: null }
const listeners = new Set<() => void>()
const set = (next: WorktreeViewState): void => {
  state = next
  listeners.forEach((l) => l())
}

/** Shows the page; with a path, on that worktree. Without one the last choice stays. */
export const showWorktrees = (path?: string): void => set({ open: true, selected: path ?? state.selected })
export const selectWorktree = (path: string | null): void => set({ ...state, selected: path })
export const closeWorktrees = (): void => set({ ...state, open: false })
export const worktreeViewState = (): WorktreeViewState => state

export function useWorktreeView(): WorktreeViewState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}
