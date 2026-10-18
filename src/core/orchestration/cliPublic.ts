// The app's half of the public field contract (public CLI design §11).
//
// The public field lists and the shaping (`publicFor`) are the SDK package's (packages/client/src/fields.ts and
// shape.ts): one copy for the CLI, MCP and @astera-app/client. What stays here is what only the app can know, its
// internal types and the fields it deliberately keeps back, and the check that ties the two together.
//
// **The compiler catches a missing field.** Add a field to one of these objects without putting it on the package's
// public list or on this file's hidden list, and the typecheck breaks here naming it. An allowlist fails only by
// going stale, and this is what stops that.
import type { CheckResult, Gate, Job, JobRun, Project, ReviewIssue, Task } from './types'
import type { RunChecks, TaskChecks, TaskReview, TaskValidation } from './runChecks'
import type { JobEvent } from '../types'
import type { HostSession, OrchAccount, OrchRunConfig } from './command'
import type { ChatPending, ChatPrompt, ChatTurn } from '../sessions/chatRead'
import type { SkillInstalled, SkillListed, SkillNotEnabled, SkillsAccount } from './skills'
import type { RunCompletion, TaskCompletion } from './runCompletion'
import type { CompletionCheckDetail, CompletionDetail } from './completion'
import type {
  ACCOUNT_FIELDS,
  CHAT_PENDING_FIELDS,
  CHAT_PROMPT_FIELDS,
  CHAT_TURN_FIELDS,
  CHECK_FIELDS,
  COMPLETION_CHECK_FIELDS,
  COMPLETION_DETAIL_FIELDS,
  COMPLETION_FIELDS,
  FOLLOW_EVENT_FIELDS,
  JOB_FIELDS,
  PROJECT_FIELDS,
  QUESTION_FIELDS,
  REVIEW_FIELDS,
  REVIEW_ISSUE_FIELDS,
  RUN_CHECKS_FIELDS,
  RUN_CONFIG_FIELDS,
  RUN_FIELDS,
  SESSION_FIELDS,
  SKILL_INSTALLED_FIELDS,
  SKILL_LISTED_FIELDS,
  SKILL_NOT_ENABLED_FIELDS,
  SKILLS_ACCOUNT_FIELDS,
  TASK_CHECKS_FIELDS,
  TASK_COMPLETION_FIELDS,
  TASK_FIELDS,
  VALIDATION_FIELDS
} from '../publicContract'

export { publicEvent, publicFor, TASK_FIELDS as TASK_PUBLIC_FIELDS } from '../publicContract'

/** The names the two lists leave uncovered. */
type Unlisted<
  T,
  Shown extends readonly PropertyKey[],
  Hidden extends readonly PropertyKey[]
> = Exclude<keyof T, Shown[number] | Hidden[number]>

/** Breaks the compile here, naming what is left, when anything is. An unused alias on purpose: its job is to set up
 *  the type check, not to make a value. */
type NothingLeft<T extends never> = T

/** Held back: the roll tap's bookkeeping of a stopped coordinator, the mark of a coordinator start in flight, the
 *  mark of a coordinator stop not confirmed yet, and the session the inbox net leaves a Run's questions to (an
 *  external coordinator; publishing it would add to the SDK's contract, which nothing has asked for). What a script
 *  needs from the first, that the Run waits for a reset and until when, is the `limited` ending of `runs wait`. */
const RUN_HIDDEN = [
  'coordinatorStop',
  'coordinatorStartingAt',
  'coordinatorStopPending',
  'externalCoordinatorSessionId',
  // W2-D: the plan's PR, read by the app's view; not in the SDK's contract yet (`run-open-pr` answers it)
  'pr',
  // W6-H: a push delivery's result, answered by `run-deliver`; not in the SDK's contract yet
  'delivery'
] as const

/** W6-H: how a project's plans land, set by `projects-set`; not in the SDK's contract yet. */
const PROJECT_HIDDEN = ['delivery', 'deliveryBranch', /* W7-B: project settings, not in the SDK's contract yet */ 'autoApprove', 'testConfigId', 'concurrency', 'reviewRounds', 'replan', 'defaultBranch'] as const

/**
 * A Task's fields kept back on purpose: all of them **the ledger the app keeps to drive convergence**. The guide
 * tells a coordinator to read `checks`, `consecutiveFailures` and `parentId` (resources/skills/orchestration-guide.md)
 * and never these eight; publishing them would make how the app drives convergence a public API, and every policy
 * change would break someone's script.
 */
const TASK_HIDDEN = [
  'checkHistory',
  'lastFailure',
  'policySnapshot',
  'policyChanged',
  'convergenceStartedAt',
  'convergenceOff',
  'suspiciousFiles',
  'reviewRequested',
  // A skipped round's bookkeeping (plugin Phase 5 C9): its results are the Task's `checks` once it settles
  'checkResume',
  // W1-A role models: not in the SDK's contract until the planner (W2-A) settles how they are written
  'difficulty',
  'model',
  'provider',
  // W2-A planner stage: the planner's fields, held back with W1-A's until the SDK takes them on
  'prompt',
  'acceptanceCriteria',
  'affectedPaths',
  'modelReason',
  // W2-D GitHub links: read by the app's view; `task-link-issue` answers them. Not in the SDK's contract yet
  'links',
  // W6-A: the planner's basis, held back with its other fields
  'basis',
  // W8-C prompts mode: a Run-as-written Task's source, not in the SDK's contract yet
  'verbatimOf'
] as const

/** W1-A role models: a Job's per-role model override, held back from the SDK like the Task's three above. */
const JOB_HIDDEN = [
  'models',
  /* W2-A: the planner sessions, the app's own bookkeeping */ 'plannerSessionIds',
  /* W5-C: the person's "stop launching" (jobs-hold), not in the SDK's contract yet */ 'dispatchHold',
  /* W6-D: wave replanning's setting and bookkeeping, not in the SDK's contract yet */ 'replan',
  'replanFollowUps',
  'replanning',
  'lastReplan',
  /* W6-A: a plan ended with nothing to do, not in the SDK's contract yet */ 'nothingToDo',
  /* W6-H: the plan's own delivery (jobs-create/jobs-plan --delivery), not in the SDK's contract yet */ 'delivery',
  /* W7-E: the review default and the planner's account, not in the SDK's contract yet */ 'review',
  'plannerAccountId',
  /* W7-A: talking to the planner, rejecting a plan, auto-approve; not in the SDK's contract yet */ 'autoApprove',
  'feedback',
  'autoStartedAt',
  'rejected',
  /* W8-C prompts mode: the owner's prompts a Run-as-written plan was made from, not in the SDK's contract yet */ 'verbatim'
] as const

/** A followed event's message body (pages long) and the app's link from an event to a tab. */
const FOLLOW_EVENT_HIDDEN = ['body', 'sessionId', /* W6-E: the plan view's "Asked the coordinator" */ 'answered'] as const

// A Job's and a Run's derived fields (the package's DERIVED_FIELDS: outcome, progress, questionsOpen) are not fields
// of the objects, so they are on neither side of these checks.
type _project = NothingLeft<Unlisted<Project, typeof PROJECT_FIELDS, typeof PROJECT_HIDDEN>>
type _job = NothingLeft<Unlisted<Job, typeof JOB_FIELDS, typeof JOB_HIDDEN>>
type _run = NothingLeft<Unlisted<JobRun, typeof RUN_FIELDS, typeof RUN_HIDDEN>>
type _task = NothingLeft<Unlisted<Task, typeof TASK_FIELDS, typeof TASK_HIDDEN>>
type _question = NothingLeft<Unlisted<Gate, typeof QUESTION_FIELDS, [/* W6-C: the app's notices read it */ 'reason']>>
type _account = NothingLeft<Unlisted<OrchAccount, typeof ACCOUNT_FIELDS, []>>
type _runConfig = NothingLeft<Unlisted<OrchRunConfig, typeof RUN_CONFIG_FIELDS, []>>
/** The pty and process ids are the Host's own: a controller reads them from the raw reply to subscribe, and a
 *  printed list leaves them out. */
type _session = NothingLeft<Unlisted<HostSession, typeof SESSION_FIELDS, ['ptyId', 'procId', /* W5-D: the app's inbox reason */ 'prompt', /* W6-E: the plan view's "now" line */ 'lastAction', /* W8-C heavy: the plan view's queue line */ 'heavyWait']>>
type _chatTurn = NothingLeft<Unlisted<ChatTurn, typeof CHAT_TURN_FIELDS, []>>
type _chatPending = NothingLeft<Unlisted<ChatPending, typeof CHAT_PENDING_FIELDS, []>>
type _chatPrompt = NothingLeft<Unlisted<ChatPrompt, typeof CHAT_PROMPT_FIELDS, []>>
/** The skills types are in core so that core does not import the cli (./skills). */
type _skillsAccount = NothingLeft<Unlisted<SkillsAccount, typeof SKILLS_ACCOUNT_FIELDS, []>>
type _skillListed = NothingLeft<Unlisted<SkillListed, typeof SKILL_LISTED_FIELDS, []>>
type _skillInstalled = NothingLeft<Unlisted<SkillInstalled, typeof SKILL_INSTALLED_FIELDS, []>>
type _skillNotEnabled = NothingLeft<Unlisted<SkillNotEnabled, typeof SKILL_NOT_ENABLED_FIELDS, []>>
type _runChecks = NothingLeft<Unlisted<RunChecks, typeof RUN_CHECKS_FIELDS, []>>
type _taskChecks = NothingLeft<Unlisted<TaskChecks, typeof TASK_CHECKS_FIELDS, []>>
type _validation = NothingLeft<Unlisted<TaskValidation, typeof VALIDATION_FIELDS, []>>
type _review = NothingLeft<Unlisted<TaskReview, typeof REVIEW_FIELDS, []>>
type _check = NothingLeft<Unlisted<CheckResult, typeof CHECK_FIELDS, []>>
type _reviewIssue = NothingLeft<Unlisted<ReviewIssue, typeof REVIEW_ISSUE_FIELDS, []>>
type _followEvent = NothingLeft<Unlisted<JobEvent, typeof FOLLOW_EVENT_FIELDS, typeof FOLLOW_EVENT_HIDDEN>>
// The completion read model (runs-completion), allowlisted since SDK 1c: every field it carries is public.
type _runCompletion = NothingLeft<Unlisted<RunCompletion, typeof COMPLETION_FIELDS, []>>
type _taskCompletion = NothingLeft<Unlisted<TaskCompletion, typeof TASK_COMPLETION_FIELDS, []>>
type _completionDetail = NothingLeft<Unlisted<CompletionDetail, typeof COMPLETION_DETAIL_FIELDS, []>>
type _completionCheck = NothingLeft<Unlisted<CompletionCheckDetail, typeof COMPLETION_CHECK_FIELDS, []>>
