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
}

/** Whether the plan was delivered: a pushed commit, or its pull request out of draft. */
export const runDelivered = (run: OrchState['runs'][number]): boolean =>
  run.delivery?.sha !== undefined || (run.pr !== undefined && run.pr.draft !== true)

/** The owner of every folder the plans used, keyed by normalised path. A folder two plans used is the one found last. */
export function worktreeOwners(s: OrchState): Map<string, WorktreeOwner> {
  const out = new Map<string, WorktreeOwner>()
  for (const run of s.runs) {
    const job = s.jobs.find((j) => j.id === run.jobId)
    if (!job) continue
    const tasks = s.tasks.filter((t) => t.runId === run.id)
    const running = outcomeOfTasks(tasks) === 'running'
    const base = { jobId: job.id, runId: run.id, plan: jobNameOf(job), running }
    if (run.worktree !== undefined && !same(run.worktree, job.cwd))
      out.set(norm(run.worktree), { ...base, merged: runDelivered(run), taskIds: [], taskTitles: [], ...(run.coordinatorSessionId ? { sessionId: run.coordinatorSessionId } : {}) })
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

/** What is known about one worktree when the rule asks. `null` is "could not read": never ready. */
export interface CleanFacts {
  owner: WorktreeOwner | undefined
  /** A session or process runs in the folder (isPathInUse). */
  live: boolean
  /** Uncommitted changes, counting untracked files. */
  dirty: number | null
  /** Commits of the branch that no remote branch has. */
  unpushed: number | null
}

/** The ready rule. Not Astera's, unmerged, live, dirty, unpushed, or any fact unknown: not ready. */
export function isReadyToClean(f: CleanFacts): boolean {
  if (f.owner === undefined || !f.owner.merged) return false
  if (f.live) return false
  return f.dirty === 0 && f.unpushed === 0
}

/** One row of the Worktrees page: the listed worktree and what was read about it. */
export interface WorktreeRow {
  item: WorktreeListItem
  owner: WorktreeOwner | undefined
  ahead: number | null
  behind: number | null
  dirty: number | null
  unpushed: number | null
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

