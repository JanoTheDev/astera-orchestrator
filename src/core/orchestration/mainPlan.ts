// T1 the main plan: one per project, derived, never stored.
//
// The owner reads every plan of a repository as one plan: each Job is a sub-plan of its project's main plan
// (`projectKeyOf`), in the order they run (`planOutranks`, then `Job.after`: a plan queued after another comes after it).
// Nothing here is persisted, so there is nothing to migrate and nothing to drift from the Jobs.
//
// **Cross-plan deps.** A Task's `deps` may name a Task of another active or queued plan of the same project. That dep is
// met only once the other Task is completed AND its plan delivered (`afterStandOf` 'delivered'): only then is its code on
// the branch this worker forks from. `holdExternalDeps` keeps the waiting Task pending until then; overlap.ts
// `coordinate` asks the owner when the other plan stops or the Task is gone.
//
// Pure, and web-safe (the renderer reads `mainPlanOf`): only types and pure helpers, like after.ts.
import type { Gate, Job, PlanOverlap, Task } from './types'
import type { RunOutcome } from '../types'
import type { OrchState } from './state'
import { afterStandOf } from './after'
import { isJobActive } from './lifecycle'
import { outcomeOfTasks } from './running'
import { leasesByProject, planOutranks, projectKeyOf, sameFilesAs } from './schedule'
import { isDuplicateGate } from './overlap'

/** A plan's Tasks as they stand: its latest Run's, else (not started) its definition Tasks (a cancelled Task is removed). */
export function planTasksOf(s: OrchState, job: Job): Task[] {
  const run = s.runs.filter((r) => r.jobId === job.id).sort((a, b) => a.ordinal - b.ordinal).at(-1)
  return s.tasks.filter((t) => (run ? t.runId === run.id : t.jobId === job.id))
}

/** A plan that may still do work: not archived, and either not started (queued, awaiting approval) or still running. */
export const activeOrQueued = (s: OrchState, job: Job): boolean =>
  isJobActive(job) && (job.pendingStart === true || outcomeOfTasks(planTasksOf(s, job)) === 'running')

/** The other plans of `job`'s project (`projectKeyOf`) that are not archived. `finished` too: the briefs read what they
 *  built; the overlap check only the active and queued ones. */
export function otherPlansOf(s: OrchState, job: Job, o: { finished?: boolean } = {}): Job[] {
  const key = projectKeyOf(s, job)
  return s.jobs.filter(
    (j) => j.id !== job.id && projectKeyOf(s, j) === key && isJobActive(j) && (o.finished === true || activeOrQueued(s, j))
  )
}

/** The plan (Job id) a Task belongs to: its own `jobId` (a definition Task), else its Run's. */
export const planIdOf = (s: Pick<OrchState, 'runs'>, t: Pick<Task, 'jobId' | 'runId'>): string | undefined =>
  t.jobId ?? s.runs.find((r) => r.id === t.runId)?.jobId

/** Where a cross-plan dep stands: met (`delivered`), still coming (`not completed`, `not delivered`), or never coming
 *  (`stopped`: its plan stopped; `gone`: the Task was cancelled or removed). */
export type ExternalDepWhy = 'delivered' | 'not completed' | 'not delivered' | 'stopped' | 'gone'

/** One dep of a Task on a Task of another plan. */
export interface ExternalDep {
  id: string
  task?: Task
  jobId?: string
  satisfied: boolean
  why: ExternalDepWhy
}

/** `task`'s deps outside its own plan, each with where it stands. A dep that names no Task is one that was removed. */
export function externalDepsOf(s: OrchState, task: Task): ExternalDep[] {
  const mine = planIdOf(s, task)
  const out: ExternalDep[] = []
  for (const id of task.deps) {
    const dep = s.tasks.find((t) => t.id === id)
    if (!dep) {
      out.push({ id, satisfied: false, why: 'gone' })
      continue
    }
    const jobId = planIdOf(s, dep)
    if (jobId === mine) continue
    const job = s.jobs.find((j) => j.id === jobId)
    // a Task of an earlier Run of its plan that never completed: nothing will complete it now
    const current = job !== undefined && planTasksOf(s, job).some((t) => t.id === id)
    const stand = jobId === undefined ? 'stopped' : afterStandOf(s, jobId)
    const why: ExternalDepWhy =
      dep.status === 'completed' && stand === 'delivered'
        ? 'delivered'
        : !current && dep.status !== 'completed'
          ? 'gone'
          : stand === 'stopped'
            ? 'stopped'
            : dep.status === 'completed'
              ? 'not delivered'
              : 'not completed'
    out.push({ id, task: dep, jobId, satisfied: why === 'delivered', why })
  }
  return out
}

/** Why plan `jobId`'s Task may not wait on `dep`, a Task of another plan, or undefined when it may (or `dep` is of the
 *  same plan, which the caller checks). Same project only, a plan not archived, a current Task of that plan, and one that
 *  can still complete. */
export function crossPlanDepRefusal(s: OrchState, jobId: string | undefined, dep: Task): string | undefined {
  const otherId = planIdOf(s, dep)
  if (otherId === jobId) return undefined
  const mine = s.jobs.find((j) => j.id === jobId)
  const other = s.jobs.find((j) => j.id === otherId)
  if (!mine || !other) return `${dep.id} is not a Task of a plan: a Task waits only on Tasks of the plans of its project`
  const name = `${dep.id} (${dep.title})`
  if (projectKeyOf(s, other) !== projectKeyOf(s, mine))
    return `${name} is a Task of plan ${other.id} of another project: a Task waits only on Tasks of its own project's plans`
  if (!isJobActive(other)) return `${name} is a Task of plan ${other.id}, which is archived: it will not deliver`
  if (!planTasksOf(s, other).some((t) => t.id === dep.id))
    return `${name} is not a current Task of plan ${other.id} (an earlier Run's): name its Task in the plan's latest Run`
  if (!activeOrQueued(s, other) && dep.status !== 'completed')
    return `${name} is a Task of plan ${other.id}, which has finished without completing it: nothing will complete it`
  return undefined
}

/** Whether `taskId` waits on itself through its deps, followed across every plan (a cycle of two plans too). */
export function waitsOnItself(tasks: readonly Pick<Task, 'id' | 'deps'>[], taskId: string): boolean {
  const deps = new Map(tasks.map((t) => [t.id, t.deps]))
  const seen = new Set<string>()
  const stack = [...(deps.get(taskId) ?? [])]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (id === taskId) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(deps.get(id) ?? []))
  }
  return false
}

/** `s` with the ready rule across plans: a not-started pending Task whose deps are all met (its own plan's completed, another
 *  plan's completed and delivered) turns ready; a ready one with another plan's dep not met goes back to pending. The same
 *  state back when nothing moves. Every Host commit runs it (overlap.ts `refreshOverlaps`), so a delivery readies its
 *  waiters; state.ts runs it after `recomputeReady`, which counts any completed Task. */
export function holdExternalDeps(s: OrchState): OrchState {
  const done = new Set(s.tasks.filter((t) => t.status === 'completed').map((t) => t.id))
  let changed = false
  const tasks = s.tasks.map((t) => {
    if ((t.status !== 'pending' && t.status !== 'ready') || t.deps.length === 0) return t
    const external = externalDepsOf(s, t)
    const externalIds = new Set(external.map((d) => d.id))
    const met = external.every((d) => d.satisfied) && t.deps.every((d) => externalIds.has(d) || done.has(d))
    if (t.status === 'pending' && met) {
      changed = true
      return { ...t, status: 'ready' as const }
    }
    if (t.status === 'ready' && !met && external.length > 0 && !s.dispatches.some((d) => d.taskId === t.id)) {
      changed = true
      return { ...t, status: 'pending' as const }
    }
    return t
  })
  return changed ? { ...s, tasks } : s
}

/** A sub-plan of the main plan: a Job, where it stands (`not started` until approved) and its Tasks (`planTasksOf`). */
export interface SubPlan {
  job: Job
  state: 'not started' | RunOutcome
  tasks: Task[]
}

/** Where two sub-plans meet. `dep`: a Task waits on another plan's Task (`externalDepsOf`). `lease`: a not-started Task
 *  waits for files another plan holds until it delivers (schedule.ts `leasesByProject`). `duplicate`: a Task held, or
 *  once held, as a possible duplicate of another plan's (overlap.ts `isDuplicateGate`). `overlap`: `Job.overlaps`. */
export type MainPlanLink =
  | { kind: 'dep'; jobId: string; taskId: string; otherJobId?: string; otherTaskId: string; satisfied: boolean; why: ExternalDepWhy }
  | { kind: 'lease'; jobId: string; taskId: string; otherJobId: string; otherTaskId: string; path: string }
  | { kind: 'duplicate'; jobId: string; taskId: string; gateId: string; status: Gate['status']; resolution?: string }
  | { kind: 'overlap'; jobId: string; overlap: PlanOverlap }

/** One project's main plan. */
export interface MainPlan {
  projectKey: string
  plans: SubPlan[]
  links: MainPlanLink[]
}

/** The project's plans in the order they run: `planOutranks` first, then a plan queued after another (`Job.after`) right
 *  after the latest of it. */
function runOrder(jobs: Job[]): Job[] {
  const rest = [...jobs].sort((a, b) => (planOutranks(a, b) ? -1 : planOutranks(b, a) ? 1 : 0))
  const out: Job[] = []
  while (rest.length > 0) {
    // the first plan whose predecessor is not still to place; a chain never loops (after.ts `afterRefusal`), the guard is for a hand-edited file
    const i = Math.max(0, rest.findIndex((j) => !rest.some((o) => o.id === j.after)))
    out.push(...rest.splice(i, 1))
  }
  return out
}

/** The main plan of `projectKey` (`projectKeyOf`): its not-archived Jobs as sub-plans in run order, and the links
 *  between them. */
export function mainPlanOf(s: OrchState, projectKey: string): MainPlan {
  const jobs = runOrder(s.jobs.filter((j) => isJobActive(j) && projectKeyOf(s, j) === projectKey))
  const plans = jobs.map((job): SubPlan => {
    const tasks = planTasksOf(s, job)
    return { job, state: job.pendingStart === true ? 'not started' : outcomeOfTasks(tasks), tasks }
  })
  const links: MainPlanLink[] = []
  const leases = leasesByProject(s).get(projectKey) ?? []
  for (const { job, tasks } of plans) {
    for (const t of tasks) {
      for (const d of externalDepsOf(s, t))
        links.push({ kind: 'dep', jobId: job.id, taskId: t.id, otherJobId: d.jobId, otherTaskId: d.id, satisfied: d.satisfied, why: d.why })
      if ((t.status === 'pending' || t.status === 'ready') && t.runId !== undefined) {
        const clash = sameFilesAs(t, leases)
        if (clash?.task.lease)
          links.push({ kind: 'lease', jobId: job.id, taskId: t.id, otherJobId: clash.task.lease.jobId, otherTaskId: clash.task.id, path: clash.path })
      }
      for (const g of s.gates)
        if (g.taskId === t.id && isDuplicateGate(g))
          links.push({ kind: 'duplicate', jobId: job.id, taskId: t.id, gateId: g.id, status: g.status, ...(g.resolution !== undefined ? { resolution: g.resolution } : {}) })
    }
    for (const o of job.overlaps ?? []) links.push({ kind: 'overlap', jobId: job.id, overlap: o })
  }
  return { projectKey, plans, links }
}
