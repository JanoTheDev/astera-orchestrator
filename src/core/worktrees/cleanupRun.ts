// W9-J: reads the git facts the ready rule (cleanup.ts) needs and removes what is ready. Node side: the Worktrees page
// asks it through IPC, and the Host asks it once a plan is delivered. Every removal is the plain, unforced
// `removeWorktree`, which refuses what is dirty or in use on its own: the rule is the first gate, that is the second.
import path from 'node:path'
import type { OrchState } from '../orchestration/state'
import type { BranchPushState, WorktreeListItem } from '../types'
import { groupWorktrees, inferOwner, isReadyToClean, worktreeOwners, type WorktreeRow } from './cleanup'
import { git } from './git'
import { readPushState } from './push'
import { blockingChanges, removeWorktree } from './remove'
import type { WorktreeStore } from './registry'

/** Commits of `branch` that no remote branch has, or null when git could not say. */
async function unpushedCount(path: string, branch: string): Promise<number | null> {
  const r = await git(['rev-list', '--count', branch, '--not', '--remotes'], { cwd: path })
  const n = r.ok ? Number(r.stdout.trim()) : NaN
  return Number.isInteger(n) ? n : null
}

/** The branch is an ancestor of its base (null when git could not say, and a missing base is "could not say"). */
async function inBaseOf(path: string, branch: string, baseRef: string): Promise<boolean | null> {
  const r = await git(['merge-base', '--is-ancestor', `refs/heads/${branch}`, baseRef], { cwd: path })
  if (r.ok) return true
  return (await git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], { cwd: path })).ok ? false : null
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
      const owner = owners.get(item.path.replace(/\\/g, '/').replace(/\/+$/, '')) ?? inferOwner(item, items, owners)
      const push = pushByRepo.get(item.repoPath)?.[item.baseRef]?.[item.branch]
      const readable = item.status === 'ok'
      const changes = readable ? await blockingChanges(item.path).catch(() => null) : null
      const dirty = changes?.count ?? null
      const unpushed = readable ? await unpushedCount(item.path, item.branch) : null
      const inBase = readable ? await inBaseOf(item.path, item.branch, item.baseRef) : null
      const live = isPathInUse(item.path) !== null
      return {
        item,
        owner,
        ahead: push?.ahead ?? null,
        behind: push?.behind ?? null,
        dirty,
        unpushed,
        inBase,
        // Only untracked files are listed: they are what a person can look at and decide about
        untracked: changes?.untracked ?? [],
        untrackedCount: changes?.untrackedCount ?? 0,
        live,
        ready: isReadyToClean({ owner, live, dirty, unpushed, inBase })
      }
    })
  )
}

export interface CleanResult {
  removed: string[]
  /** Folders kept, with why: the removal refused them (they changed in between), or the rule held them back
   *  (`untracked`: the files that block, at most 10). */
  kept: { path: string; reason: string; untracked?: string[] }[]
}

/** Removes the given rows, which must be ready, one at a time (they share repositories and their ref locks). A plan
 *  branch Astera pushed loses its copy on origin with the local branch (remove.ts deleteRemoteBranch). */
export async function cleanRows(
  rows: readonly WorktreeRow[],
  deps: { registry: WorktreeStore; isPathInUse: (p: string) => string | null; log?: (m: string) => void }
): Promise<CleanResult> {
  const out: CleanResult = { removed: [], kept: [] }
  // A plan's own folder goes after the Tasks forked from its branch: a Task branch is deleted once it is in that branch
  const isBase = (r: WorktreeRow): boolean => rows.some((o) => o !== r && o.item.repoPath === r.item.repoPath && o.item.baseRef === r.item.branch)
  for (const r of [...rows.filter((x) => !isBase(x)), ...rows.filter(isBase)]) {
    if (!r.ready) continue
    try {
      await removeWorktree({
        id: r.item.id,
        registry: deps.registry,
        isPathInUse: deps.isPathInUse,
        ...(r.owner?.pushed ? { deleteRemoteBranch: true } : {})
      })
      out.removed.push(r.item.path)
    } catch (e) {
      out.kept.push({ path: r.item.path, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  deps.log?.(`worktree clean-up: removed ${out.removed.length}, kept ${out.kept.length}`)
  return out
}

/** Why a folder of a finished plan is not ready, in words, or null when nothing holds it back. */
export function keptReason(r: WorktreeRow): string | null {
  if (r.ready) return null
  if (r.live) return 'a session runs in it'
  if (r.dirty === null || r.unpushed === null) return 'git could not read it'
  const tracked = r.dirty - r.untrackedCount
  if (tracked > 0) return `${tracked} uncommitted change${tracked === 1 ? '' : 's'}`
  if (r.untrackedCount > 0) return `${r.untrackedCount} untracked file${r.untrackedCount === 1 ? '' : 's'}`
  if (r.owner && !r.owner.merged && !r.owner.delivered && !r.owner.archived) return 'its work is not merged'
  if (r.unpushed > 0) return `${r.unpushed} commit${r.unpushed === 1 ? '' : 's'} neither pushed nor merged into ${r.item.baseRef}`
  return 'its work is not merged'
}

interface CleanDeps {
  registry: WorktreeStore
  list: () => Promise<WorktreeListItem[]>
  state: () => OrchState
  isPathInUse: (p: string) => string | null
  log?: (m: string) => void
  /** One line for the plan's activity feed: what was kept and why. */
  activity?: (runId: string, line: string) => void
}

/** Removes what is ready among `rows`, and tells the feed what a finished plan kept: one line per folder held back by
 *  untracked files (their paths, at most 10), one line for the rest. */
async function cleanAndReport(rows: readonly WorktreeRow[], deps: CleanDeps, report: boolean): Promise<CleanResult> {
  const result = await cleanRows(rows.filter((r) => r.ready), deps)
  if (!report) return result
  const held = new Map<string, string[]>()
  for (const r of rows) {
    const why = keptReason(r)
    if (why === null || !r.owner) continue
    const name = path.basename(r.item.path)
    const tracked = r.dirty !== null && r.dirty - r.untrackedCount > 0
    if (r.untrackedCount > 0 && !tracked && !r.live) {
      result.kept.push({ path: r.item.path, reason: why, untracked: r.untracked })
      deps.activity?.(r.owner.runId, `${name} kept: ${r.untrackedCount} untracked file${r.untrackedCount === 1 ? '' : 's'} (${r.untracked.join(', ')}${r.untrackedCount > r.untracked.length ? ', …' : ''})`)
      continue
    }
    result.kept.push({ path: r.item.path, reason: why })
    held.set(r.owner.runId, [...(held.get(r.owner.runId) ?? []), `${name} (${why})`])
  }
  for (const [runId, list] of held) deps.activity?.(runId, `Worktrees kept: ${list.join('; ')}`)
  return result
}

/** A finished plan's ready worktrees (and only that plan's) are removed. Never throws. */
export async function cleanRun(runId: string, deps: CleanDeps): Promise<CleanResult> {
  try {
    const rows = await worktreeRows(await deps.list(), deps.state(), deps.isPathInUse)
    return await cleanAndReport(rows.filter((r) => r.owner?.runId === runId), deps, true)
  } catch (e) {
    deps.log?.(`worktree clean-up of run ${runId} failed: ${String(e)}`)
    return { removed: [], kept: [] }
  }
}

/** The Host-start sweep: every ready worktree of a plan that is finished (delivered, or archived),
 *  whatever a crash or an older version left behind. Plans still running are left to their own delivery. Never throws. */
export async function cleanFinished(deps: CleanDeps): Promise<CleanResult> {
  try {
    const rows = await worktreeRows(await deps.list(), deps.state(), deps.isPathInUse)
    return await cleanAndReport(rows.filter((r) => r.owner && (r.owner.delivered || r.owner.archived)), deps, false)
  } catch (e) {
    deps.log?.(`worktree clean-up at start failed: ${String(e)}`)
    return { removed: [], kept: [] }
  }
}
