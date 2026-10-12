// The typed namespaces on the client (SDK spec §5): each method sends the Host command and arguments the public CLI
// sends (docs/superpowers/specs/2026-10-12-sdk-1c-command-reference.md §A), does the pre-reads MCP does (a project
// id to its folder), and answers in the DTO shapes of types.ts. Lists come back as `{ items }`; a wait's ending is
// data, not an error.
import type { CallOptions, CallResult } from './client.js'
import { TIMEOUT_HEADROOM_MS } from './deadlines.js'
import { AsteraError } from './errors.js'
import type { ConvergencePolicy, Job, JobWithRun, ListResult, Project, Provider, Run, WaitResult } from './types.js'

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

export interface Namespaces {
  readonly projects: ProjectsApi
  readonly jobs: JobsApi
}

type Call = (cmd: string, args?: Record<string, unknown>, options?: CallOptions) => Promise<CallResult>

const CONVERGENCE_KNOBS = ['maxFixAttempts', 'maxReviewRounds', 'blockingSeverity', 'maxTotalMinutes'] as const
const PROVIDERS: readonly string[] = ['claude', 'codex']
/** The longest Host deadline a wait may name: the client waits past it by the headroom, inside setTimeout's range. */
const MAX_WAIT_MS = 2 ** 31 - 1 - TIMEOUT_HEADROOM_MS

const invalid = (message: string): AsteraError => new AsteraError('INVALID_ARGUMENTS', message)

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

  return { projects, jobs }
}
