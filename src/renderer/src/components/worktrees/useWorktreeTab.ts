// T6: what the worktree tab knows about its one worktree. It reads the registry (no git facts) and finds its row by the
// tab's own path, then asks git about that folder alone: push state, uncommitted count, and its branch's pull request.
// The Source Control view reads the whole overview for its list; this tab never does.
import { useCallback, useEffect, useState } from 'react'
import type { BranchPushState, WorktreeListItem } from '../../../../core/types'
import type { PrInfo } from '../../../../core/github/types'
import { subscribeCreated } from '../../lib/worktreeBus'
import { worktreeByPath } from './worktreeView'

export interface WorktreeTabData {
  /** `undefined` while the registry is read, `null` when no worktree lives at the path any more. */
  item: WorktreeListItem | null | undefined
  push: BranchPushState | undefined
  /** Uncommitted changes; null: unknown. */
  dirty: number | null
  pr: PrInfo | undefined
  ghConnected: boolean
  refresh(): Promise<void>
}

export function useWorktreeTab(path: string): WorktreeTabData {
  const [item, setItem] = useState<WorktreeListItem | null | undefined>(undefined)
  const [push, setPush] = useState<BranchPushState | undefined>(undefined)
  const [dirty, setDirty] = useState<number | null>(null)
  const [pr, setPr] = useState<PrInfo | undefined>(undefined)
  // Optimistic, as in useWorktrees: the cached probe answers a moment later
  const [ghConnected, setGhConnected] = useState(true)
  const repo = item?.repoPath
  const branch = item?.branch

  const refresh = useCallback(async (): Promise<void> => {
    let found: WorktreeListItem | undefined
    try {
      found = worktreeByPath(await window.api.worktrees.list(), path)
    } catch (err) {
      console.error('worktrees.list failed:', err)
      return // the last answer stays: a failed read says nothing about the folder
    }
    setItem(found ?? null)
    if (!found || found.status !== 'ok') return
    const [state, draft] = await Promise.allSettled([
      window.api.worktrees.pushState(found.repoPath, [found.baseRef]),
      window.api.pr.draftFor({ worktreePath: found.path, branch: found.branch, base: found.baseRef })
    ])
    setPush(state.status === 'fulfilled' ? state.value[found.baseRef]?.[found.branch] : undefined)
    setDirty(draft.status === 'fulfilled' ? draft.value.dirtyCount : null)
  }, [path])

  useEffect(() => {
    void refresh()
    const off = subscribeCreated(() => void refresh())
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  // PR snapshots ride GitHub's push events; the subscription is counted in main and lets it stop polling at zero
  useEffect(() => {
    window.api.github.subscribe()
    void window.api.github.status().then((p) => setGhConnected(p.kind === 'connected'))
    const offStatus = window.api.on('github:status', (p) => setGhConnected(p.kind === 'connected'))
    return () => {
      offStatus()
      window.api.github.unsubscribe()
    }
  }, [])
  useEffect(() => {
    if (repo === undefined || branch === undefined) return setPr(undefined)
    let alive = true
    void window.api.github.prs().then((all) => alive && setPr(all[repo]?.byBranch[branch]))
    const off = window.api.on('github:prs-updated', (p) => {
      if (p.repoRoot === repo) setPr(p.snapshot.byBranch[branch])
    })
    return () => {
      alive = false
      off()
    }
  }, [repo, branch])

  return { item, push, dirty, pr, ghConnected, refresh }
}
