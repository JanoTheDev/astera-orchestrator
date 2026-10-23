// One worktree's changes against its base and its commits (worktrees.detail), read again whenever the list read the
// folder anew (a commit or an edit moved it). Shared by the Source Control view's Changes pane and the worktree tab.
import { useEffect, useState } from 'react'
import type { WorktreeDetail, WorktreeRow } from '../../../../core/worktrees/cleanup'

/** `undefined` while it is read, `null` when git could not answer (or the folder is not `ok`). */
export function useWorktreeDetail(row: WorktreeRow | undefined): WorktreeDetail | null | undefined {
  const [detail, setDetail] = useState<WorktreeDetail | null | undefined>(undefined)
  const id = row?.item.id
  const status = row?.item.status
  useEffect(() => {
    let alive = true
    setDetail(undefined)
    if (id === undefined) return
    if (status !== 'ok') return setDetail(null)
    void window.api.worktrees.detail(id).then(
      (d) => alive && setDetail(d),
      () => alive && setDetail(null)
    )
    return () => {
      alive = false
    }
  }, [id, status, row?.ahead, row?.dirty, row?.unpushed])
  return detail
}
