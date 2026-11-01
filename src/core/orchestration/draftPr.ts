// W8-C: a long plan delivered as a PR is followed from GitHub. T3: after every Task merged into the plan's integration
// branch, the branch is pushed (`run-draft-pr`, `push` deliveries too) and, for a PR, a **draft** PR opened or its body
// rewritten with the done and remaining waves. At completion `run-open-pr` pushes the last time,
// writes the final body and marks the draft ready (`gh pr ready`). Nothing is ever merged by Astera.
//
// Pure: no clock, no files.
import { isSamePath } from '../files/tree'
import { deliveryLandingOf } from './delivery'
import { latestAttempts } from './integrate'
import { waveOf, runTasks } from './replan'
import { jobActive } from './schedule'
import { jobOf, type OrchState } from './state'
import type { JobRun, Task } from './types'

export interface RunWave {
  /** 1-based, as the PR body names it (`waveOf` + 1). */
  wave: number
  tasks: Task[]
  done: boolean
}

/** The Run's waves in order, each done when all its Tasks are completed. */
export function runWaves(s: OrchState, runId: string): RunWave[] {
  const byWave = new Map<number, Task[]>()
  for (const t of runTasks(s, runId)) {
    const w = waveOf(t, s.tasks)
    const list = byWave.get(w)
    if (list) list.push(t)
    else byWave.set(w, [t])
  }
  return [...byWave.entries()]
    .sort(([a], [b]) => a - b)
    .map(([w, tasks]) => ({ wave: w + 1, tasks, done: tasks.every((t) => t.status === 'completed') }))
}

/** The waves done from the first on: a later wave done before an earlier one is not counted yet. */
export const wavesDoneOf = (waves: readonly RunWave[]): number => {
  const i = waves.findIndex((w) => !w.done)
  return i === -1 ? waves.length : i
}

/** T3: the count of the Run's completed Tasks a plan-branch push is due for, else null. After every Task merged into
 *  the plan branch, Astera pushes that branch (`push` and `pr` deliveries) and, for `pr`, opens or updates the draft PR:
 *  an active, unscheduled Job, a Run with its own integration branch and no end delivery yet, more completed Tasks than
 *  at the last push that went through (`branchPush.tasksDone`), and, after a failed one, its retry time come
 *  (`branchPush.nextRetryAt`, when `nowMs` is given). A non-draft PR, a no-remote note or a recorded PR error is the end
 *  delivery's, never touched here. A Run with no worktree of its own merges no Task anywhere, so nothing is pushed.
 *  T4: `synced` (an origin sync merged into the plan branch) is due with no new Task; "I'll push it myself" never is.
 *  T10: the Job's `pushCadence` decides when: `end` (the default) never here, the final delivery pushes; `wave` counts
 *  only the Tasks of the finished waves before the last (the last is the delivery's); `task` as above. A failed push is
 *  retried whatever the cadence. `now` (a person's "push now") is due at once, whatever the cadence and the count. */
export function draftPrDue(s: OrchState, run: JobRun, nowMs?: number, opts?: { synced?: boolean; now?: boolean }): number | null {
  const job = jobOf(s, run)
  if (!job || !jobActive(job) || job.schedule !== undefined) return null
  // T6: a plan merged on this computer is never pushed, its plan branch neither. T32: nor one that fell back to merge or review
  const landing = deliveryLandingOf(s, job)
  if (landing.mode === 'merge' || landing.reason !== undefined) return null
  if (run.worktree === undefined || run.delivery !== undefined) return null
  const pr = run.pr
  if (pr !== undefined && (pr.draft !== true || pr.error !== undefined || pr.note !== undefined)) return null
  const done = runTasks(s, run.id).filter((t) => t.status === 'completed').length
  if (opts?.now === true) return done
  const bp = run.branchPush
  // T4: the owner pushes it; a failed push (an origin sync's too) is due again whatever the count, a sync's push at once
  if (bp?.ownerPushes === true) return null
  const cadence = job.pushCadence ?? 'end'
  const again = (opts?.synced === true && cadence === 'task') || (bp?.lastError !== undefined && bp.state !== 'delivered')
  const due = cadence === 'task' ? done : cadence === 'wave' ? finishedWaveTasks(runWaves(s, run.id)) : 0
  if (!again && (due < 1 || due <= (bp?.tasksDone ?? 0))) return null
  if (nowMs !== undefined && bp?.nextRetryAt !== undefined && Date.parse(bp.nextRetryAt) > nowMs) return null
  return again ? Math.max(due, bp?.tasksDone ?? 0) : due
}

/** The Tasks of the waves finished from the first on; none once every wave is done: the final delivery pushes then. */
const finishedWaveTasks = (waves: readonly RunWave[]): number => {
  const done = wavesDoneOf(waves)
  return done === waves.length ? 0 : waves.slice(0, done).reduce((n, w) => n + w.tasks.length, 0)
}

const waveLine = (w: RunWave): string => `- Wave ${w.wave}: ${w.tasks.map((t) => t.title).join(', ')}`

/** The body's waves section: the done waves, then the remaining ones. */
export function wavesSection(waves: readonly RunWave[]): string {
  const done = wavesDoneOf(waves)
  const lines = ['## Waves', '', 'Done:', ...waves.slice(0, done).map(waveLine)]
  if (done < waves.length) lines.push('', 'Remaining:', ...waves.slice(done).map(waveLine))
  return lines.join('\n')
}

export const DRAFT_PR_FOOTER =
  "A draft: Astera pushes the plan's branch and updates this description after every Task, and marks it ready after the final check. It is never merged automatically."

/** The worktrees of the Run's completed Tasks that are not folded into its integration branch yet: a Task's work is
 *  folded only when a dependent starts, so at a wave boundary the last wave's is still in its own worktree. Never a
 *  folder an unfinished Dispatch still works in, the Run's own worktree or the project folder. */
export function completedWorktrees(s: OrchState, run: JobRun): string[] {
  const cwd = jobOf(s, run)?.cwd
  const own = new Set(runTasks(s, run.id).map((t) => t.id))
  const done = new Set(runTasks(s, run.id).filter((t) => t.status === 'completed').map((t) => t.id))
  const ds = s.dispatches.filter((d) => own.has(d.taskId))
  const busy = ds.filter((d) => !d.outcome && !d.endedAt).map((d) => d.cwd)
  const out: string[] = []
  // Each Task's latest attempt only: an earlier one's worktree was replaced (integrate.ts latestAttempts)
  for (const d of latestAttempts(ds)) {
    if (!done.has(d.taskId) || (!d.outcome && !d.endedAt)) continue
    if (run.worktree !== undefined && isSamePath(d.cwd, run.worktree)) continue
    if (cwd !== undefined && isSamePath(d.cwd, cwd)) continue
    if (busy.some((p) => isSamePath(p, d.cwd)) || out.some((p) => isSamePath(p, d.cwd))) continue
    out.push(d.cwd)
  }
  return out
}
