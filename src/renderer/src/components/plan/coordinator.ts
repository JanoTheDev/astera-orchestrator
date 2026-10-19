// W11 Plans page: the coordinator strip, one card per live plan of the project, with what each waits on. The rules are
// core's (running.ts, view.ts's waves and boards); this only picks and words them for the card.
import type { JobRow, JobTask } from '../../../../core/types'
import { runningCount } from '../../../../core/orchestration/running'
import { jobName } from '../../lib/jobName'
import { approveSlot } from './planTalk'
import { taskColumnOf } from './planBoard'

export type LiveState = 'planning' | 'approval' | 'queued' | 'running' | 'paused' | 'needs-you' | 'failed'

/** Another plan this one waits on for files: `lease` = its Task is done but it has not delivered (T9), `files` = its Task
 *  still works there. */
export interface PlanWait {
  kind: 'lease' | 'files'
  planId: string
  plan: string
  path: string
}

export interface CoordinatorCard {
  id: string
  name: string
  state: LiveState
  /** 1-based wave being worked on and the wave count; null with no Tasks. */
  wave: { n: number; m: number } | null
  /** Workers working now (runningCount). */
  working: number
  waits: PlanWait[]
  /** The plan it is queued after (JobRow.after), while it has not started. */
  after?: { id: string; plan: string }
  /** Plans it overlaps (JobRow.overlapPlans); `decide` while it waits for approval, when the owner picks. */
  overlaps: { id: string; plan: string }[]
  decide: boolean
}

/** A plan is live while it is not archived, not a schedule template (nor a re-run Job's card of rounds) and not
 *  completed: planning, waiting for approval, queued, running, paused or failed (a failed plan still needs a person). */
export const isLive = (r: JobRow): boolean =>
  r.archivedAt === undefined && !r.schedule && (r.children?.length ?? 0) === 0 && (r.pendingStart === true || r.outcome !== 'completed')

export function waveOfPlan(tasks: readonly JobTask[]): { n: number; m: number } | null {
  if (tasks.length === 0) return null
  const m = Math.max(...tasks.map((t) => t.wave ?? 0)) + 1
  const open = tasks.filter((t) => t.status !== 'completed').map((t) => t.wave ?? 0)
  return { n: open.length ? Math.min(...open) + 1 : m, m }
}

export function stateOf(r: JobRow): LiveState {
  if (r.pendingStart) {
    if (r.after !== undefined) return 'queued'
    return approveSlot(r) === 'approve' ? 'approval' : 'planning'
  }
  if (r.paused || r.dispatchHold) return 'paused'
  if (r.outcome === 'failed') return 'failed'
  if (r.tasks.some((t) => taskColumnOf(t) === 'needs-you')) return 'needs-you'
  return 'running'
}

/** The strip's cards, in the list's order. */
export function coordinatorOf(rows: readonly JobRow[]): CoordinatorCard[] {
  const nameOf = (id: string): string => {
    const r = rows.find((x) => x.id === id)
    return r ? jobName(r) : id
  }
  return rows.filter(isLive).map((r) => {
    const waits = new Map<string, PlanWait>()
    for (const t of r.tasks) {
      const why = t.board?.reason
      if (why?.kind !== 'same-files' || !why.plan || waits.has(why.plan.id)) continue
      waits.set(why.plan.id, { kind: why.delivery ? 'lease' : 'files', planId: why.plan.id, plan: why.plan.title, path: why.path })
    }
    const overlaps = (r.overlapPlans ?? []).map((id) => ({ id, plan: nameOf(id) }))
    return {
      id: r.id,
      name: jobName(r),
      state: stateOf(r),
      wave: waveOfPlan(r.tasks),
      working: runningCount(r.tasks),
      waits: [...waits.values()],
      ...(r.after !== undefined && r.pendingStart ? { after: { id: r.after, plan: nameOf(r.after) } } : {}),
      overlaps,
      decide: r.pendingStart === true && overlaps.length > 0
    }
  })
}
