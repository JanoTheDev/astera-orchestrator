// W7-A: what the talk box shows for a Job row, apart from React so it can be tested.
import type { JobRow } from '../../../../core/types'
import type { PlanFeedback } from '../../../../core/orchestration/types'
import type { CommandReply } from '../../lib/orchDoor'
import { isFinishedOutcome } from './planSummary'

export interface PlanTalkView {
  /** The box shows at all: a planned, unarchived plan. */
  show: boolean
  /** Reject is offered: only while the plan waits for approval. */
  canReject: boolean
  /** Task count for the "started automatically" notice; null when it did not. */
  autoStarted: number | null
}

// T4: the talk box works in every phase of an unarchived plan, a finished one included (jobs-feedback reopens it).
export function planTalkView(row: JobRow): PlanTalkView {
  const show = row.planned === true && row.archivedAt === undefined
  return {
    show,
    canReject: show && row.pendingStart === true,
    autoStarted: show && row.autoStartedAt !== undefined ? row.tasks.length : null
  }
}

/** T7: "Ask & plan more" (`jobs-chat`) is for a planned, unarchived plan whose Run is over. A paired Runtime's plan has no
 *  tab on this computer, so the callers also pass `local`. */
export const canAskPlanMore = (row: Pick<JobRow, 'planned' | 'archivedAt' | 'outcome' | 'schedule' | 'pendingStart'>): boolean =>
  row.planned === true && row.archivedAt === undefined && row.schedule === undefined && !row.pendingStart && isFinishedOutcome(row.outcome)

/** #116: what stands where a plan's Approve would: the button, "Planning…" (its planner is not done), "Starts by
 *  itself" (auto-approve), or nothing (not a plan waiting to start). A Run built by hand (no planner) keeps its Start. */
export type ApproveSlot = 'approve' | 'planning' | 'auto' | null

export function approveSlot(row: Pick<JobRow, 'pendingStart' | 'planned' | 'planReady' | 'autoApprove' | 'handsOff' | 'planProblems' | 'archivedAt'>): ApproveSlot {
  if (row.pendingStart !== true || row.archivedAt !== undefined) return null
  // planReady on an auto-approve plan: its own start did not go through, so it asks after all
  if (row.planned !== true || row.planReady === true) return 'approve'
  // a plan that does not hold will not start by itself, so it is still being planned; hands-off implies auto-approve
  const holds = (row.planProblems?.length ?? 0) === 0
  return holds && (row.autoApprove === true || row.handsOff === true) ? 'auto' : 'planning'
}

/** What `jobs-feedback` did with a message (plannerFeedback.ts): `sent` typed into / handed to the planner or started a
 *  replan, `queued` kept for the replan that is running, `reopened` started the final-check replan of a finished plan. */
export type FeedbackOutcome = 'sent' | 'queued' | 'reopened'

/** The outcome of an answered `jobs-feedback`. `finished`: the plan's Run was over when the message went (its row's
 *  outcome is not running/checking), so the replan that answers it is the one that reopened the plan. */
export function feedbackOutcomeOf(body: unknown, row: Pick<JobRow, 'outcome'>): FeedbackOutcome {
  const b = (body ?? {}) as { via?: unknown; mode?: unknown }
  if (b.via === 'queued') return 'queued'
  const finished = row.outcome === 'completed' || row.outcome === 'failed' || row.outcome === 'blocked'
  return b.via === undefined && b.mode === 'completion' && finished ? 'reopened' : 'sent'
}

/** The refusal of a message while the planner waits on a permission prompt or a question: answered in its own tab, so
 *  the box offers to open it instead of only saying no. */
export const plannerWaitingIn = (reply: CommandReply): boolean => {
  const error = (reply.body as { error?: unknown } | null)?.error
  return reply.status === 409 && typeof error === 'string' && error.startsWith('the planner waits on')
}

/** The mark a history entry carries: `queued` until the planner answers it (its `changes` arrive), `duringRun` for one
 *  sent while the plan ran. */
export function feedbackMark(f: Pick<PlanFeedback, 'phase' | 'queued' | 'changes'>): 'queued' | 'duringRun' | null {
  if (f.queued === true && f.changes === undefined) return 'queued'
  return f.phase === 'run' ? 'duringRun' : null
}
