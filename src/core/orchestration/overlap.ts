// W8-D several plans in one repo: where one plan's Tasks meet another plan's of the same project.
//
// **Two layers, one rule each.** At run time the file guard (schedule.ts `editingByProject`) keeps two workers of any
// plans of one project off the same files; nothing here blocks anything. Before and between waves this file says where
// the plans meet, so the planner plans around another plan and the owner sees it at approval (`Job.overlaps`, never a
// refusal). Paths overlap by `pathsOverlap`, the guard's own rule.
//
// T9 the project coordinator: rules, no extra session. A done Task's files stay leased until its plan delivers
// (schedule.ts `leasesByProject`); here `refreshOverlaps` tells the waiting plan's coordinator when it starts to meet
// another plan, holds a not-started Task that duplicates another plan's behind an owner decision, and carries that
// decision out.
import { jobNameOf } from './jobName'
import { isJobActive } from './lifecycle'
import { outcomeOfTasks } from './running'
import { leasesByProject, pathsOverlap, planOutranks, projectKeyOf, sameFilesAs } from './schedule'
import { createGate, type OrchState } from './state'
import { afterStandOf } from './after'
import { cancelRemainingTask } from './replan'
import { newId, type Gate, type Job, type Message, type PlanOverlap, type Task } from './types'

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
  const key = projectKeyOf(s, job)
  return s.jobs.filter(
    (j) => j.id !== job.id && projectKeyOf(s, j) === key && isJobActive(j) && (o.finished === true || activeOrQueued(s, j))
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
 *  T9: then the coordinator's rules (`coordinate`). Returns `next` itself when nothing moved. */
export function refreshOverlaps(prev: OrchState, next: OrchState, now: string = new Date().toISOString()): OrchState {
  if (prev.tasks === next.tasks && prev.jobs === next.jobs && prev.runs === next.runs && prev.gates === next.gates) return next
  let changed = false
  const notices: { job: Job; lines: string[] }[] = []
  const planById = new Map(next.jobs.map((o) => [o.id, o]))
  const jobs = next.jobs.map((j) => {
    // a finished or archived plan does no more work, so it meets nothing
    const found = activeOrQueued(next, j) ? overlapsOf(j, next) : []
    if (JSON.stringify(found) === JSON.stringify(j.overlaps ?? [])) return j
    changed = true
    // T9: the new overlaps on which the other plan goes first: this plan is the one that waits
    const had = new Set((j.overlaps ?? []).map(overlapKey))
    const waits = found.filter((o) => !had.has(overlapKey(o)) && planOutranks(planById.get(o.jobId) ?? j, j))
    if (waits.length > 0) notices.push({ job: j, lines: overlapLines(next, { ...j, overlaps: waits }) })
    const { overlaps: _old, ...rest } = j
    return found.length > 0 ? { ...rest, overlaps: found } : rest
  })
  let out = changed ? { ...next, jobs } : next
  for (const n of notices) out = noticeTo(out, n.job, 'Another plan of this project goes first', n.lines, now)
  return coordinate(prev, out, now)
}

const overlapKey = (o: PlanOverlap): string => `${o.taskId}|${o.otherTaskId}`

const latestRunId = (s: OrchState, jobId: string): string | undefined =>
  s.runs.filter((r) => r.jobId === jobId).sort((a, b) => a.ordinal - b.ordinal).at(-1)?.id

/** T9: one message to `job`'s coordinator (its latest Run's inbox; `check` delivers it). None when the plan has no Run. */
function noticeTo(s: OrchState, job: Job, subject: string, lines: string[], now: string): OrchState {
  const runId = latestRunId(s, job.id)
  if (runId === undefined || lines.length === 0) return s
  const body = [
    ...lines,
    'Astera holds the waiting Task until the other plan delivers; plan around those files if you can, or wait.'
  ].join('\n')
  const message: Message = { id: newId('msg'), runId, type: 'status', subject: `${subject}: ${lines[0]}`.slice(0, 500), body, answered: false, createdAt: now }
  return { ...s, messages: [...s.messages, message] }
}

/** T9: the two answers of a duplicate decision. */
export const DUPLICATE_OPTIONS = ['cancel as duplicate', 'keep both'] as const

/** A Gate this file opened over a duplicate Task.
 *  shortcut: told apart by its two answers, not a GateKind (a new kind would count as a verdict gate in continuity/events.ts);
 *  give it a kind of its own if another Gate ever offers the same two. */
export const isDuplicateGate = (g: Pick<Gate, 'options'>): boolean =>
  g.options?.length === 2 && g.options[0] === DUPLICATE_OPTIONS[0] && g.options[1] === DUPLICATE_OPTIONS[1]

/** Why `t` repeats `o`: the same issue, or the same title (trimmed, any case) on overlapping paths. */
function duplicateWhy(t: Task, o: Task, root: string): string | undefined {
  const issue = t.links?.issue?.number
  if (issue !== undefined && issue === o.links?.issue?.number) return `same issue #${issue}`
  if (t.title.trim().toLowerCase() !== o.title.trim().toLowerCase()) return undefined
  const path = (t.affectedPaths ?? []).find((p) => (o.affectedPaths ?? []).some((q) => pathsOverlap(p, q, root)))
  return path === undefined ? undefined : `same title, same files: ${path}`
}

/** T9: the coordinator's rules for one commit, after the overlaps are fresh.
 *  1. A ready Task newly held back by another plan's lease: one message to its plan's coordinator.
 *  2. A Task of a plan that has not started, repeating a Task of a plan that goes first (`planOutranks`) and has not
 *     delivered: held behind one Gate (the owner's, or the hands-off decider's, Inbox item) "cancel as duplicate / keep
 *     both". Once per Task: a resolved one is not asked again.
 *  3. That Gate answered "cancel as duplicate": the Task leaves its Run (`cancelRemainingTask`). */
function coordinate(prev: OrchState, next: OrchState, now: string): OrchState {
  let s = next
  // 3. carry out a cancel answered in this commit
  const wasOpen = new Set(prev.gates.filter((g) => g.status === 'open').map((g) => g.id))
  for (const g of next.gates)
    if (g.status === 'resolved' && wasOpen.has(g.id) && isDuplicateGate(g) && g.resolution === DUPLICATE_OPTIONS[0]) {
      const r = cancelRemainingTask(s, g.taskId)
      if (r.ok) s = r.state
    }
  // 1. newly held back by a lease
  const before = leaseWaits(prev)
  const jobById = new Map(s.jobs.map((j) => [j.id, j]))
  const byPlan = new Map<string, string[]>()
  for (const [key, w] of leaseWaits(s)) {
    if (before.has(key)) continue
    byPlan.set(w.jobId, [...(byPlan.get(w.jobId) ?? []), w.line])
  }
  for (const [jobId, lines] of byPlan) {
    const job = jobById.get(jobId)
    if (job) s = noticeTo(s, job, 'Waiting for another plan to deliver', lines, now)
  }
  // 2. hold a duplicate
  const asked = new Set(s.gates.filter(isDuplicateGate).map((g) => g.taskId))
  const started = new Set(s.dispatches.map((d) => d.taskId))
  for (const b of s.jobs) {
    const runId = latestRunId(s, b.id)
    if (runId === undefined || !isJobActive(b)) continue
    const keepers = s.jobs.filter(
      (a) => a.id !== b.id && projectKeyOf(s, a) === projectKeyOf(s, b) && planOutranks(a, b) && afterStandOf(s, a.id) === 'waiting'
    )
    if (keepers.length === 0) continue
    for (const t of s.tasks) {
      if (t.runId !== runId || (t.status !== 'ready' && t.status !== 'pending') || started.has(t.id) || asked.has(t.id)) continue
      const hit = keepers
        .flatMap((a) => planTasksOf(s, a).map((o) => ({ a, o, why: duplicateWhy(t, o, b.cwd) })))
        .find((x) => x.why !== undefined)
      if (!hit) continue
      const question =
        `Duplicate? "${t.title}" (plan ${jobNameOf(b)}) repeats "${hit.o.title}" of plan ${jobNameOf(hit.a)} (${hit.why}). ` +
        `Cancel ${jobNameOf(b)}'s Task as a duplicate of ${jobNameOf(hit.a)}'s, or keep both?`
      const r = createGate(s, { taskId: t.id, question, options: [...DUPLICATE_OPTIONS] }, now)
      if (r.ok) {
        s = r.state
        asked.add(t.id)
      }
    }
  }
  return s
}

/** Each ready Task another plan's lease holds back, keyed by Task and lease, with the line that names them. */
function leaseWaits(s: OrchState): Map<string, { jobId: string; line: string }> {
  const out = new Map<string, { jobId: string; line: string }>()
  const leases = leasesByProject(s)
  if (leases.size === 0) return out
  const jobOfRun = new Map(s.runs.map((r) => [r.id, r.jobId]))
  const jobById = new Map(s.jobs.map((j) => [j.id, j]))
  for (const t of s.tasks) {
    if (t.status !== 'ready' || t.runId === undefined) continue
    const job = jobById.get(jobOfRun.get(t.runId) ?? '')
    if (!job) continue
    const clash = sameFilesAs(t, leases.get(projectKeyOf(s, job)) ?? [])
    if (!clash?.task.lease) continue
    const other = jobById.get(clash.task.lease.jobId)
    out.set(`${t.id}|${clash.task.id}`, {
      jobId: job.id,
      line: `${t.title} waits for ${other ? jobNameOf(other) : clash.task.lease.jobId} · ${clash.task.title} to deliver ${clash.path}`
    })
  }
  return out
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

/** The other plans of this project, for the planner's and the replan's brief: each plan's name, id and state, then (an
 *  active or queued plan only; a finished one is a single line) its Tasks with their status and affected paths. Empty
 *  when there is none. */
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
    // T1: a finished plan is one line; its Tasks are one command away
    if (!activeOrQueued(s, p)) {
      lines[lines.length - 1] += `: ${tasks.filter((t) => t.status === 'completed').length} Tasks done (astera tasks list --run ${p.id} --json)`
      continue
    }
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
