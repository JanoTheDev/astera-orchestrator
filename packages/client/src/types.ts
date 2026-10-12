// The public DTOs: what the client's typed methods return, in the public shape the CLI prints (fields.ts). The app
// checks at compile time that its own objects fit these (src/core/orchestration/publicTypes.ts), so a field added,
// renamed or retyped on either side breaks its typecheck. Answers the app builds as plain records (the Job and Run
// views' derived fields, wait endings, a stop's answer) are defined here and pinned by tests.

export type Provider = 'claude' | 'codex'
export type TaskStatus = 'pending' | 'ready' | 'dispatched' | 'validating' | 'reviewing' | 'completed' | 'failed' | 'blocked'
export type Outcome = 'succeeded' | 'failed'
export type MessageType = 'status' | 'worker_done' | 'question' | 'escalation' | 'heartbeat' | 'decision_gate'
export type RepairReason = 'check-failure' | 'review-failure'
export type GateKind = 'convergence-exhausted' | 'convergence-blocked'
export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** When a scheduled Job fires again. */
export type ScheduleRule =
  | { readonly kind: 'interval'; readonly minutes: number }
  | { readonly kind: 'daily'; readonly time: string }
  | { readonly kind: 'weekly'; readonly weekdays: readonly number[]; readonly time: string }
  | { readonly kind: 'monthly'; readonly days: readonly number[]; readonly time: string }

/** Repair and recheck a failing Task within these bounds. Present (even empty) means on. */
export interface ConvergencePolicy {
  readonly maxFixAttempts?: number
  readonly maxReviewRounds?: number
  readonly blockingSeverity?: 'high' | 'medium'
  readonly maxTotalMinutes?: number
}

export interface GitRange {
  readonly base?: string
  readonly head?: string
}

export interface Progress {
  /** Tasks completed. */
  readonly done: number
  readonly total: number
}

/** How a Job stands: `pending` before its first Run, `paused` when its latest Run is. */
export type JobOutcome = 'running' | 'completed' | 'failed' | 'paused' | 'pending'
export type RunOutcome = 'running' | 'completed' | 'failed' | 'paused'

export interface Project {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly addedAt: string
}

export interface Job {
  readonly id: string
  readonly objective: string
  readonly cwd: string
  readonly projectId?: string
  readonly createdAt: string
  readonly concurrency?: number
  readonly coordinatorAccountId?: string
  readonly autoDispatch?: boolean
  readonly schedule?: ScheduleRule
  readonly fireCount?: number
  readonly pendingStart?: boolean
  readonly paused?: boolean
  readonly convergence?: ConvergencePolicy
  /** Derived on every read: how the Job's latest Run (or the Job itself before one) stands. */
  readonly outcome: JobOutcome
  readonly progress: Progress
  readonly questionsOpen: number
}

export interface Run {
  readonly id: string
  readonly jobId: string
  /** From 1: the Job's first Run is 1. */
  readonly ordinal: number
  readonly createdAt: string
  readonly coordinatorSessionId?: string
  /** The folder the Run works in, when it has its own worktree. */
  readonly worktree?: string
  readonly git?: GitRange
  readonly paused?: boolean
  readonly autoDispatch?: boolean
  readonly outcome: RunOutcome
  readonly progress: Progress
  readonly questionsOpen: number
  /** `runs.get` only, and only above zero: Tasks whose worker shows a permission prompt. */
  readonly waitingForApproval?: number
}

/** `jobs.get`: the Job, with the Run it names or its latest folded in. */
export type JobWithRun = Job & { readonly run?: Run }

export interface CheckResult {
  readonly configId: string
  readonly name: string
  readonly status: 'passed' | 'failed' | 'timed-out' | 'not-run'
  readonly exitCode?: number
  /** The last 4000 characters of the check's output. */
  readonly outputTail?: string
  readonly startedAt?: string
  readonly endedAt?: string
  readonly unstable?: true
}

export interface ReviewIssue {
  readonly id: string
  readonly severity: ReviewSeverity
  readonly blocking: boolean
  readonly title: string
  readonly description: string
  readonly file?: string
  readonly line?: number
  readonly suggestedFix?: string
}

export interface Task {
  readonly id: string
  /** Exactly one of `runId` (a Run's Task) and `jobId` (a Job's definition Task). */
  readonly runId?: string
  readonly jobId?: string
  readonly title: string
  readonly spec: string
  readonly deps: readonly string[]
  readonly parentId?: string
  readonly status: TaskStatus
  readonly result?: string
  readonly filesModified?: readonly string[]
  readonly accountIds?: readonly string[]
  readonly validateConfigId?: string
  readonly validateConfigIds?: readonly string[]
  readonly checks?: readonly CheckResult[]
  readonly reviewIssues?: readonly ReviewIssue[]
  /** A person's decision to pass the Task over its checks. */
  readonly completionOverride?: { readonly reason: string; readonly at: string }
  readonly consecutiveFailures: number
  readonly createdAt: string
  readonly updatedAt: string
  /** `tasks.list({ brief: true })` only: the spec was cut to 160 characters. */
  readonly spec_truncated?: boolean
}

/** One worker attempt at a Task. */
export interface TaskAttempt {
  readonly id: string
  readonly provider: Provider
  readonly accountId: string
  readonly repair?: RepairReason
  readonly review?: true
  readonly outcome?: Outcome
  readonly startedAt: string
  readonly endedAt?: string
  readonly waitingForApproval?: true
}

/** `tasks.get`: the Task with its attempts and the question it waits on, if any. */
export type TaskDetail = Omit<Task, 'spec_truncated'> & {
  readonly attempts: readonly TaskAttempt[]
  readonly openQuestionId?: string
}

/** A question for a person (a gate). */
export interface Question {
  readonly id: string
  readonly runId: string
  readonly taskId: string
  readonly question: string
  readonly options?: readonly string[]
  readonly kind?: GateKind
  readonly status: 'open' | 'resolved'
  readonly resolution?: string
  readonly createdAt: string
  readonly resolvedAt?: string
}

/** `questions.answer`: the resolved question; `retryOnceFailed` says why a "retry once" answer could not start. */
export type AnsweredQuestion = Question & { readonly retryOnceFailed?: string }

export type CompletionState =
  | 'not-started'
  | 'checking'
  | 'rechecking'
  | 'reviewing'
  | 'working'
  | 'fixing'
  | 'fixing-review'
  | 'waiting-for-user'
  | 'exhausted'
  | 'converged'
  | 'failed'

export interface CompletionCheckDetail {
  readonly configId: string
  readonly name: string
  readonly status: 'passed' | 'failed' | 'timed-out' | 'not-run'
  readonly exitCode?: number
  readonly outputTail?: string
  readonly unstable?: true
}

export interface CompletionDetail {
  readonly taskId: string
  readonly checks: readonly CompletionCheckDetail[]
  readonly blockingIssues: readonly ReviewIssue[]
  readonly otherIssueCount: number
  readonly suspiciousFiles: readonly string[]
  readonly policyChanged: boolean
}

export interface TaskCompletion {
  readonly taskId: string
  readonly title: string
  readonly state: CompletionState
  readonly attempt: number
  /** The policy's repair budget; null without convergence. */
  readonly maxAttempts: number | null
  readonly detail: CompletionDetail | null
  readonly failureSummary: string | null
  readonly lastFailure: string | null
}

/** `completion.get`: where each Task of a Run stands on its way to done. */
export interface RunCompletion {
  readonly runId: string
  readonly jobId: string
  readonly state: CompletionState
  readonly tasks: readonly TaskCompletion[]
}

export type RunEventKind =
  | 'run-created'
  | 'task-created'
  | 'dispatch-started'
  | 'message'
  | 'gate-opened'
  | 'gate-resolved'
  | 'limit-hit'
  | 'resumed'
  | 'runtime-lost'
  | 'recovery'

/** One event of a Run's timeline, as `runs.follow` yields it. */
export interface RunEvent {
  readonly at: string
  readonly kind: RunEventKind
  /** Unique within `kind`. */
  readonly sourceId: string
  readonly taskId?: string
  readonly taskTitle?: string
  readonly messageType?: MessageType
  readonly summary: string
  readonly outcome?: Outcome
  readonly provider?: Provider
  readonly retry?: boolean
  readonly review?: boolean
  readonly repair?: RepairReason
}

interface WaitBase {
  readonly runId: string
  readonly jobId: string
  readonly progress: Progress
}

/** Where a wait ends: the work is done (`completed`, `failed`), or it needs a person (`waiting` on a question,
 *  `paused`), or every worker waits for a usage limit to reset (`limited`). Data, not an error. */
export type WaitEnding =
  | (WaitBase & { readonly state: 'waiting'; readonly questionId: string; readonly taskId: string })
  | (WaitBase & { readonly state: 'paused' })
  | (WaitBase & { readonly state: 'limited'; readonly resetsAt: string })
  | (WaitBase & { readonly state: 'completed' | 'failed' })

/** The Host's deadline passed first. `runId` is null when a Job had no Run yet. */
export interface WaitTimeout {
  readonly state: 'timeout'
  readonly jobId: string | undefined
  readonly runId: string | null
  readonly progress: Progress
}

export type WaitResult = WaitEnding | WaitTimeout

/** `runs.stop`: workers released and the Run paused (`runs.resume` takes it back). */
export interface StopResult {
  readonly runId: string
  readonly stopped: number
  readonly paused: true
  readonly coordinatorStopped: boolean
}

/** A list. The Host answers whole lists today, so `nextCursor` is not set yet; the shape is ready for paging. */
export interface ListResult<T> {
  readonly items: readonly T[]
  readonly nextCursor?: string
}
