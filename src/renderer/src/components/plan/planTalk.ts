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

/** #116: what stands where a plan's Approve would: the button, "Planning…" (its planner is not done), "Starts by
 *  itself" (auto-approve), or nothing (not a plan waiting to start). A Run built by hand (no planner) keeps its Start. */
export type ApproveSlot = 'approve' | 'planning' | 'auto' | null

export function approveSlot(row: Pick<JobRow, 'pendingStart' | 'planned' | 'planReady' | 'autoApprove' | 'archivedAt'>): ApproveSlot {
  if (row.pendingStart !== true || row.archivedAt !== undefined) return null
  // planReady on an auto-approve plan: its own start did not go through, so it asks after all
  if (row.planned !== true || row.planReady === true) return 'approve'
  return row.autoApprove === true ? 'auto' : 'planning'
}
