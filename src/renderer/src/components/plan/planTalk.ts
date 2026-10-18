// W7-A: what the talk box shows for a Job row, apart from React so it can be tested.
import type { JobRow } from '../../../../core/types'

export interface PlanTalkView {
  /** The box shows at all: a planned, unarchived plan. */
  show: boolean
  /** Reject is offered: only while the plan waits for approval. */
  canReject: boolean
  /** Task count for the "started automatically" notice; null when it did not. */
  autoStarted: number | null
}

export function planTalkView(row: JobRow): PlanTalkView {
  const show = row.planned === true && row.archivedAt === undefined
  return {
    show,
    canReject: show && row.pendingStart === true,
    autoStarted: show && row.autoStartedAt !== undefined ? row.tasks.length : null
  }
}
