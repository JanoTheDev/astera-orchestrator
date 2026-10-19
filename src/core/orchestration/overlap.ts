// W8-D several plans in one repo: where one plan's Tasks meet another plan's of the same project.
//
// **Two layers, one rule each.** At run time the file guard (schedule.ts `editingByProject`) keeps two workers of any
// plans of one project off the same files; nothing here blocks anything. Before and between waves this file says where
// the plans meet, so the planner plans around another plan and the owner sees it at approval (`Job.overlaps`, never a
// refusal). Paths overlap by `pathsOverlap`, the guard's own rule.
import { jobNameOf } from './jobName'
import { isJobActive } from './lifecycle'
import { outcomeOfTasks } from './running'
import { pathsOverlap, projectKeyOf } from './schedule'
import type { OrchState } from './state'
import type { Job, PlanOverlap, Task } from './types'

/** A plan's Tasks as they stand: its latest Run's, else (not started) its definition Tasks (a cancelled Task is removed). */
export function planTasksOf(s: OrchState, job: Job): Task[] {
  const run = s.runs.filter((r) => r.jobId === job.id).sort((a, b) => a.ordinal - b.ordinal).at(-1)
  return s.tasks.filter((t) => (run ? t.runId === run.id : t.jobId === job.id))
}

/** A plan that may still do work: not archived, and either not started (queued, awaiting approval) or still running. */
const activeOrQueued = (s: OrchState, job: Job): boolean =>
  isJobActive(job) && (job.pendingStart === true || outcomeOfTasks(planTasksOf(s, job)) === 'running')

/** The other plans of `job`'s project (`projectKeyOf`) that are not archived. `finished` too: the briefs read what they
 *  built; the overlap check only the active and queued ones. */
export function otherPlansOf(s: OrchState, job: Job, o: { finished?: boolean } = {}): Job[] {
  const key = projectKeyOf(job)
  return s.jobs.filter(
    (j) => j.id !== job.id && projectKeyOf(j) === key && isJobActive(j) && (o.finished === true || activeOrQueued(s, j))
  )
}

/** Each of `job`'s Tasks against every Task of every active or queued plan of the same project: one entry per pair that
 *  links the same issue (`Task.links.issue`) or has overlapping affected paths. */
export function overlapsOf(job: Job, s: OrchState): PlanOverlap[] {
  const mine = planTasksOf(s, job)
  if (mine.length === 0) return []
  const out: PlanOverlap[] = []
  for (const other of otherPlansOf(s, job)) {
    const theirs = planTasksOf(s, other)
    for (const t of mine)
      for (const o of theirs) {
        const issue = t.links?.issue?.number
        if (issue !== undefined && issue === o.links?.issue?.number) {
          out.push({ taskId: t.id, jobId: other.id, otherTaskId: o.id, by: 'issue', issue })
          continue
        }
        const path = (t.affectedPaths ?? []).find((p) => (o.affectedPaths ?? []).some((q) => pathsOverlap(p, q)))
        if (path !== undefined) out.push({ taskId: t.id, jobId: other.id, otherTaskId: o.id, by: 'path', path })
      }
  }
  return out
}

/** `next` with every active or queued Job's `overlaps` recomputed (others cleared), when this commit changed Jobs, Runs or Tasks (a Task of
 *  either plan changes the answer for both). The Host runs it on every commit (host/orch.ts), so the field never lags.
 *  Returns `next` itself when nothing moved. */
export function refreshOverlaps(prev: OrchState, next: OrchState): OrchState {
  if (prev.tasks === next.tasks && prev.jobs === next.jobs && prev.runs === next.runs) return next
  let changed = false
  const jobs = next.jobs.map((j) => {
    // a finished or archived plan does no more work, so it meets nothing
    const found = activeOrQueued(next, j) ? overlapsOf(j, next) : []
    if (JSON.stringify(found) === JSON.stringify(j.overlaps ?? [])) return j
    changed = true
    const { overlaps: _old, ...rest } = j
    return found.length > 0 ? { ...rest, overlaps: found } : rest
  })
  return changed ? { ...next, jobs } : next
}

/** One line per overlap, for the CLI, the activity line and the approve area:
 *  "T3 · Auth rework · T6 (same files: src/api/routes.ts)" or "(same issue #12)". */
export function overlapLines(s: OrchState, job: Job): string[] {
  const task = new Map(s.tasks.map((t) => [t.id, t]))
  const plan = new Map(s.jobs.map((j) => [j.id, j]))
  return (job.overlaps ?? []).map((o) => {
    const other = plan.get(o.jobId)
    const why = o.by === 'issue' ? `same issue #${o.issue}` : `same files: ${o.path}`
    return `${task.get(o.taskId)?.title ?? o.taskId} · ${other ? jobNameOf(other) : o.jobId} · ${task.get(o.otherTaskId)?.title ?? o.otherTaskId} (${why})`
  })
}

/** At most this many Tasks of one other plan in a brief; the rest are counted. */
const BRIEF_TASKS_MAX = 40

/** The other plans of this project, for the planner's and the replan's brief: each plan's name, id and state, then its
 *  Tasks with their status and affected paths. Empty when there is none. */
export function otherPlansBrief(s: OrchState, job: Job): string {
  const plans = otherPlansOf(s, job, { finished: true })
  if (plans.length === 0) return ''
  const lines = [
    'OTHER PLANS IN THIS REPOSITORY',
    'Other plans work in this repository too. Never plan a Task another plan already holds: if one of yours would',
    'do the same work, leave it out and name that plan and Task in existing.md (as you would an open issue). Plan',
    'around their files where you can; where you cannot, say so in existing.md. Astera runs no two workers on the',
    'same files at once, so an overlap only waits, but duplicated work is wasted.'
  ]
  for (const p of plans) {
    const tasks = planTasksOf(s, p)
    const state = p.pendingStart ? 'not started' : outcomeOfTasks(tasks)
    lines.push(`- ${jobNameOf(p)} (job ${p.id}, ${state}${p.areas?.length ? `, areas: ${p.areas.join(', ')}` : ''})`)
    for (const t of tasks.slice(0, BRIEF_TASKS_MAX)) {
      const issue = t.links?.issue ? `, issue #${t.links.issue.number}` : ''
      lines.push(`  - ${t.title} [${t.status}${issue}]: ${(t.affectedPaths ?? []).join(', ') || 'no paths given'}`)
    }
    if (tasks.length > BRIEF_TASKS_MAX) lines.push(`  - … ${tasks.length - BRIEF_TASKS_MAX} more (astera tasks list --run ${p.id} --json)`)
  }
  return lines.join('\n')
}

/** At most this many areas, each at most AREA_MAX characters. */
export const AREAS_MAX = 3
const AREA_MAX = 24

/** `--areas a,b,c` (or a JSON array): 1 to AREAS_MAX short lowercase words, each once. **A trust boundary**: a planner
 *  sets it. `none` clears. */
export function areasArg(v: unknown): string[] | { error: string } {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? (v.trim().startsWith('[') ? safeJson(v) : v.split(',')) : null
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) return { error: '--areas needs words, comma-separated (e.g. auth,api), or none' }
  const words = [...new Set((raw as string[]).map((x) => x.trim().toLowerCase()).filter((x) => x !== ''))]
  if (words.length === 1 && words[0] === 'none') return []
  if (words.length === 0 || words.length > AREAS_MAX) return { error: `--areas takes 1 to ${AREAS_MAX} areas, or none` }
  const bad = words.find((w) => w.length > AREA_MAX || !/^[a-z0-9][a-z0-9._-]*$/.test(w))
  if (bad !== undefined) return { error: `area "${bad}": a short word (letters, digits, . _ -), at most ${AREA_MAX} characters` }
  return words
}

const safeJson = (v: string): unknown => {
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}
