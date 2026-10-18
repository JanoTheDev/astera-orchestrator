// W8-C: a long plan delivered as a PR is followed from GitHub. After its first wave, while later waves remain, the plan's
// integration branch is pushed and a **draft** PR opened (`run-draft-pr`); after every later wave the branch is pushed
// again and the body rewritten with the done and remaining waves. At completion `run-open-pr` pushes the last time,
// writes the final body and marks the draft ready (`gh pr ready`). Nothing is ever merged by Astera.
//
// Pure: no clock, no files.
import { isSamePath } from '../files/tree'
import { deliveryOf } from './delivery'
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

/** The done count a draft update is due for, else null: a `pr` delivery of an active, unscheduled Job, a Run with an
 *  integration branch and no delivery yet, at least one wave done and one remaining, and no PR yet or a draft last
 *  written for a different count. A non-draft PR, a no-remote note or a recorded error is never touched here. */
export function draftPrDue(s: OrchState, run: JobRun): number | null {
  const job = jobOf(s, run)
  if (!job || !jobActive(job) || job.schedule !== undefined || deliveryOf(s, job) !== 'pr') return null
  if (run.worktree === undefined || run.delivery !== undefined) return null
  const pr = run.pr
  if (pr !== undefined && (pr.draft !== true || pr.error !== undefined || pr.note !== undefined)) return null
  const waves = runWaves(s, run.id)
  const done = wavesDoneOf(waves)
  if (done < 1 || done >= waves.length || pr?.wavesDone === done) return null
  return done
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
  "A draft: Astera pushes the plan's branch and updates this description after every wave, and marks it ready after the final check. It is never merged automatically."

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
  for (const d of ds) {
    if (!done.has(d.taskId) || (!d.outcome && !d.endedAt)) continue
    if (run.worktree !== undefined && isSamePath(d.cwd, run.worktree)) continue
    if (cwd !== undefined && isSamePath(d.cwd, cwd)) continue
    if (busy.some((p) => isSamePath(p, d.cwd)) || out.some((p) => isSamePath(p, d.cwd))) continue
    out.push(d.cwd)
  }
  return out
}
