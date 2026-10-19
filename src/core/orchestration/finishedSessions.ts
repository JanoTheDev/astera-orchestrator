// The sessions a running plan is done with (the owner's decisions of 2026-10-18 and 2026-10-19): a worker whose Task is
// completed (merged or not: releasing ends the CLI, the worktree stays on disk for the merge), and a reviewer whose
// verdict is recorded. The driving loop ends them
// (exec/coordinatorRotate.ts) and the renderer closes their exited tabs (lib/tabAutoClose.ts), by this one rule.
// A failed Task's session and a Task with an open Gate keep theirs.
//
// Web-safe on purpose (the renderer reads it): no node:path, so folders are compared by `samePlace` below rather than
// files/tree.ts's isSamePath.
import { foldPathCase } from '../files/paths'
import { jobOf, type OrchState } from './state'
import { isPlaceholderSessionId, type Dispatch, type Task } from './types'

type DoneState = Pick<OrchState, 'runs' | 'jobs' | 'tasks' | 'dispatches' | 'gates'>

/** The same folder, written with either separator, a trailing one or (where the filesystem folds it) another case. Both
 *  are absolute paths the app recorded, so nothing needs resolving. */
const samePlace = (a: string, b: string): boolean => {
  const norm = (p: string): string => foldPathCase(p.replace(/\\/g, '/').replace(/\/+$/, ''))
  return norm(a) === norm(b)
}

/** A completed Task whose work is on the plan branch: its merge is recorded (`mergedIntoPlanAt`, the wave merge and the
 *  stall watchdog), its merge worker completed, every attempt worked in the Run's root (integrate.ts runRootOf), or a
 *  Task that depends on it has started (the app's loop merges a dependency's worktree into the root before it starts
 *  the dependent). */
export function mergedIntoPlan(s: DoneState, task: Pick<Task, 'id' | 'runId' | 'status' | 'mergedIntoPlanAt'>): boolean {
  if (task.status !== 'completed') return false
  if (task.mergedIntoPlanAt !== undefined) return true
  // The app's merge Task (integrate.ts integrationTaskFor: `parentId`)
  if (s.tasks.some((t) => t.parentId === task.id && t.status === 'completed')) return true
  const run = s.runs.find((r) => r.id === task.runId)
  if (!run) return false
  const root = run.worktree ?? jobOf(s as OrchState, run)?.cwd ?? ''
  const attempts = s.dispatches.filter((d) => d.taskId === task.id && !d.review)
  if (attempts.every((d) => samePlace(d.cwd, root))) return true
  return s.tasks.some((t) => t.runId === task.runId && t.deps.includes(task.id) && s.dispatches.some((d) => d.taskId === t.id))
}

/** The Dispatches whose session the plan is done with: closed, not retained, the latest of their session, of a Task
 *  that has not failed and has no open Gate, and either a review (its verdict is recorded) or a worker whose Task is
 *  completed. A merge that needs an agent gets its own integration Task and session. Whether the plan still runs, and whether the owner typed into the
 *  session, is the caller's question. */
export function sessionsDoneWith(s: DoneState): Dispatch[] {
  const latest = new Map<string, string>()
  for (const d of s.dispatches) latest.set(d.sessionId, d.id)
  const tasks = new Map(s.tasks.map((t) => [t.id, t]))
  const gated = new Set(s.gates.filter((g) => g.status === 'open').map((g) => g.taskId))
  return s.dispatches.filter((d) => {
    if (d.retained || (!d.outcome && !d.endedAt) || latest.get(d.sessionId) !== d.id || isPlaceholderSessionId(d.sessionId)) return false
    const t = tasks.get(d.taskId)
    if (!t || t.status === 'failed' || gated.has(t.id)) return false
    return d.review === true || t.status === 'completed'
  })
}
