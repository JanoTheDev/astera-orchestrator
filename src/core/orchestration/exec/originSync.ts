// T4: running plans stay current with teammates. Every active Run with its own worktree fetches origin at each wave
// boundary and every ORIGIN_SYNC_EVERY_MS (`lastOriginSyncAt` on the Run, so a restart does not sync again early), and
// merges `origin/<base>` into its plan branch when origin moved on (a merge, never a rebase, as the T11 refresh). A clean
// merge pushes the plan branch through T2's recorded push (`run-draft-pr --synced`); a conflict opens one integration
// Task in the plan, and the plan's new Tasks wait for it (`originSyncHold`). A project can turn it off (`originSync`).
//
// This module must stay importable by the Host: no electron, nothing from src/main.

import { git as realGit, fetchOrigin, gitVersionAtLeast, GIT_WRITE_TIMEOUT_MS } from '../../worktrees/git'
import { jobNameOf } from '../jobName'
import { isJobActive } from '../lifecycle'
import { deliveryBranchOf, projectOfJob } from '../delivery'
import { runWaves, wavesDoneOf } from '../draftPr'
import { isIntegrationTask, workingInRunRoot } from '../integrate'
import { outcomeOfTasks, tasksOwnedBy } from '../running'
import { jobOf, type OrchState } from '../state'
import type { Job, Task } from '../types'
import { refreshOnto } from './integrateGit'

export const ORIGIN_SYNC_EVERY_MS = 10 * 60_000
/** Opens the reason of an origin sync's integration Task, so its spec (and `originSyncHold`) can tell it. */
export const ORIGIN_SYNC_MARK = 'Origin sync:'

/** How one sync of a plan branch with origin ended. */
export type OriginSync =
  | { kind: 'no-origin' }
  /** git cannot run in the plan worktree (it is gone); like `human`, not recorded: the next look is from memory */
  | { kind: 'no-repo'; reason: string }
  | { kind: 'offline'; reason: string }
  | { kind: 'current' }
  | { kind: 'merged'; incoming: number; tip: string }
  | { kind: 'conflict'; incoming: number; tip: string; files: string[]; reason: string }
  | { kind: 'human'; reason: string }

/** Fetches origin's `branch` and merges it into the plan worktree when origin has commits the plan branch lacks
 *  (`refreshOnto`'s guards: on a branch, no uncommitted tracked change, a conflict found before anything is written). */
export async function syncWithOrigin(
  worktree: string,
  branch: string,
  ctx: { log(m: string): void; gitAtLeast?: typeof gitVersionAtLeast }
): Promise<OriginSync> {
  const f = await fetchOrigin(worktree, branch)
  if (f.kind === 'no-origin' || f.kind === 'no-repo') return f
  if (f.kind === 'failed') return { kind: 'offline', reason: f.reason }
  const tip = await realGit(['rev-parse', '--verify', `refs/remotes/origin/${branch}^{commit}`], { cwd: worktree })
  if (!tip.ok) return { kind: 'human', reason: `origin/${branch} cannot be read in ${worktree}` }
  const count = await realGit(['rev-list', '--count', `HEAD..${tip.stdout}`], { cwd: worktree })
  const incoming = count.ok ? Number(count.stdout) || 0 : 0
  if (incoming === 0) return { kind: 'current' }
  const r = await refreshOnto(worktree, tip.stdout, `Sync with origin/${branch}`, { log: ctx.log, ...(ctx.gitAtLeast ? { gitAtLeast: ctx.gitAtLeast } : {}) })
  if (r.kind === 'current') return r
  if (r.kind === 'merged') return { kind: 'merged', incoming, tip: tip.stdout }
  if (r.kind === 'human') return r
  return { kind: 'conflict', incoming, tip: tip.stdout, files: await conflictingFiles(worktree, tip.stdout), reason: r.reason }
}

/** The files `merge-tree` reports conflicting between HEAD and `tip` (git 2.38+); empty when it cannot tell. */
async function conflictingFiles(worktree: string, tip: string): Promise<string[]> {
  const r = await realGit(['merge-tree', '--write-tree', '--name-only', '--no-messages', 'HEAD', tip], { cwd: worktree, timeoutMs: GIT_WRITE_TIMEOUT_MS })
  // Exit 1 is the conflict: the tree id first, then one conflicted path per line
  return r.ok ? [] : r.stdout.split('\n').slice(1).map((l) => l.trim()).filter((l) => l !== '')
}

/** The origin sync's integration Task of the Run that is not completed yet: the Run's new Tasks wait for it (a failed
 *  one is the owner's, as any failed integration Task). */
export const originSyncHold = (s: OrchState, runId: string): Task | undefined =>
  s.tasks.find((x) => x.runId === runId && isIntegrationTask(x) && x.spec.includes(ORIGIN_SYNC_MARK) && x.status !== 'completed')

/** The branch a plan is kept in sync with: its target branch (`deliveryBranchOf`), else origin's default, else the
 *  recorded one (`deliverByPush`'s order). Null when none is known. */
async function baseBranchOf(s: OrchState, job: Job, worktree: string): Promise<string | null> {
  const target = deliveryBranchOf(s, job)
  if (target) return target
  const head = await realGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], { cwd: worktree })
  if (head.ok && head.stdout.startsWith('origin/')) return head.stdout.slice('origin/'.length)
  return projectOfJob(s, job)?.defaultBranch ?? null
}

export interface OriginSyncContext {
  getState(): OrchState
  handle(cmd: string, args: Record<string, unknown>): Promise<{ status: number; body: unknown }>
  /** Opens (once) the integration Task that merges `tip` into the plan branch; the loop's `startMergeWorker`. */
  openIntegration(runId: string, tip: string, reason: string): Promise<void>
  /** One feed line for the plan. */
  activity(runId: string, reason: string): void
  log(m: string): void
  nowMs(): number
  mayStart(): boolean
  /** Test seam: the merge-tree version check. */
  gitAtLeast?: typeof gitVersionAtLeast
}

/** The driving loop's origin sync: `tick` from each pass and the timer's nudge. Never throws. */
export function createOriginSync(c: OriginSyncContext): { tick(): Promise<void> } {
  /** The waves done when each Run was last looked at: one more is a boundary. In memory: a restart takes the count as
   *  it finds it, and the persisted `lastOriginSyncAt` still decides the 10-minute sync. */
  const wavesSeen = new Map<string, number>()
  /** When each Run was last looked at by this process, whether or not it was recorded. */
  const triedAt = new Map<string, number>()
  let busy = false
  const syncOne = async (runId: string): Promise<void> => {
    const s = c.getState()
    const run = s.runs.find((r) => r.id === runId)!
    const job = jobOf(s, run)!
    const plan = jobNameOf(job)
    const worktree = run.worktree!
    const branch = await baseBranchOf(s, job, worktree)
    const first = run.lastOriginSyncAt === undefined
    const r: OriginSync = branch === null ? { kind: 'human', reason: 'no base branch is known' } : await syncWithOrigin(worktree, branch, c)
    // Only a sync that reached git's answer about origin is recorded; the rest is looked at again from memory
    if (r.kind === 'no-repo' || r.kind === 'human') {
      c.log(`run=${runId}: not synced with origin: ${r.reason}`)
      return
    }
    const at = new Date(c.nowMs()).toISOString()
    const recorded = await c.handle('run-origin-synced', { run: runId, at })
    if (recorded.status >= 400) c.log(`run=${runId}: its origin sync time was not recorded: ${JSON.stringify(recorded.body)}`)
    switch (r.kind) {
      case 'no-origin':
        if (first) c.activity(runId, `Plan ${plan} has no origin remote, so it is not kept in sync with teammates' pushes`)
        return
      case 'offline':
        c.log(`run=${runId}: origin sync skipped, origin/${branch} could not be fetched: ${r.reason}`)
        return
      case 'current':
        return
      case 'merged': {
        c.log(`plan.synced run=${runId} incoming=${r.incoming} origin/${branch}=${r.tip}`)
        c.activity(runId, `Plan ${plan} synced with origin/${branch}: ${r.incoming} incoming commit(s)`)
        const pushed = await c.handle('run-draft-pr', { run: runId, synced: true })
        c.log(`run=${runId}: plan branch push after the origin sync: ${pushed.status >= 400 ? `refused, retried later: ${JSON.stringify(pushed.body)}` : 'done'}`)
        return
      }
      case 'conflict': {
        const files = r.files.length > 0 ? r.files.join(', ') : 'git could not name them'
        await c.openIntegration(
          runId,
          r.tip,
          `${ORIGIN_SYNC_MARK} origin/${branch} moved on to ${r.tip} (${r.incoming} commit(s) from teammates), and it conflicts with this plan's branch in: ${files}. ` +
            `Merge it in with \`git merge --no-edit ${r.tip}\` and resolve the conflict. ${r.reason}`
        )
        c.activity(runId, `Integration Task created in plan ${plan} for its conflict with origin/${branch} (${r.tip.slice(0, 7)}): ${files}`)
      }
    }
  }
  const tick = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const s = c.getState()
      const nowMs = c.nowMs()
      for (const run of s.runs) {
        const job = jobOf(s, run)
        if (!job || run.worktree === undefined || run.delivery !== undefined || !isJobActive(job) || job.schedule !== undefined) continue
        if (projectOfJob(s, job)?.originSync === 'off') continue
        if (outcomeOfTasks(tasksOwnedBy(s, run.id)) !== 'running') continue
        const waves = wavesDoneOf(runWaves(s, run.id))
        const seen = wavesSeen.get(run.id)
        if (seen === undefined) wavesSeen.set(run.id, waves)
        const boundary = seen !== undefined && waves > seen
        const last = Math.max(run.lastOriginSyncAt === undefined ? -Infinity : Date.parse(run.lastOriginSyncAt), triedAt.get(run.id) ?? -Infinity)
        if (!boundary && nowMs - last < ORIGIN_SYNC_EVERY_MS) continue
        // Never merged under a worker in the plan worktree (an integration worker merges there), nor twice into one conflict
        if (workingInRunRoot(s, run.id) || originSyncHold(s, run.id) !== undefined) continue
        if (!c.mayStart()) return
        wavesSeen.set(run.id, waves)
        triedAt.set(run.id, nowMs)
        try {
          await syncOne(run.id)
        } catch (e) {
          c.log(`run=${run.id}: origin sync failed: ${String(e)}`)
        }
      }
    } finally {
      busy = false
    }
  }
  return { tick }
}
