// One Task with its attempts (MCP design §3b), for the MCP get_task tool through the Host command
// `tasks-get`. The Task's own fields go through the CLI's public allowlist; the attempts carry no
// session id and no worker output.
import { TASK_PUBLIC_FIELDS } from './cliPublic'
import type { OrchState } from './state'
import type { Provider } from '../providers/meta'
import type { Outcome, RepairReason, ReviewVerdict } from './types'

export interface TaskAttempt {
  id: string
  provider: Provider
  accountId: string
  repair?: RepairReason
  review?: true
  outcome?: Outcome
  startedAt: string
  endedAt?: string
  /** This attempt's worker shows a permission prompt a person has to answer in Astera. Only on an
   *  open attempt, and only where the caller can read its session (command.ts `waitingForApprovalIn`). */
  waitingForApproval?: true
}

/** One review of the Task, one per review Dispatch, oldest first. Never the session id or the transcript path: the app
 *  opens a transcript by `id` through its own IPC (`orch.reviewTranscript`). */
export interface TaskReview {
  id: string
  provider: Provider
  accountId: string
  model?: string
  effort?: string
  startedAt: string
  endedAt?: string
  /** Absent while it runs, or when it ended without a verdict (stopped, lost). */
  verdict?: ReviewVerdict
  /** This round's issues. */
  issues: { title: string; severity: string; blocking: boolean }[]
  /** Its finished transcript can be opened: the review ended and its native session id is known. */
  transcript: boolean
}

export type TaskDetail = Record<string, unknown> & { attempts: TaskAttempt[]; reviews: TaskReview[]; openQuestionId?: string }

/** `waiting`: the ids of the Dispatches whose worker shows a permission prompt now. */
export function taskDetailOf(s: OrchState, taskId: string, waiting: ReadonlySet<string> = new Set()): TaskDetail | null {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return null
  const out: Record<string, unknown> = {}
  for (const f of TASK_PUBLIC_FIELDS) if (f in task) out[f] = (task as unknown as Record<string, unknown>)[f]
  const attempts = s.dispatches
    .filter((d) => d.taskId === taskId)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(
      (d): TaskAttempt => ({
        id: d.id,
        provider: d.provider,
        accountId: d.accountId,
        ...(d.repair !== undefined ? { repair: d.repair } : {}),
        ...(d.review === true ? { review: true as const } : {}),
        ...(d.outcome !== undefined ? { outcome: d.outcome } : {}),
        startedAt: d.startedAt,
        ...(d.endedAt !== undefined ? { endedAt: d.endedAt } : {}),
        ...(waiting.has(d.id) ? { waitingForApproval: true as const } : {})
      })
    )
  const reviews = s.dispatches
    .filter((d) => d.taskId === taskId && d.review === true)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map(
      (d): TaskReview => ({
        id: d.id,
        provider: d.provider,
        accountId: d.accountId,
        ...(d.model !== undefined ? { model: d.model } : {}),
        ...(d.effort !== undefined ? { effort: d.effort } : {}),
        startedAt: d.startedAt,
        ...(d.endedAt !== undefined ? { endedAt: d.endedAt } : {}),
        ...(d.verdict !== undefined ? { verdict: d.verdict } : {}),
        issues: (d.reviewIssues ?? []).map((i) => ({ title: i.title, severity: i.severity, blocking: i.blocking })),
        transcript: d.endedAt !== undefined && d.nativeSessionId !== undefined
      })
    )
  const open = s.gates.find((g) => g.taskId === taskId && g.status === 'open')
  return { ...out, attempts, reviews, ...(open ? { openQuestionId: open.id } : {}) }
}

/** The history entry id (`accountId:sessionId`, what `history.preview` takes) of a finished review's transcript, else
 *  null: not a review, still running, or its native session id was never learned. The renderer names a Dispatch, never a path. */
export function reviewTranscriptEntryId(s: OrchState, dispatchId: string): string | null {
  const d = s.dispatches.find((x) => x.id === dispatchId)
  return d?.review === true && d.endedAt !== undefined && d.nativeSessionId !== undefined ? `${d.accountId}:${d.nativeSessionId}` : null
}
