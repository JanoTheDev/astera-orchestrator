// W8-D several plans in one repo: where one plan's Tasks meet another plan's of the same project.
//
// **Two layers, one rule each.** At run time the file guard (schedule.ts `editingByProject`) keeps two workers of any
// plans of one project off the same files, on a project with serial files on (T7 `serialFilesOf`; otherwise they run
// side by side and the merge worker settles a conflict); nothing here blocks anything. Before and between waves this file says where
// the plans meet, so the planner plans around another plan and the owner sees it at approval (`Job.overlaps`, never a
// refusal). Paths overlap by `pathsOverlap`, the guard's own rule.
//
// T9 the project coordinator: rules, no extra session. A done Task's files stay leased until its plan delivers
// (schedule.ts `leasesByProject`); here `refreshOverlaps` tells the waiting plan's coordinator when it starts to meet
// another plan, holds a not-started Task that duplicates another plan's behind an owner decision, and carries that
// decision out.
import { jobNameOf } from './jobName'
import { isJobActive } from './lifecycle'
import { outcomeOfRun } from './running'
// T1 the main plan
import { activeOrQueued, externalDepsOf, holdExternalDeps, mainPlanOf, otherPlansOf, planIdOf, planTasksOf } from './mainPlan'
import { isLeaseWaitGate, LEASE_WAIT_OPTIONS, leasesByProject, pathsOverlap, planOutranks, projectKeyOf, sameFilesAs, serialFilesOf } from './schedule'
import { createGate, type OrchState } from './state'
import { afterStandOf } from './after'
import { cancelRemainingTask } from './replan'
import { FAILURE_LIMIT, newId, recomputeReady, type Gate, type Job, type Message, type PlanOverlap, type Task } from './types'

// T1: the plan helpers live with the main plan (mainPlan.ts, web-safe); kept exported from here for their callers
export { planTasksOf, otherPlansOf } from './mainPlan'

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
  // T7: without serial files the two run side by side, and the plan that goes first lands first (exec/deliveryWait.ts)
  for (const n of notices)
    out = noticeTo(
      out,
      n.job,
      serialFilesOf(out, projectKeyOf(out, n.job))
        ? 'Another plan of this project goes first'
        : 'Another plan of this project edits the same files and goes first; the merge may need the merge worker',
      n.lines,
      now
    )
  // T1: a delivery readies the Tasks of other plans that wait on it
  return holdExternalDeps(coordinate(prev, out, now))
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
    serialFilesOf(s, projectKeyOf(s, job))
      ? 'Astera holds the waiting Task until the other plan delivers; plan around those files if you can, or wait.'
      : // T7: nothing waits; the plan that goes first lands first, and this one merges it and validates (exec/deliveryWait.ts)
        'Both run now, each in its own worktree; this plan merges the other when it delivers, and the merge worker settles a conflict.'
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

/** T1: the three answers of the owner question over a Task whose dep on another plan's Task will not come: that plan
 *  stopped, or the Task was cancelled (mainPlan.ts `externalDepsOf` 'stopped' or 'gone'). */
export const STOPPED_DEP_OPTIONS = ['keep waiting', 'drop this dependency', 'cancel this Task'] as const

/** A Gate this file opened over a stopped cross-plan dep: told apart by its answers (`isDuplicateGate`). */
export const isStoppedDepGate = (g: Pick<Gate, 'options'>): boolean =>
  g.options?.length === STOPPED_DEP_OPTIONS.length && STOPPED_DEP_OPTIONS.every((o, i) => g.options![i] === o)

/** The tag that ends a stopped-dep question and names the dep it is about, so a Task gets one Gate per stopped dep.
 *  shortcut: in the question text, as Gate has no field for it; add one if Gates ever need more such keys. */
const stoppedDepTag = (depId: string): string => ` [dep ${depId}]`
const stoppedDepOf = (g: Pick<Gate, 'question'>): string | undefined => /\[dep ([^\]]+)\]$/.exec(g.question)?.[1]

/** T1: carries out a stopped-dep question answered in this commit. "drop this dependency" takes the dep it asked about
 *  off the Task (all that will not come, for a question without a dep tag; the ready rule then decides,
 *  `holdExternalDeps`); "cancel this Task" takes it out of its Run; "keep waiting" leaves it pending, so it runs if that
 *  plan is taken up again. */
function carryOutStoppedDep(s: OrchState, g: Gate, now: string): OrchState {
  if (g.resolution === STOPPED_DEP_OPTIONS[2]) {
    const r = cancelRemainingTask(s, g.taskId)
    return r.ok ? r.state : s
  }
  if (g.resolution !== STOPPED_DEP_OPTIONS[1]) return s
  const tasks = s.tasks.map((t) => {
    if (t.id !== g.taskId) return t
    const only = stoppedDepOf(g)
    const lost = new Set(externalDepsOf(s, t).filter((d) => (d.why === 'stopped' || d.why === 'gone') && (only === undefined || d.id === only)).map((d) => d.id))
    return lost.size === 0 ? t : { ...t, deps: t.deps.filter((d) => !lost.has(d)), updatedAt: now }
  })
  return { ...s, tasks: recomputeReady(tasks) }
}

/** T11: titles this alike (`titleSimilarity`) on overlapping paths read as one piece of work. */
export const SIMILAR_TITLE = 0.6

/** The Jaccard index of two titles' words: lowercased, split on anything not a letter or digit. 1 for equal words. */
export function titleSimilarity(a: string, b: string): number {
  const words = (x: string): Set<string> => new Set(x.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== ''))
  const wa = words(a)
  const wb = words(b)
  if (wa.size === 0 || wb.size === 0) return 0
  const shared = [...wa].filter((w) => wb.has(w)).length
  return shared / (wa.size + wb.size - shared)
}

/** Why `t` repeats `o`: the same issue, or the same or a similar title (T11 `SIMILAR_TITLE`) on overlapping paths. */
function duplicateWhy(t: Task, o: Task, root: string): string | undefined {
  const issue = t.links?.issue?.number
  if (issue !== undefined && issue === o.links?.issue?.number) return `same issue #${issue}`
  const same = t.title.trim().toLowerCase() === o.title.trim().toLowerCase()
  if (!same && titleSimilarity(t.title, o.title) < SIMILAR_TITLE) return undefined
  const path = (t.affectedPaths ?? []).find((p) => (o.affectedPaths ?? []).some((q) => pathsOverlap(p, q, root)))
  return path === undefined ? undefined : `${same ? 'same' : 'similar'} title, same files: ${path}`
}

/** T11: the warning lines `task-create` answers with when the new Task looks like a Task of another plan of the project
 *  (`duplicateWhy`, every active or queued plan, whichever goes first). Empty when none; never a refusal. */
export function taskCreateWarnings(s: OrchState, task: Task): string[] {
  const jobId = task.jobId ?? s.runs.find((r) => r.id === task.runId)?.jobId
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job) return []
  const out: string[] = []
  for (const other of otherPlansOf(s, job))
    for (const o of planTasksOf(s, other)) {
      const why = duplicateWhy(task, o, job.cwd)
      if (why !== undefined)
        out.push(
          `possible duplicate: "${task.title}" looks like "${o.title}" (${o.id}) of plan ${jobNameOf(other)} (job ${other.id}; ${why}). ` +
            'Leave it out if it is the same work.'
        )
    }
  return out
}

/** T11: what a planner still planning is told about a plan its plan meets (`Job.overlaps`), one per other plan. `key`
 *  names the pair and what they share, so the same overlap is told once (`createStallWatch` keeps the keys). */
export interface PlannerOverlapNotice {
  key: string
  jobId: string
  sessionId: string
  text: string
}

/** T11: plans planned at the same time see each other. Every plan still planning (not started, a planner, not handed
 *  over or not), one notice per other plan it meets, for its latest planner session. Pure: the Host types it. */
export function plannerOverlapNotices(s: OrchState): PlannerOverlapNotice[] {
  const task = new Map(s.tasks.map((t) => [t.id, t]))
  const plan = new Map(s.jobs.map((j) => [j.id, j]))
  const out: PlannerOverlapNotice[] = []
  for (const j of s.jobs) {
    const sessionId = j.plannerSessionIds?.at(-1)
    if (sessionId === undefined || j.pendingStart !== true || !isJobActive(j) || !j.overlaps?.length) continue
    const byPlan = new Map<string, PlanOverlap[]>()
    for (const o of j.overlaps) byPlan.set(o.jobId, [...(byPlan.get(o.jobId) ?? []), o])
    for (const [otherId, list] of byPlan) {
      const other = plan.get(otherId)
      if (!other) continue
      const shared = [...new Set(list.map((o) => (o.by === 'issue' ? `issue #${o.issue}` : (o.path ?? ''))))].filter((x) => x !== '').sort()
      const titles = [...new Set(list.map((o) => task.get(o.otherTaskId)?.title ?? o.otherTaskId))]
      const state = other.pendingStart ? 'is planning too' : 'is running'
      out.push({
        key: `${j.id}>${otherId}|${shared.join('|')}`,
        jobId: j.id,
        sessionId,
        text:
          `Astera: another plan of this repository, ${jobNameOf(other)} (job ${other.id}), ${state} and meets yours on ` +
          `${shared.join(', ')}. Its Tasks there: ${titles.join('; ')}. Plan around those files where you can; leave out ` +
          'work it already holds and name that plan and Task in existing.md.'
      })
    }
  }
  return out
}

/** T11: the answers of the owner question over a Task the watchdog cannot start (no account, out of tries, its account
 *  paused). */
export const DROPPED_OPTIONS = ['Use another account', 'Retry once more', 'Cancel this Task'] as const

/** A Gate the watchdog opened over a Task it cannot start: told apart by its answers (`isDuplicateGate`). */
export const isDroppedGate = (g: Pick<Gate, 'options'>): boolean =>
  g.options?.length === DROPPED_OPTIONS.length && DROPPED_OPTIONS.every((o, i) => g.options![i] === o)

/** T11: carries out a watchdog question answered in this commit (exec/stallWatch.ts). "Cancel this Task" takes it out
 *  of its Run; "Use another account" moves its first account to the end and clears its failures; "Retry once more"
 *  leaves it one try. "Run it now anyway" is read where the leases are (schedule.ts `leasesByProject`). */
function carryOutWatchdogAnswer(s: OrchState, g: Gate, now: string): OrchState {
  if (g.resolution === LEASE_WAIT_OPTIONS[2]) {
    const r = cancelRemainingTask(s, g.taskId)
    return r.ok ? r.state : s
  }
  if (!isDroppedGate(g)) return s
  const tasks = s.tasks.map((t) => {
    if (t.id !== g.taskId) return t
    if (g.resolution === DROPPED_OPTIONS[0]) {
      const ids = t.accountIds ?? []
      return { ...t, accountIds: [...ids.slice(1), ...ids.slice(0, 1)], consecutiveFailures: 0, updatedAt: now }
    }
    if (g.resolution === DROPPED_OPTIONS[1]) return { ...t, consecutiveFailures: Math.min(t.consecutiveFailures, FAILURE_LIMIT - 1), updatedAt: now }
    return t
  })
  return { ...s, tasks }
}

/** T9: the coordinator's rules for one commit, after the overlaps are fresh.
 *  1. A ready Task newly held back by another plan's lease: one message to its plan's coordinator.
 *  2. A Task of a plan that has not started, repeating a Task of a plan that goes first (`planOutranks`) and has not
 *     delivered: held behind one Gate (the owner's, or the hands-off decider's, Inbox item) "cancel as duplicate / keep
 *     both". Once per Task: a resolved one is not asked again.
 *  3. That Gate answered "cancel as duplicate": the Task leaves its Run (`cancelRemainingTask`). T11: so do the watchdog's
 *     questions (`carryOutWatchdogAnswer`). T1: and the stopped-dep question (`carryOutStoppedDep`).
 *  4. T1: a not-started Task whose dep on another plan's Task will not come (that plan stopped, the Task is gone): held
 *     behind one Gate "keep waiting / drop this dependency / cancel this Task". Once per Task and stopped dep (a new
 *     one opens a new Gate, the same one is not asked twice), never a silent stall. */
function coordinate(prev: OrchState, next: OrchState, now: string): OrchState {
  let s = next
  // 3. carry out a cancel answered in this commit
  const wasOpen = new Set(prev.gates.filter((g) => g.status === 'open').map((g) => g.id))
  for (const g of next.gates) {
    if (g.status !== 'resolved' || !wasOpen.has(g.id)) continue
    if (isDuplicateGate(g) && g.resolution === DUPLICATE_OPTIONS[0]) {
      const r = cancelRemainingTask(s, g.taskId)
      if (r.ok) s = r.state
    } else if (isLeaseWaitGate(g) || isDroppedGate(g)) s = carryOutWatchdogAnswer(s, g, now)
    else if (isStoppedDepGate(g)) s = carryOutStoppedDep(s, g, now)
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
  // 4. T1: a not-started Task waiting on another plan's Task that will not come: one Gate per Task and stopped dep, one at a time
  const gatesOfDep = s.gates.filter(isStoppedDepGate)
  for (const t of s.tasks) {
    if ((t.status !== 'ready' && t.status !== 'pending') || t.runId === undefined || started.has(t.id)) continue
    const plan = jobById.get(planIdOf(s, t) ?? '')
    if (!plan || !isJobActive(plan)) continue
    for (const d of externalDepsOf(s, t)) {
      if (d.why !== 'stopped' && d.why !== 'gone') continue
      // a question from before the tag asked about every dep the Task had
      if (gatesOfDep.some((g) => g.taskId === t.id && (stoppedDepOf(g) ?? d.id) === d.id)) continue
      const other = d.jobId === undefined ? undefined : s.jobs.find((j) => j.id === d.jobId)
      const name = d.task ? `"${d.task.title}"${other ? ` of plan ${jobNameOf(other)}` : ''}` : d.id
      const question =
        `"${t.title}" (plan ${jobNameOf(plan)}) waits on ${name}, ${d.why === 'stopped' ? 'whose plan stopped' : 'which was cancelled'}. ` +
        `It will not come unless that plan is taken up again. Keep waiting, drop this dependency, or cancel this Task?${stoppedDepTag(d.id)}`
      const r = createGate(s, { taskId: t.id, question, options: [...STOPPED_DEP_OPTIONS] }, now)
      if (r.ok) {
        s = r.state
        gatesOfDep.push(r.state.gates[r.state.gates.length - 1])
        // the Task is blocked now: its next stopped dep is asked after this answer
        break
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

/** T11: beside `validatePlan` (planner.ts), never blocking: the plan's open overlaps with plans still planning or
 *  running, one line each (`overlapLines`), for the approval (`run-start`'s answer) and the plan page (`Job.overlaps`).
 *  Fresh from `overlapsOf`, so it does not wait for the next save. Empty when it meets none. */
export function planOverlapWarnings(s: OrchState, jobId: string): string[] {
  const job = s.jobs.find((j) => j.id === jobId)
  if (!job) return []
  const plan = new Map(s.jobs.map((j) => [j.id, j]))
  const open = overlapsOf(job, s).filter((o) => {
    const other = plan.get(o.jobId)
    if (other === undefined) return false
    const run = s.runs.filter((r) => r.jobId === other.id).sort((a, b) => a.ordinal - b.ordinal).at(-1)
    return other.pendingStart === true || outcomeOfRun(planTasksOf(s, other), run, s) === 'running'
  })
  return overlapLines(s, { ...job, overlaps: open })
}

/** At most this many Tasks of one other plan in a brief; the rest are counted. */
const BRIEF_TASKS_MAX = 40

/** The main plan of `projectKey` as text, for the planner's and the replan's brief and `astera main-plan`: the rules, then
 *  each sub-plan in run order with its name, id, state and areas. An active or queued plan lists its Tasks not completed
 *  (id, title, status, paths); a finished one is a single line. Then the links that involve an active plan. `except` (the
 *  reader's own plan) is left out. Empty when no other plan is in it. */
export function mainPlanText(s: OrchState, projectKey: string, except?: string): string {
  const plans = mainPlanOf(s, projectKey).plans.filter((p) => p.job.id !== except)
  if (plans.length === 0) return ''
  const live = new Set(plans.filter((p) => activeOrQueued(s, p.job)).map((p) => p.job.id))
  const lines = [
    'MAIN PLAN OF THIS PROJECT',
    "Your plan is a sub-plan of this project's main plan. Work another sub-plan already holds is never planned again:",
    'depend on its Task with `--deps <taskId>` (it waits until that plan delivers) or leave it out, and name it in',
    'existing.md. Plan around their files where you can.'
  ]
  for (const { job, state, tasks } of plans) {
    lines.push(`- ${jobNameOf(job)} (job ${job.id}, ${state}${job.areas?.length ? `, areas: ${job.areas.join(', ')}` : ''})`)
    if (!live.has(job.id)) continue
    const open = tasks.filter((t) => t.status !== 'completed')
    for (const t of open.slice(0, BRIEF_TASKS_MAX)) lines.push(`  - ${t.id} ${t.title} [${t.status}]: ${(t.affectedPaths ?? []).join(', ') || 'no paths given'}`)
    if (open.length > BRIEF_TASKS_MAX) lines.push(`  - … ${open.length - BRIEF_TASKS_MAX} more (astera main-plan --json)`)
  }
  for (const l of mainPlanOf(s, projectKey).links) {
    if (l.kind !== 'dep' && l.kind !== 'lease') continue
    if (!live.has(l.jobId) && !(l.otherJobId !== undefined && live.has(l.otherJobId))) continue
    lines.push(
      l.kind === 'dep'
        ? `link: ${l.taskId} waits on ${l.otherTaskId} (${l.why})`
        : `link: ${l.taskId} waits for ${l.otherTaskId} to deliver ${l.path}`
    )
  }
  return lines.join('\n')
}

/** `mainPlanText` for the project of `job`, without `job`'s own plan: what the planner's and the replan's brief carry. */
export const otherPlansBrief = (s: OrchState, job: Job): string => mainPlanText(s, projectKeyOf(s, job), job.id)

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
