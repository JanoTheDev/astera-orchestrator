// Main plan tab: which PlanActs a plan row may use, by the plan's state (the same rules as PlansView's tree menu).
// Pure, so the node-only suite reaches it; MainPlan.tsx draws the menu.
import type { JobRow } from '../../../../core/types'
import type { PlanActs } from './PlanRow'
import { pauseActionOf } from './planTree'
import { approveSlot } from './planTalk'

export type PlanActionId = 'approve' | 'pause' | 'resume' | 'hold' | 'release' | 'restartCoordinator' | 'archive' | 'unarchive' | 'delete'

type ActRow = Pick<JobRow, 'pendingStart' | 'planned' | 'planReady' | 'autoApprove' | 'handsOff' | 'planProblems' | 'archivedAt' | 'schedule' | 'paused' | 'dispatchHold' | 'holdBy' | 'outcome' | 'coordinatorMissing'>

/** The actions `row` offers, in menu order; one `acts` leaves unwired is not offered. Delete and archive confirm in lib/jobActions. */
// Not planHeaderActions.planActionsOf: that maps state to header/tree flags; this one maps state and the wired handlers to a row menu.
export function rowMenuActionsOf(row: ActRow, acts: Pick<PlanActs, 'onApprove' | 'onPause' | 'onResume' | 'onHold' | 'onRestartCoordinator' | 'onArchive' | 'onUnarchive' | 'onDelete'>): PlanActionId[] {
  const pause = pauseActionOf(row as JobRow)
  const archived = row.archivedAt !== undefined
  const out: Array<PlanActionId | false> = [
    approveSlot(row) === 'approve' && !!acts.onApprove && 'approve',
    pause === 'pause-schedule' && !!acts.onPause && 'pause',
    pause === 'resume-schedule' && !!acts.onResume && 'resume',
    pause === 'hold' && !!acts.onHold && 'hold',
    pause === 'release' && !!acts.onHold && 'release',
    row.coordinatorMissing === true && !!acts.onRestartCoordinator && 'restartCoordinator',
    !archived && !!acts.onArchive && 'archive',
    archived && !!acts.onUnarchive && 'unarchive',
    !!acts.onDelete && 'delete'
  ]
  return out.filter((id): id is PlanActionId => id !== false)
}
