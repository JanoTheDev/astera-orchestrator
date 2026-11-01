// The safety net under the wave merge (dispatchLoop mergeWaves): a Task left `merging` although its merge is done is
// recorded merged. Asked once per merge pass; cheap: only Tasks merging longer than MERGING_WATCH_MS are looked at, and
// git is asked about each at most once per MERGING_RECHECK_MS.
import { git } from '../../worktrees/git'
import { integrationTaskFor, isIntegrationTask, runRootOf } from '../integrate'
import { jobOf, samePlace, type OrchState } from '../state'

/** How long a Task may stay `merging` before the watch looks at it. */
export const MERGING_WATCH_MS = 5 * 60_000
/** How often one Task's branch is asked about again (a git call each time). */
export const MERGING_RECHECK_MS = 60_000
const ANCESTOR_TIMEOUT_MS = 10_000

export interface MergingDone {
  runId: string
  taskId: string
  runRoot: string
  /** Why it counts as merged, for the log and the plan's feed line. */
  reason: string
}

/** Whether the branch tip (`head`, else the worktree's HEAD) is already in the plan branch (runRoot's HEAD). */
export type BranchMerged = (a: { head?: string; worktree: string; runRoot: string }) => Promise<boolean>

const branchMerged: BranchMerged = async (a) => {
  let sha = a.head
  if (sha === undefined) {
    const tip = await git(['rev-parse', 'HEAD'], { cwd: a.worktree, timeoutMs: ANCESTOR_TIMEOUT_MS })
    if (!tip.ok) return false
    sha = tip.stdout.trim()
  }
  return (await git(['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: a.runRoot, timeoutMs: ANCESTOR_TIMEOUT_MS })).ok
}

export function createMergingWatch(o: { merged?: BranchMerged } = {}): { due(s: OrchState, nowMs: number): Promise<MergingDone[]> } {
  const merged = o.merged ?? branchMerged
  const checkedAt = new Map<string, number>()
  return {
    async due(s, nowMs) {
      const out: MergingDone[] = []
      for (const t of s.tasks) {
        if (t.status !== 'merging' || isIntegrationTask(t) || nowMs - Date.parse(t.updatedAt) < MERGING_WATCH_MS) continue
        const run = s.runs.find((r) => r.id === t.runId)
        if (!run || run.worktree === undefined) continue
        const runRoot = runRootOf(run, jobOf(s, run))
        const merge = integrationTaskFor(s, t.id)
        if (merge?.status === 'completed') {
          out.push({ runId: run.id, taskId: t.id, runRoot, reason: `its merge task ${merge.id} completed` })
          continue
        }
        if (nowMs - (checkedAt.get(t.id) ?? -Infinity) < MERGING_RECHECK_MS) continue
        checkedAt.set(t.id, nowMs)
        const last = [...s.dispatches].reverse().find((d) => d.taskId === t.id && !d.review && (d.outcome || d.endedAt) && !samePlace(d.cwd, runRoot))
        if (!last) continue
        let inPlan = false
        try {
          inPlan = await merged({ ...(last.git?.head ? { head: last.git.head } : {}), worktree: last.cwd, runRoot })
        } catch {
          // git could not answer: asked again after MERGING_RECHECK_MS
        }
        if (inPlan) out.push({ runId: run.id, taskId: t.id, runRoot, reason: `its branch tip is already in the plan branch (${runRoot})` })
      }
      return out
    }
  }
}
