// T14 Coordinator strip (Plans page): every live plan of the project side by side, with what each waits on. Pure, so the
// node-only test suite reaches it; Coordinator.tsx draws it. Data only from the snapshot (JobRow, JobTask.board.reason).
import type { JobRow } from '../../../../core/types'
import { runningCount } from '../../../../core/orchestration/running'
import { jobName } from '../../lib/jobName'
import { planListOrder } from './planBoard'
import { planStatusOf, type PlanStatus } from './planList'

/** One thing a plan waits on: files another plan holds (its lease), the plan it is queued after, or an overlap a person
 *  should decide on. `plan` is that plan's name; an overlap read only from `JobRow.overlaps` lines has none. */
export type CoordWait =
  | { kind: 'lease'; plan: string; path: string }
  | { kind: 'after'; plan: string; stopped?: true }
  | { kind: 'overlap'; plan?: string; lines: string[] }

export interface CoordCard {
  id: string
  name: string
  status: PlanStatus
  wave?: { at: number; of: number }
  /** Tasks with work running now (running.ts runningCount). */
  workers: number
  waits: CoordWait[]
}

/** Live: not archived, not finished, and not a schedule template (it never runs itself; its rounds are its children). */
export const isLivePlan = (row: JobRow): boolean =>
  row.archivedAt === undefined && (row.outcome === 'running' || row.outcome === 'checking') && !row.schedule

export function coordinatorOf(rows: readonly JobRow[]): CoordCard[] {
  const nameOf = (id: string, fallback: string): string => {
    const r = rows.find((x) => x.id === id)
    return r ? jobName(r) : fallback
  }
  return planListOrder(rows.filter(isLivePlan)).map((row) => {
    const waits: CoordWait[] = []
    const seen = new Set<string>()
    const add = (key: string, w: CoordWait): void => {
      if (seen.has(key)) return
      seen.add(key)
      waits.push(w)
    }
    for (const task of row.tasks) {
      const r = task.board?.reason
      if (r?.kind === 'same-files' && (r.plan || r.delivery)) {
        // another plan's Task holds the files, or its plan has not delivered them yet (T9 lease)
        const id = r.plan?.id ?? r.waitingOn.id
        add(`lease:${id}`, { kind: 'lease', plan: r.plan ? nameOf(r.plan.id, r.plan.title) : r.waitingOn.title, path: r.path })
      } else if (r?.kind === 'pending-start' && r.after) {
        add(`after:${r.after.id}`, { kind: 'after', plan: nameOf(r.after.id, r.after.title), ...(r.after.stopped ? { stopped: true as const } : {}) })
      }
    }
    if (row.after !== undefined && row.pendingStart) add(`after:${row.after}`, { kind: 'after', plan: nameOf(row.after, row.after) })
    const lines = row.overlaps ?? []
    for (const id of row.overlapPlans ?? []) add(`overlap:${id}`, { kind: 'overlap', plan: nameOf(id, id), lines })
    if ((row.overlapPlans ?? []).length === 0 && lines.length > 0) waits.push({ kind: 'overlap', lines })
    return {
      id: row.id,
      name: jobName(row),
      status: planStatusOf(row),
      ...(row.wave ? { wave: row.wave } : {}),
      workers: runningCount(row.tasks),
      waits
    }
  })
}
