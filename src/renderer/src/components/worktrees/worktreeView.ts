// W9-J: which worktree the Worktrees page shows. `openWorktree(path)` (shell/navigation.ts) lands here; the page reads
// it. A module store, because the page is mounted from the shell and the caller can be anywhere (a console's details
// panel, a Task card).
import { useSyncExternalStore } from 'react'
import { groupWorktrees, type WorktreeRow } from '../../../../core/worktrees/cleanup'
import type { WorktreeListItem, WorktreeStatus } from '../../../../core/types'

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

// W11 (DESIGN-W11 §9 "Worktrees"): what the list shows after the search and the "Reachable only" chip. Rows git could
// not vouch for go to the bottom, one group per status, so the warning is said once and not on every row.

export interface WorktreeFilterResult {
  /** Rows whose folder answered; grouped per plan / ready / yours as before. */
  reachable: WorktreeRow[]
  /** The rest, one group per status, in first-seen order. Empty when "Reachable only" is on. */
  trouble: { status: Exclude<WorktreeStatus, 'ok'>; rows: WorktreeRow[] }[]
}

const matches = (r: WorktreeRow, q: string): boolean =>
  [r.item.branch, r.item.name, r.item.path, r.owner?.plan ?? '', ...(r.owner?.taskTitles ?? [])].some((s) => s.toLowerCase().includes(q))

export function filterWorktrees(rows: readonly WorktreeRow[], query: string, reachableOnly: boolean): WorktreeFilterResult {
  const q = query.trim().toLowerCase()
  const out: WorktreeFilterResult = { reachable: [], trouble: [] }
  for (const r of rows) {
    if (q !== '' && !matches(r, q)) continue
    const status = r.item.status
    if (status === 'ok') out.reachable.push(r)
    else if (!reachableOnly) {
      let g = out.trouble.find((t) => t.status === status)
      if (!g) out.trouble.push((g = { status, rows: [] }))
      g.rows.push(r)
    }
  }
  return out
}

/** The row's state chip: a live session wins, then a merged owner. Null draws none (the group heading says the rest). */
export const rowState = (r: WorktreeRow): 'active' | 'merged' | null => (r.live ? 'active' : r.owner?.merged ? 'merged' : null)

/** One row of the Source Control tree; `trouble` is the status git could not vouch for, null for a reachable one. */
export interface WorktreeEntry {
  row: WorktreeRow
  trouble: Exclude<WorktreeStatus, 'ok'> | null
}

/** The Source Control tree's rows: the reachable ones first (plan by plan, then ready to clean up, then yours), the
 *  rows git could not vouch for last, grouped by status. */
export function worktreeEntries(f: WorktreeFilterResult): WorktreeEntry[] {
  const g = groupWorktrees(f.reachable)
  const reachable = [...g.plans.flatMap((p) => p.rows), ...g.ready, ...g.yours]
  return [
    ...reachable.map((row) => ({ row, trouble: null })),
    ...f.trouble.flatMap((t) => t.rows.map((row) => ({ row, trouble: t.status })))
  ]
}

// T6: the worktree editor tab shows the one worktree it was opened for. These find it by that tab's own path.

const normPath = (p: string): string => p.replace(/[\\/]+/g, '/').replace(/\/$/, '')

/** The registry item at `path` (separators and a trailing slash do not matter); undefined when it is gone. */
export const worktreeByPath = <T extends { path: string }>(items: readonly T[], path: string): T | undefined => {
  const want = normPath(path)
  return items.find((w) => normPath(w.path) === want)
}

/** The tab's title: the worktree's branch, else its folder name. */
export const worktreeTitle = (item: Pick<WorktreeListItem, 'branch' | 'path'> | undefined, path: string): string =>
  item?.branch || normPath(item?.path ?? path).split('/').filter(Boolean).pop() || path

/** The plan Run a folder belongs to: the row whose `worktrees` holds it. `planFolder` is the Run's own integration
 *  folder (the one no Task's branch is on), the only one a plan-level PR or push delivery acts on. */
export function planOwnerOfPath<R extends { id: string; worktrees?: string[]; tasks: readonly { branch?: string }[]; children?: R[] }>(
  rows: readonly R[],
  item: Pick<WorktreeListItem, 'branch' | 'path'>
): { row: R; planFolder: boolean } | undefined {
  for (const row of rows) {
    const hit = [row, ...(row.children ?? [])].find((r) => r.worktrees?.some((p) => normPath(p) === normPath(item.path)))
    if (hit) return { row: hit, planFolder: !hit.tasks.some((t) => t.branch === item.branch) }
  }
  return undefined
}
