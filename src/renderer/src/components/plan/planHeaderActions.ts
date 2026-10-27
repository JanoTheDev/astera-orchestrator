// T3 plan page header: which buttons stand visible by the plan's state. A plan that runs or waits keeps Approve,
// Pause/Resume and Open consoles; a finished plan shows Open PR (or its branch), Archive (or Unarchive) and Copy plan ID.
// The rare actions stay in the ⋯ menu. Exactly one of them is the filled primary. Pure, so the node-only suite reaches it.
import type { JobRow } from '../../../../core/types'
import { approveViewOf } from './planPage'
import { isFinishedOutcome } from './planSummary'
import { runningCount } from '../../../../core/orchestration/running'
import { isUnmergedPlan } from './planList'
import { canChat, planTalkView } from './planTalk'

export type HeaderRow = Pick<
  JobRow,
  'outcome' | 'archivedAt' | 'pendingStart' | 'schedule' | 'pr' | 'planned' | 'planReady' | 'autoApprove' | 'handsOff' | 'planProblems' | 'tasks'
>

export interface HeaderActions {
  /** The finished-state group (Open PR, Archive, Copy ID) replaces Open consoles, which moves into ⋯. */
  finished: boolean
  approve: boolean
  /** Open consoles as a visible button; otherwise it is a ⋯ item. */
  consoles: boolean
  /** Chat (`jobs-chat-ensure`): a planned, unarchived plan of this computer, in any phase. The finished state's primary. */
  askMore: boolean
  /** The PR opens in the browser; a branch (a project with no remote) copies its name. */
  openPr?: { kind: 'pr'; url: string } | { kind: 'branch'; branch: string }
  /** Archive or Unarchive as a visible button (this computer's plans only); otherwise it stays in ⋯. */
  archive?: 'archive' | 'unarchive'
  /** Copy plan ID: offered in every state (the finished group shows it as a button, otherwise it is a ⋯ item). */
  copyId: boolean
  /** The one filled primary button. */
  primary: 'approve' | 'askMore' | 'openPr' | 'archive' | null
}

/** `local`: a plan of this computer, not a paired Runtime's (lifecycle actions are this computer's only). */
export function headerActionsOf(row: HeaderRow | undefined, local: boolean): HeaderActions {
  if (!row) return { finished: false, approve: false, consoles: true, askMore: false, copyId: true, primary: null }
  const approve = approveViewOf(row).show
  // a schedule template never finishes, and a plan not started yet waits, whatever its outcome reads
  const finished = row.schedule === undefined && !row.pendingStart && (row.archivedAt !== undefined || isFinishedOutcome(row.outcome))
  const askMore = local && canChat(row)
  if (!finished) return { finished: false, approve, consoles: true, askMore, copyId: true, primary: approve ? 'approve' : null }
  const pr = row.pr
  const openPr: HeaderActions['openPr'] = pr?.url
    ? { kind: 'pr', url: pr.url }
    : pr?.branch !== undefined
      ? { kind: 'branch', branch: pr.branch }
      : undefined
  const archive: HeaderActions['archive'] = !local ? undefined : row.archivedAt !== undefined ? 'unarchive' : 'archive'
  return {
    finished: true,
    approve: false,
    consoles: false,
    askMore,
    ...(openPr ? { openPr } : {}),
    ...(archive ? { archive } : {}),
    copyId: true,
    primary: askMore ? 'askMore' : openPr?.kind === 'pr' ? 'openPr' : archive ? 'archive' : null
  }
}

export type PlanActionRow = HeaderRow & Pick<JobRow, 'coordinatorMissing' | 'worktrees' | 'paused' | 'dispatchHold' | 'awaitingReview'>

/** Every plan-level action the row's state allows, read by the plan page header and the Plans tree menu alike. */
export interface PlanActions {
  rename: boolean
  /** Copy plan ID: every state. */
  copyId: true
  /** Stop (`runs-stop`): workers are running. */
  stop: boolean
  /** Reject sits beside Approve while the plan waits to start. */
  reject: boolean
  /** A live coordinator can be replaced by a fresh one (`run-coordinator-refresh`). */
  refreshLead: boolean
  /** A plan that lost its coordinator gets one back (`run-start`). */
  restartLead: boolean
  /** The workers' worktrees go into the project folder (`run-merge`). */
  merge: boolean
  /** Every worktree into the plan branch, an agent fixes conflicts (`run-integrate-all`). */
  mergeAll: boolean
  /** The plan's pull request, or its branch when the project has no remote: any state that has one. */
  openPr?: NonNullable<HeaderActions['openPr']>
  /** Merge PR (`run-pr-merge`): the PR is ready (not a draft), not landed on GitHub, and the plan is not archived. */
  mergePr?: { number?: number; url: string }
  /** Mark as merged (`run-mark-merged`): the plan is Unmerged and the owner merged it where git cannot see it. This computer's plans only. */
  markMerged: boolean
  /** The plan has an integration folder to reveal or open a terminal in (the caller finds it). */
  folder: boolean
}

export function planActionsOf(row: PlanActionRow, local: boolean): PlanActions {
  const worktrees = (row.worktrees ?? []).length > 0
  const archived = row.archivedAt !== undefined
  const notStarted = row.pendingStart === true
  const pr = row.pr
  const openPr: PlanActions['openPr'] = pr?.url ? { kind: 'pr', url: pr.url } : pr?.branch !== undefined ? { kind: 'branch', branch: pr.branch } : undefined
  const mergePr: PlanActions['mergePr'] =
    pr?.url && pr.draft !== true && pr.landed === undefined && !archived ? { url: pr.url, ...(pr.number !== undefined ? { number: pr.number } : {}) } : undefined
  const live = local && row.schedule === undefined && !archived && !notStarted && row.outcome === 'running' && row.coordinatorMissing !== true && row.paused !== true
  return {
    rename: local,
    copyId: true,
    stop: runningCount(row.tasks) > 0,
    reject: local && planTalkView(row as JobRow).canReject,
    refreshLead: live,
    restartLead: local && row.coordinatorMissing === true,
    merge: row.schedule === undefined && worktrees,
    mergeAll: !archived && !notStarted && worktrees,
    ...(openPr ? { openPr } : {}),
    ...(mergePr ? { mergePr } : {}),
    markMerged: local && isUnmergedPlan(row as JobRow),
    folder: worktrees
  }
}
