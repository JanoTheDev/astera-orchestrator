// W9-J: which worktrees are ready to clean up, and how the Worktrees page groups them (DESIGN.md "Worktrees").
//
// Pure and web-safe: no git, no files. The git facts (dirty, unpushed) are read in cleanupRun.ts and handed in.
//
// A worktree is READY only when every one of these holds, and anything unknown is "not ready":
//   - Astera made it for a plan (a Dispatch's folder or the Run's folder, both in the registry),
//   - every Task that worked there is merged into its plan branch (or, for the Run's own folder, the plan is delivered),
//   - no session runs in it,
//   - its tree is clean,
//   - none of its commits is unpushed.
// The removal is never forced: removeWorktree refuses what is dirty or in use.
import { outcomeOfTasks } from '../orchestration/running'
import type { OrchState } from '../orchestration/state'
import { jobNameOf } from '../orchestration/jobName'
import type { ChangedFile } from '../git/changedFile'
import type { WorktreeListItem } from '../types'

/** Path equality that needs no node: the separators and a trailing slash are the only differences we expect. */
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
const same = (a: string, b: string): boolean => norm(a) === norm(b)

/** The plan work a worktree belongs to, as the orchestration state records it. */
export interface WorktreeOwner {
  jobId: string
  runId: string
  /** The plan's name, for the group heading. */
  plan: string
  /** The plan still has Tasks that are not finished. */
  running: boolean
  /** Every Task that worked here is merged into the plan branch; for the Run's own folder, the plan is delivered. */
  merged: boolean
  /** The Tasks that worked here (empty for the Run's own folder), and their titles in the same order. */
  taskIds: string[]
  taskTitles: string[]
  /** The console that worked here last (a worker's), or the plan's coordinator for the Run's own folder. */
  sessionId?: string
  /** The plan reached its destination: delivered (pushed, pull request out of draft, or merged on GitHub). */
  delivered?: boolean
  /** The plan's pull request was merged on GitHub (`pr.attributed`): its commits are in the base, whatever the squash did to them. */
  landed?: boolean
  /** The plan is archived: it starts nothing new (lifecycle.ts), and what still runs is held by the live and dirty checks. A failed Run the owner put away. */
  archived?: boolean
  /** Astera pushed this plan's branch (a push delivery, a branch push after a Task, or a pull request). */
  pushed?: boolean
  /** The folder was not in the plan's Dispatches: it is the folder of a Task the state no longer holds, found by its base. */
  inferred?: true
}

/** Whether the plan was delivered: a pushed commit, its delivery recorded as done, its pull request out of draft, or
 *  its pull request merged (a merged PR is delivered even while the draft flag was never cleared). */
export const runDelivered = (run: OrchState['runs'][number]): boolean =>
  run.delivery?.sha !== undefined ||
  run.deliveryState?.state === 'delivered' ||
  run.deliveryState?.state === 'delivered-by-owner' ||
  run.pr?.attributed !== undefined ||
  (run.pr !== undefined && run.pr.draft !== true && run.pr.url !== undefined)

/** The owner of every folder the plans used, keyed by normalised path. A folder two plans used is the one found last. */
export function worktreeOwners(s: OrchState): Map<string, WorktreeOwner> {
  const out = new Map<string, WorktreeOwner>()
  for (const run of s.runs) {
    const job = s.jobs.find((j) => j.id === run.jobId)
    if (!job) continue
    const tasks = s.tasks.filter((t) => t.runId === run.id)
    const running = outcomeOfTasks(tasks) === 'running'
    const delivered = runDelivered(run)
    const base = {
      jobId: job.id,
      runId: run.id,
      plan: jobNameOf(job),
      running,
      delivered,
      landed: run.pr?.attributed !== undefined,
      archived: job.archivedAt !== undefined,
      pushed: run.branchPush !== undefined || run.delivery !== undefined || run.pr?.url !== undefined
    }
    if (run.worktree !== undefined && !same(run.worktree, job.cwd))
      out.set(norm(run.worktree), { ...base, merged: delivered, taskIds: [], taskTitles: [], ...(run.coordinatorSessionId ? { sessionId: run.coordinatorSessionId } : {}) })
    const byPath = new Map<string, { ids: string[]; sessionId: string }>()
    for (const d of s.dispatches) {
      if (!tasks.some((t) => t.id === d.taskId) || same(d.cwd, job.cwd)) continue
      if (run.worktree !== undefined && same(d.cwd, run.worktree)) continue
      const at = byPath.get(norm(d.cwd))
      byPath.set(norm(d.cwd), { ids: [...(at?.ids ?? []), d.taskId], sessionId: d.sessionId })
    }
    for (const [p, { ids, sessionId }] of byPath) {
      const taskIds = [...new Set(ids)]
      const merged = taskIds.every((id) => tasks.find((t) => t.id === id)?.mergedIntoPlanAt !== undefined)
      out.set(p, { ...base, merged, taskIds, taskTitles: taskIds.map((id) => tasks.find((t) => t.id === id)?.title ?? id), sessionId })
    }
  }
  return out
}

/** A registered folder no Dispatch names, forked from a plan's branch: the folder of a Task of that plan whose Dispatches
 *  the state lost (the 2026-10-22 wipe). It belongs to the plan whose own folder holds that branch, and nothing about
 *  its Tasks is known, so it is never `merged`: the rule asks git (pushed, or in the plan branch) instead. */
export function inferOwner(
  item: Pick<WorktreeListItem, 'repoPath' | 'baseRef' | 'path'>,
  all: readonly Pick<WorktreeListItem, 'repoPath' | 'branch' | 'path'>[],
  owners: ReadonlyMap<string, WorktreeOwner>
): WorktreeOwner | undefined {
  for (const o of all) {
    const own = owners.get(norm(o.path))
    if (own && own.taskIds.length === 0 && o.repoPath === item.repoPath && o.branch === item.baseRef && !same(o.path, item.path)) {
      const { sessionId: _coordinator, ...rest } = own
      return { ...rest, merged: false, taskIds: [], taskTitles: [], inferred: true }
    }
  }
  return undefined
}

/** What is known about one worktree when the rule asks. `null` is "could not read": never ready. */
export interface CleanFacts {
  owner: WorktreeOwner | undefined
  /** A session or process runs in the folder (isPathInUse). */
  live: boolean
  /** Uncommitted changes, counting untracked files that git does not ignore (cleanupRun.ts blockingChanges). */
  dirty: number | null
  /** Commits of the branch that no remote branch has. */
  unpushed: number | null
  /** The branch is already part of its base (an ancestor of it). Optional: unknown reads as not merged. */
  inBase?: boolean | null
}

/** The ready rule. Not Astera's, live, dirty, or any fact unknown: not ready. Then one of:
 *  - every Task that worked here is merged (or, for the plan's own folder, the plan is delivered) and the commits are
 *    pushed, or the plan's pull request was merged on GitHub (a squash leaves no remote branch that holds them);
 *  - the plan is delivered, or archived, and whatever this folder holds is safe elsewhere: pushed,
 *    or already part of its base. That is the failed Run the owner archived, and the Task folders a delivered plan's
 *    state forgot. Commits that are neither pushed nor in the base keep the folder. */
export function isReadyToClean(f: CleanFacts): boolean {
  const o = f.owner
  if (o === undefined || f.live || f.dirty !== 0) return false
  if (o.merged) return f.unpushed === 0 || o.landed === true
  if (!o.delivered && !o.archived) return false
  return f.unpushed === 0 || f.inBase === true
}

/** One row of the Worktrees page: the listed worktree and what was read about it. */
export interface WorktreeRow {
  item: WorktreeListItem
  owner: WorktreeOwner | undefined
  ahead: number | null
  behind: number | null
  dirty: number | null
  unpushed: number | null
  /** The branch is part of its base already; null: git could not say. */
  inBase: boolean | null
  /** Untracked files git does not ignore (at most 10 listed), the reason a folder otherwise ready is kept. */
  untracked: string[]
  /** How many untracked files git does not ignore there are in all (`untracked` lists the first 10). */
  untrackedCount: number
  live: boolean
  ready: boolean
}

export interface WorktreeGroups {
  /** A group per plan that still runs, in first-seen order. */
  plans: { jobId: string; plan: string; rows: WorktreeRow[] }[]
  ready: WorktreeRow[]
  yours: WorktreeRow[]
}

/** "Ready to clean up" wins over a running plan (a merged Task's folder of a plan still running is ready once pushed);
 *  a plan's other folders are listed under it; whatever Astera did not make for a plan is Yours. A finished plan's
 *  folders that are not ready yet (dirty, unpushed, in use) stay with their plan's group, which is why the heading
 *  is "per plan" and not "per running plan" for them. */
export function groupWorktrees(rows: readonly WorktreeRow[]): WorktreeGroups {
  const g: WorktreeGroups = { plans: [], ready: [], yours: [] }
  for (const r of rows) {
    if (r.ready) g.ready.push(r)
    else if (r.owner === undefined) g.yours.push(r)
    else {
      let plan = g.plans.find((p) => p.jobId === r.owner!.jobId)
      if (!plan) g.plans.push((plan = { jobId: r.owner.jobId, plan: r.owner.plan, rows: [] }))
      plan.rows.push(r)
    }
  }
  return g
}

// ── The detail pane (detail.ts reads it) ──

export interface WorktreeCommit {
  sha: string
  subject: string
  /** The git author name; the W8 note says whether an agent or a person wrote it. */
  author: string
  kind: 'ai' | 'human' | 'unknown'
  /** Set when a note names the agent: "claude · opus" and the Task it worked. */
  agent?: string
  task?: string
}

export interface WorktreeDetail {
  /** Null: git could not answer (the base is gone, the folder is not readable). */
  files: ChangedFile[] | null
  commits: WorktreeCommit[] | null
}

