// The typed namespaces on the client (SDK spec §5): each method sends the Host command and arguments the public CLI
// sends (docs/superpowers/specs/2026-10-12-sdk-1c-command-reference.md §A), does the pre-reads MCP does (a project
// id to its folder), and answers in the DTO shapes of types.ts. Lists come back as `{ items }`; a wait's ending is
// data, not an error.
import type { CallOptions, CallResult } from './client.js'
import { DEFAULT_WAIT_TIMEOUT_MS, FOLLOW_WINDOW_MS, TIMEOUT_HEADROOM_MS } from './deadlines.js'
import { AsteraError } from './errors.js'
import { eventKey } from './follow.js'
import { publicEvent } from './shape.js'
import type {
  AnsweredQuestion,
  ConvergencePolicy,
  Job,
  JobWithRun,
  ListResult,
  Progress,
  Project,
  Provider,
  Question,
  Run,
  RunCompletion,
  RunEvent,
  StopResult,
  Task,
  TaskDetail,
  TaskStatus,
  WaitEnding,
  WaitResult,
  WaitTimeout
} from './types.js'

export interface ReadOptions {
  readonly signal?: AbortSignal
  /** How long to wait for the answer, in ms (`CallOptions.timeoutMs`). */
  readonly timeoutMs?: number
}

export interface WriteOptions extends ReadOptions {
  /** Makes a retry safe: the Host runs the command once per id (`CallOptions.requestId`). */
  readonly requestId?: string
}

export interface WaitOptions {
  readonly signal?: AbortSignal
  /** How long the Host waits, in ms. Default: the Host's own (1 hour). The client waits past it. */
  readonly timeoutMs?: number
}

/** A Job's state as `jobs.list` filters it (the CLI's `jobs list --status`). */
export type JobState = 'pending' | 'paused' | 'scheduled' | 'waiting' | 'running' | 'completed' | 'failed'

export interface CreateJobInput {
  readonly objective: string
  /** Where the work happens: a project id (its folder is looked up) or a folder. Exactly one. */
  readonly projectId?: string
  readonly cwd?: string
  /** Who coordinates the Job's Runs. None means a Job that runs only the Tasks added to it (the CLI's default). */
  readonly coordinator?: { readonly accountId: string } | { readonly provider: Provider }
  readonly concurrency?: number
  /** Repair and recheck failing Tasks: `true` for the Host's defaults, or a policy. */
  readonly convergence?: true | ConvergencePolicy
}

export interface ProjectsApi {
  list(options?: ReadOptions): Promise<ListResult<Project>>
  get(projectId: string, options?: ReadOptions): Promise<Project>
}

export interface JobsApi {
  list(filter?: { readonly status?: JobState; readonly projectId?: string }, options?: ReadOptions): Promise<ListResult<Job>>
  get(jobId: string, options?: ReadOptions): Promise<JobWithRun>
  create(input: CreateJobInput, options?: WriteOptions): Promise<Job>
  run(jobId: string, options?: WriteOptions): Promise<Run>
  /** Until the latest Run ends, needs a person, or the Host's deadline passes. */
  wait(jobId: string, options?: WaitOptions): Promise<WaitResult>
}

export interface CreateTaskInput {
  /** Whose Task: a Job's definition (`jobId`) or a Run's (`runId`). Exactly one. */
  readonly jobId?: string
  readonly runId?: string
  readonly spec: string
  readonly title?: string
  readonly deps?: readonly string[]
  readonly parentId?: string
  /** The accounts to run it on, in failover order. Default: the Job's coordinator account. */
  readonly accountIds?: readonly string[]
  /** Run configurations to check the work with, in order. */
  readonly validate?: readonly string[]
  /** Ask for a review of the work. */
  readonly review?: boolean
}

/** One step of `runs.follow`: an event of the Run's timeline, then its ending last. */
export type FollowItem = { readonly event: RunEvent } | { readonly ending: WaitEnding | WaitTimeout }

export interface RunsApi {
  list(filter?: { readonly jobId?: string }, options?: ReadOptions): Promise<ListResult<Run>>
  get(runId: string, options?: ReadOptions): Promise<Run>
  /** Until the Run ends, needs a person, or the Host's deadline passes. */
  wait(runId: string, options?: WaitOptions): Promise<WaitResult>
  /** The Run's events as they happen, each once, and its ending last; a timeout ending at `timeoutMs` (default an
   *  hour). An AbortSignal ends it with its reason. */
  follow(runId: string, options?: WaitOptions): AsyncIterable<FollowItem>
  /** Releases the Run's workers and pauses it (there is no cancel: `resume` takes it back). */
  stop(runId: string, options?: WriteOptions): Promise<StopResult>
  resume(runId: string, options?: WriteOptions): Promise<Run>
}

export interface TasksApi {
  list(
    filter?: { readonly runId?: string; readonly status?: TaskStatus; readonly ready?: boolean; readonly brief?: boolean },
    options?: ReadOptions
  ): Promise<ListResult<Task>>
  get(taskId: string, options?: ReadOptions): Promise<TaskDetail>
  create(input: CreateTaskInput, options?: WriteOptions): Promise<Task>
}

export interface QuestionsApi {
  /** `status` in the Host's words: `open` or `resolved`. */
  list(filter?: { readonly runId?: string; readonly taskId?: string; readonly status?: 'open' | 'resolved' }, options?: ReadOptions): Promise<ListResult<Question>>
  get(questionId: string, options?: ReadOptions): Promise<Question>
  answer(questionId: string, input: { readonly answer: string }, options?: WriteOptions): Promise<AnsweredQuestion>
}

export interface CompletionApi {
  /** Where each Task of a Run stands on its way to done. Read only: whether work is done stays Astera's call. */
  get(runId: string, options?: ReadOptions): Promise<RunCompletion>
}

export interface Namespaces {
  readonly projects: ProjectsApi
  readonly jobs: JobsApi
  readonly runs: RunsApi
  readonly tasks: TasksApi
  readonly questions: QuestionsApi
  readonly completion: CompletionApi
}

type Call = (cmd: string, args?: Record<string, unknown>, options?: CallOptions) => Promise<CallResult>

const CONVERGENCE_KNOBS = ['maxFixAttempts', 'maxReviewRounds', 'blockingSeverity', 'maxTotalMinutes'] as const
const PROVIDERS: readonly string[] = ['claude', 'codex']
/** The longest Host deadline a wait may name: the client waits past it by the headroom, inside setTimeout's range. */
const MAX_WAIT_MS = 2 ** 31 - 1 - TIMEOUT_HEADROOM_MS

const invalid = (message: string): AsteraError => new AsteraError('INVALID_ARGUMENTS', message)

/** A list of ids the Host takes comma-joined: non-empty, and no id empty or holding a comma. */
const idList = (name: string, value: readonly unknown[]): string => {
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string' || v.length === 0 || v.includes(',')))
    throw invalid(`${name} is a non-empty list of ids, none empty or holding a comma`)
  return value.join(',')
}

/** A required id or text: a non-empty string. */
const need = (name: string, value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0) throw invalid(`${name} is required (a non-empty string)`)
  return value
}

/** Only the call options that were given: an absent one must not reach `call` as `undefined`. */
const callOptions = (o: WriteOptions | undefined): CallOptions => ({
  ...(o?.signal !== undefined ? { signal: o.signal } : {}),
  ...(o?.timeoutMs !== undefined ? { timeoutMs: o.timeoutMs } : {}),
  ...(o?.requestId !== undefined ? { requestId: o.requestId } : {})
})
/** A read's options: never a request id, which only a write may carry. */
const readOptions = (o: ReadOptions | undefined): CallOptions => callOptions(o === undefined ? undefined : { signal: o.signal, timeoutMs: o.timeoutMs })

export function createNamespaces(call: Call): Namespaces {
  const body = async <T>(cmd: string, args: Record<string, unknown>, o: CallOptions): Promise<T> => (await call(cmd, args, o)).body as T
  const list = async <T>(cmd: string, args: Record<string, unknown>, o: CallOptions): Promise<ListResult<T>> => ({
    items: await body<T[]>(cmd, args, o)
  })
  /** A project id's folder, which is what the Host's `jobs-create` and `jobs-list --project` take. */
  const folderOf = async (projectId: string, o: CallOptions): Promise<string> =>
    (await body<Project>('projects-get', { id: projectId }, readOptions(o))).path
  const waitArgs = (id: string, o: WaitOptions | undefined): Record<string, unknown> => {
    const ms = o?.timeoutMs
    if (ms !== undefined && (!Number.isInteger(ms) || ms <= 0 || ms > MAX_WAIT_MS))
      throw invalid(`timeoutMs must be a whole number of milliseconds from 1 to ${MAX_WAIT_MS}, not ${String(ms)}`)
    return { id, ...(ms !== undefined ? { timeoutMs: ms } : {}) }
  }
  const waitOptions = (o: WaitOptions | undefined): CallOptions => (o?.signal !== undefined ? { signal: o.signal } : {})

  const projects: ProjectsApi = {
    list: (o) => list<Project>('projects-list', {}, readOptions(o)),
    get: async (projectId, o) => body<Project>('projects-get', { id: need('projectId', projectId) }, readOptions(o))
  }

  const jobs: JobsApi = {
    list: async (filter = {}, o) => {
      const r = readOptions(o)
      const project = filter.projectId !== undefined ? await folderOf(need('projectId', filter.projectId), r) : undefined
      return list<Job>('jobs-list', { ...(filter.status !== undefined ? { status: filter.status } : {}), ...(project !== undefined ? { project } : {}) }, r)
    },
    get: async (jobId, o) => body<JobWithRun>('jobs-get', { id: need('jobId', jobId) }, readOptions(o)),
    create: async (input, o) => {
      const objective = need('objective', input.objective)
      if ((input.projectId === undefined) === (input.cwd === undefined)) throw invalid('give exactly one of projectId or cwd')
      const coordinator = input.coordinator as { accountId?: unknown; provider?: unknown } | undefined
      if (coordinator !== undefined) {
        const hasAccount = coordinator.accountId !== undefined
        const hasProvider = coordinator.provider !== undefined
        if (hasAccount === hasProvider) throw invalid('coordinator is { accountId } or { provider }, not both or neither')
        if (hasAccount) need('coordinator.accountId', coordinator.accountId)
        if (hasProvider && !PROVIDERS.includes(String(coordinator.provider))) throw invalid(`coordinator.provider is one of ${PROVIDERS.join(', ')}`)
      }
      const cwd = input.cwd !== undefined ? need('cwd', input.cwd) : await folderOf(need('projectId', input.projectId), callOptions(o))
      const policy = input.convergence
      const args: Record<string, unknown> = {
        objective,
        cwd,
        ...(coordinator?.accountId !== undefined ? { coordinatorAccount: coordinator.accountId } : {}),
        ...(coordinator?.provider !== undefined ? { coordinatorProvider: coordinator.provider } : {}),
        ...(input.concurrency !== undefined ? { concurrency: input.concurrency } : {}),
        ...(policy !== undefined ? { convergence: true } : {}),
        ...(policy !== undefined && policy !== true
          ? Object.fromEntries(CONVERGENCE_KNOBS.filter((k) => policy[k] !== undefined).map((k) => [k, policy[k]]))
          : {})
      }
      return body<Job>('jobs-create', args, callOptions(o))
    },
    run: async (jobId, o) => body<Run>('jobs-run', { id: need('jobId', jobId) }, callOptions(o)),
    wait: async (jobId, o) => body<WaitResult>('jobs-wait', waitArgs(need('jobId', jobId), o), waitOptions(o))
  }

  /** One `runs-follow` answer. */
  interface FollowPage {
    runId?: string
    jobId?: string
    progress?: Progress
    events?: RunEvent[]
    ending?: WaitEnding | null
  }

  /** The CLI's follow (src/cli/follow.ts followRun): windows of `runs-follow` on one connection, each event once by
   *  `eventKey` though the Host answers the whole timeline when anything is new, the ending last. */
  async function* follow(runId: string, o: WaitOptions = {}): AsyncGenerator<FollowItem> {
    const id = need('runId', runId)
    const total = waitArgs(id, o).timeoutMs as number | undefined
    const deadline = Date.now() + (total ?? DEFAULT_WAIT_TIMEOUT_MS)
    const shown = new Set<string>()
    for (;;) {
      const waitMs = Math.max(0, Math.min(FOLLOW_WINDOW_MS, deadline - Date.now()))
      const page = await body<FollowPage>('runs-follow', { id, seen: shown.size, waitMs }, { ...waitOptions(o), timeoutMs: waitMs + TIMEOUT_HEADROOM_MS })
      for (const e of page.events ?? []) {
        const key = eventKey(e)
        if (shown.has(key)) continue
        shown.add(key)
        yield { event: publicEvent(e) as RunEvent }
      }
      if (page.ending) {
        yield { ending: page.ending }
        return
      }
      if (Date.now() >= deadline) {
        yield { ending: { state: 'timeout', runId: page.runId ?? id, jobId: page.jobId, progress: page.progress ?? { done: 0, total: 0 } } }
        return
      }
    }
  }

  const runs: RunsApi = {
    list: async (filter = {}, o) => list<Run>('runs-list', filter.jobId !== undefined ? { job: need('jobId', filter.jobId) } : {}, readOptions(o)),
    get: async (runId, o) => body<Run>('runs-get', { id: need('runId', runId) }, readOptions(o)),
    wait: async (runId, o) => body<WaitResult>('runs-wait', waitArgs(need('runId', runId), o), waitOptions(o)),
    follow: (runId, o) => follow(runId, o),
    stop: async (runId, o) => body<StopResult>('runs-stop', { id: need('runId', runId) }, callOptions(o)),
    resume: async (runId, o) => body<Run>('runs-resume', { id: need('runId', runId) }, callOptions(o))
  }

  const tasks: TasksApi = {
    list: async (filter = {}, o) =>
      list<Task>(
        'tasks-list',
        {
          ...(filter.runId !== undefined ? { run: need('runId', filter.runId) } : {}),
          ...(filter.status !== undefined ? { status: filter.status } : {}),
          ...(filter.ready === true ? { ready: true } : {}),
          ...(filter.brief === true ? { brief: true } : {})
        },
        readOptions(o)
      ),
    get: async (taskId, o) => body<TaskDetail>('tasks-get', { id: need('taskId', taskId) }, readOptions(o)),
    create: async (input, o) => {
      if ((input.jobId === undefined) === (input.runId === undefined)) throw invalid('give exactly one of jobId or runId')
      const owner = input.jobId !== undefined ? { job: need('jobId', input.jobId) } : { run: need('runId', input.runId) }
      const spec = need('spec', input.spec)
      const validate = input.validate !== undefined ? idList('validate', input.validate) : undefined
      let account = input.accountIds !== undefined ? idList('accountIds', input.accountIds) : undefined
      if (account === undefined) {
        // MCP's default (create_task): the Job's coordinator account. The Host takes a Run id for jobs-get too.
        const job = await body<JobWithRun>('jobs-get', { id: input.jobId ?? input.runId }, readOptions(o))
        if (typeof job.coordinatorAccountId !== 'string' || job.coordinatorAccountId === '')
          throw invalid('accountIds is required: this Job has no coordinator account to default to')
        account = job.coordinatorAccountId
      }
      const args: Record<string, unknown> = {
        ...owner,
        spec,
        ...(input.title !== undefined ? { title: need('title', input.title) } : {}),
        ...(input.deps !== undefined && input.deps.length > 0 ? { deps: [...input.deps] } : {}),
        ...(input.parentId !== undefined ? { parent: need('parentId', input.parentId) } : {}),
        account,
        ...(validate !== undefined ? { validate } : {}),
        ...(input.review === true ? { review: true } : {})
      }
      return body<Task>('tasks-add', args, callOptions(o))
    }
  }

  const questions: QuestionsApi = {
    list: async (filter = {}, o) =>
      list<Question>(
        'questions-list',
        {
          ...(filter.runId !== undefined ? { run: need('runId', filter.runId) } : {}),
          ...(filter.taskId !== undefined ? { task: need('taskId', filter.taskId) } : {}),
          ...(filter.status !== undefined ? { status: filter.status } : {})
        },
        readOptions(o)
      ),
    get: async (questionId, o) => body<Question>('questions-get', { id: need('questionId', questionId) }, readOptions(o)),
    answer: async (questionId, input, o) =>
      body<AnsweredQuestion>('questions-answer', { id: need('questionId', questionId), answer: need('answer', input.answer) }, callOptions(o))
  }

  const completion: CompletionApi = {
    get: async (runId, o) => body<RunCompletion>('runs-completion', { id: need('runId', runId) }, readOptions(o))
  }

  return { projects, jobs, runs, tasks, questions, completion }
}
