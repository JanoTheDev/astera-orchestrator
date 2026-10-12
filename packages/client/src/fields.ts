// The fields the public surface publishes (public CLI design §11): the CLI, its MCP server and the SDK print these
// and nothing else.
//
// **An allowlist, never a blocklist.** A blocklist is the list of leaks someone already thought of, and every field
// added after it walks straight past. What these lists really do is pin the edge of the public API: without them, a
// field added to the app's state would silently become public, and removing it later would break someone's script.
//
// The app checks at compile time that every field of its internal objects is either here or on its own list of
// fields it deliberately keeps back (src/core/orchestration/cliPublic.ts), so a list cannot fall behind unnoticed.

export const PROJECT_FIELDS = ['id', 'path', 'name', 'addedAt'] as const

/**
 * The three fields that say how a Job or a Run stands. They are not stored: the Host derives them on every read
 * (a Job and a Run have no status of their own; the status is in their Tasks).
 */
export const DERIVED_FIELDS = ['outcome', 'progress', 'questionsOpen'] as const

export const JOB_FIELDS = [
  'id',
  'objective',
  'cwd',
  'projectId',
  'createdAt',
  'concurrency',
  'coordinatorAccountId',
  'autoDispatch',
  'schedule',
  'fireCount',
  'pendingStart',
  'paused',
  'convergence'
] as const

export const RUN_FIELDS = [
  'id',
  'jobId',
  'ordinal',
  'createdAt',
  'coordinatorSessionId',
  'worktree',
  // The git range its changed files are read over.
  'git',
  'paused',
  // Public like the Job's own: a script can read who places this Run.
  'autoDispatch'
] as const

export const TASK_FIELDS = [
  'id',
  'runId',
  'jobId',
  'title',
  'spec',
  'deps',
  'parentId',
  'status',
  'result',
  'filesModified',
  'accountIds',
  'validateConfigId',
  'validateConfigIds',
  'checks',
  'reviewIssues',
  // Not bookkeeping but a decision a person made: where a watcher asks "why did this pass".
  'completionOverride',
  'consecutiveFailures',
  'createdAt',
  'updatedAt'
] as const

/** A question for a person (a gate). */
export const QUESTION_FIELDS = [
  'id',
  'runId',
  'taskId',
  'question',
  'options',
  'kind',
  'status',
  'resolution',
  'createdAt',
  'resolvedAt'
] as const

/** `default` is there only on its provider's default account; `signedIn` says whether the account can run now. */
export const ACCOUNT_FIELDS = ['id', 'label', 'provider', 'default', 'signedIn'] as const

/** A run configuration's command, env and cwd stay in the app: an env value can be a secret. */
export const RUN_CONFIG_FIELDS = ['id', 'name', 'type'] as const

/** A session's fields come from the note the app left on its pty, which can hold anything (resume ids, rolling
 *  accounts, permission bypass); only these are public. */
export const SESSION_FIELDS = ['id', 'kind', 'title', 'accountId', 'cwd', 'alive', 'state', 'provider', 'rolledFrom', 'sources'] as const

export const CHAT_TURN_FIELDS = ['role', 'text', 'tools'] as const
export const CHAT_PENDING_FIELDS = ['kind', 'summary'] as const
/** One line of `chats pending`. */
export const CHAT_PROMPT_FIELDS = ['sessionId', 'id', 'kind', 'tool', 'summary'] as const

/** `astera skills`: accounts with their skills folded in. The account rows come from accounts.json, which also has
 *  each account's config folder, so both layers are shaped. */
export const SKILLS_ACCOUNT_FIELDS = ['id', 'label', 'provider', 'skills'] as const
export const SKILL_LISTED_FIELDS = ['name', 'enabled', 'installed'] as const
export const SKILL_INSTALLED_FIELDS = ['name', 'result'] as const
export const SKILL_NOT_ENABLED_FIELDS = ['name', 'setting'] as const

/** `runs checks`: four layers, the run, a Task's row, that row's validation and review, and the checks and review
 *  findings inside them. `CHECK_FIELDS` and `REVIEW_ISSUE_FIELDS` are the same fields a Task's `checks` and
 *  `reviewIssues` carry. */
export const RUN_CHECKS_FIELDS = ['runId', 'jobId', 'tasks'] as const
export const TASK_CHECKS_FIELDS = ['id', 'title', 'status', 'validation', 'review', 'failureSummary', 'completionOverride'] as const
export const VALIDATION_FIELDS = ['required', 'status', 'checks'] as const
export const REVIEW_FIELDS = ['required', 'status', 'verdict', 'issues'] as const
export const CHECK_FIELDS = ['configId', 'name', 'status', 'exitCode', 'outputTail', 'startedAt', 'endedAt', 'unstable'] as const
export const REVIEW_ISSUE_FIELDS = ['id', 'severity', 'blocking', 'title', 'description', 'file', 'line', 'suggestedFix'] as const

/** One timeline event as `runs follow` prints it. A message's whole body (a worker's report can be pages long) and
 *  the app's link from an event to a tab are not public. */
export const FOLLOW_EVENT_FIELDS = [
  'at',
  'kind',
  'sourceId',
  'taskId',
  'taskTitle',
  'messageType',
  'summary',
  'outcome',
  'provider',
  'retry',
  'review',
  'repair'
] as const
