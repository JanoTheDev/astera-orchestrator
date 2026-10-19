// W9-J: reads the git facts the ready rule (cleanup.ts) needs and removes what is ready. Node side: the Worktrees page
// asks it through IPC, and the Host asks it once a plan is delivered. Every removal is the plain, unforced
// `removeWorktree`, which refuses what is dirty or in use on its own: the rule is the first gate, that is the second.
import type { OrchState } from '../orchestration/state'
import type { BranchPushState, WorktreeListItem } from '../types'
import { groupWorktrees, isReadyToClean, worktreeOwners, type WorktreeRow } from './cleanup'
import { git, isCleanWorktree } from './git'
import { readPushState } from './push'
import { removeWorktree } from './remove'
import type { WorktreeStore } from './registry'

/** Commits of `branch` that no remote branch has, or null when git could not say. */
async function unpushedCount(path: string, branch: string): Promise<number | null> {
  const r = await git(['rev-list', '--count', branch, '--not', '--remotes'], { cwd: path })
  const n = r.ok ? Number(r.stdout.trim()) : NaN
  return Number.isInteger(n) ? n : null
}

/** The rows of the Worktrees page. A folder git cannot read (`status` other than `ok`) has every fact null. */
export async function worktreeRows(
  items: readonly WorktreeListItem[],
  state: OrchState,
  isPathInUse: (p: string) => string | null
): Promise<WorktreeRow[]> {
  const owners = worktreeOwners(state)
  const pushByRepo = new Map<string, Record<string, Record<string, BranchPushState>>>()
  for (const repo of new Set(items.map((w) => w.repoPath)))
    pushByRepo.set(repo, await readPushState(repo, [...new Set(items.filter((w) => w.repoPath === repo).map((w) => w.baseRef))]).catch(() => ({})))
  return Promise.all(
    items.map(async (item): Promise<WorktreeRow> => {
      const owner = owners.get(item.path.replace(/\\/g, '/').replace(/\/+$/, ''))
      const push = pushByRepo.get(item.repoPath)?.[item.baseRef]?.[item.branch]
      const readable = item.status === 'ok'
      const dirty = readable ? await isCleanWorktree(item.path).then((r) => r.changedCount, () => null) : null
      const unpushed = readable ? await unpushedCount(item.path, item.branch) : null
      const live = isPathInUse(item.path) !== null
      return {
        item,
        owner,
        ahead: push?.ahead ?? null,
        behind: push?.behind ?? null,
        dirty,
        unpushed,
        live,
        ready: isReadyToClean({ owner, live, dirty, unpushed })
      }
    })
  )
}

export interface CleanResult {
  removed: string[]
  /** Folders the rule had as ready that the removal then refused (they changed in between), with git's reason. */
  kept: { path: string; reason: string }[]
}

/** Removes the given rows, which must be ready, one at a time (they share repositories and their ref locks). */
export async function cleanRows(
  rows: readonly WorktreeRow[],
  deps: { registry: WorktreeStore; isPathInUse: (p: string) => string | null; log?: (m: string) => void }
): Promise<CleanResult> {
  const out: CleanResult = { removed: [], kept: [] }
  for (const r of rows) {
    if (!r.ready) continue
    try {
      await removeWorktree({ id: r.item.id, registry: deps.registry, isPathInUse: deps.isPathInUse })
      out.removed.push(r.item.path)
    } catch (e) {
      out.kept.push({ path: r.item.path, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  deps.log?.(`worktree clean-up: removed ${out.removed.length}, kept ${out.kept.length}`)
  return out
}

/** A delivered plan's ready worktrees (and only that plan's) are removed. Never throws. */
export async function cleanRun(
  runId: string,
  deps: {
    registry: WorktreeStore
    list: () => Promise<WorktreeListItem[]>
    state: () => OrchState
    isPathInUse: (p: string) => string | null
    log?: (m: string) => void
  }
): Promise<CleanResult> {
  try {
    const rows = await worktreeRows(await deps.list(), deps.state(), deps.isPathInUse)
    return await cleanRows(groupWorktrees(rows).ready.filter((r) => r.owner?.runId === runId), deps)
  } catch (e) {
    deps.log?.(`worktree clean-up of run ${runId} failed: ${String(e)}`)
    return { removed: [], kept: [] }
  }
}
