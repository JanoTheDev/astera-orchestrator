// W2-A planner stage (SPEC §2): the rules for a planner session and the plan it writes, kept pure.
//
// A planner is an agent session `jobs plan` starts on a Job that has not started (`Job.pendingStart`). It reads
// the repository and writes the plan as the Job's definition Tasks, through `task-create` and `task-update`.
// It never starts work: `plannerRefusal` is the gate `handleCommand` asks first, in the app and in the Host
// alike, and a person approves the plan with the Job's start (`run-start`), which `validatePlan` guards.
import path from 'node:path'
import { BASIS_STATES, TASK_KINDS, recomputeReady, type Job, type LeftOutItem, type Task, type TaskKind } from './types'
import type { OrchState, PlanFields, Res } from './state'
import { chainOf, layersOf } from './graph'
import { isIntegrationTask } from './integrate'
import { pathsOverlap, projectKeyOf, serialFilesOf } from './schedule'
import { jobNameOf } from './jobName'
import { DIFFICULTIES, EFFORTS, MODEL_ID, type Effort } from './roleModels'
// W8-C prompts mode
import { sha256Of } from './promptWaves'
import { isTerminal } from './running'
// T7 objective coverage
import { objectiveItemsOf } from './objectiveItems'
// T1 the main plan: deps on another plan's Tasks of the project
import { crossPlanDepRefusal, holdExternalDeps, waitsOnItself } from './mainPlan'
import { depsRefusal } from './replan'

/** W8-C prompts mode: what a planner of a Run-as-written plan is told when it tries to change the owner's text. */
export const VERBATIM_REFUSAL =
  "a Run-as-written prompt is the owner's text: set criteria, affected paths, difficulty, basis and deps only"

/** What a planner session may call: reading, and writing its own Job's definition Tasks. **An allowlist**, so
 *  a command added later is refused to a planner until someone decides it plans rather than acts. */
export const PLANNER_COMMANDS: ReadonlySet<string> = new Set([
  'task-create',
  'task-update',
  'tasks-list',
  'tasks-get',
  'jobs-get',
  'jobs-list',
  'accounts',
  'accounts-list',
  'run-configs',
  'run-configs-list',
  'projects-list',
  'projects-get',
  'projects-find',
  'understanding-list',
  'understanding-get',
  'status',
  'version',
  // W6-A: the planner ends a Job whose items are all built
  'plan-nothing-to-do',
  // W7-A: after the owner's feedback, a planner removes a Task of its plan and reports what it changed
  'task-cancel',
  'jobs-feedback-done',
  // W8-D several plans in one repo: read where the plan meets another, and name its areas (`jobs-set --areas` only)
  'jobs-overlaps',
  // T3: the whole main plan of its project
  'main-plan',
  'jobs-set',
  // T7: the planner names its own Job once it knows the goal
  'jobs-rename',
  // T11: a hands-off plan's planner answers its workers' questions when the Run has no live coordinator (command.ts
  // `questions-answer` takes only its own plan's, and an escalation only while that plan runs hands-off)
  'questions-answer'
])

/** The Job whose planner `sessionId` is, if it is one. An empty id (a shell, an MCP client) is never one. */
export function plannerJobOf(s: OrchState, sessionId: string): Job | undefined {
  if (sessionId === '') return undefined
  return s.jobs.find((j) => j.plannerSessionIds?.includes(sessionId))
}

/** Why `cmd` is refused to the planner session `sessionId`, or null when it is not a planner or may call it.
 *  A planner writes only its own Job's definition Tasks, and `task-update` only edits them (no status). */
export function plannerRefusal(
  s: OrchState,
  sessionId: string,
  cmd: string,
  args: Record<string, unknown>,
  /** T20: when a person last typed in this planner's terminal (epoch ms, null for never) and the time now. */
  owner: { typedAt: number | null; now: number } = { typedAt: null, now: Date.now() }
): string | null {
  const job = plannerJobOf(s, sessionId)
  if (!job) return null
  if (cmd === 'run-start') return chatApprovalRefusal(s, job, args, owner)
  if (!PLANNER_COMMANDS.has(cmd))
    return `planner sessions only plan: ${cmd} is refused. The person approves the plan in Astera ("Approve & execute"), and that starts the work`
  // W8-C prompts mode: Astera wrote one Task per prompt; the planner fills them in and never adds, drops or rewrites one
  if (job.verbatim !== undefined) {
    if (cmd === 'task-create' || cmd === 'task-cancel') return `${VERBATIM_REFUSAL} (no Task is added or cancelled)`
    if (cmd === 'task-update' && (args.prompt !== undefined || args.title !== undefined)) return VERBATIM_REFUSAL
  }
  if (cmd === 'task-create') {
    const target = args.runId ?? args.run
    if (target !== job.id) return `a planner adds Tasks to its own Job only: pass --run ${job.id}`
  }
  // W8-D: areas only, and only its own Job; T7: or the objective items it leaves out
  if (
    cmd === 'jobs-set' &&
    (args.id !== job.id ||
      (args.areas === undefined) === (args.leftOut === undefined) ||
      ['concurrency', 'after', 'planning', 'priority', 'project'].some((k) => args[k] !== undefined))
  )
    return `a planner sets its own Job's areas only, or its left-out items (one per call): jobs-set --id ${job.id} --areas <a,b> | --left-out '<json>'`
  // T7: only its own Job
  if (cmd === 'jobs-rename' && args.id !== job.id) return `a planner names its own Job only: pass --id ${job.id}`
  // W6-A: only its own Job
  if (cmd === 'plan-nothing-to-do' && args.job !== job.id) return `a planner ends its own Job only: pass --job ${job.id}`
  // W7-A: only its own Job, and only a Task of its plan (a replan's cancel is replanRefusal's)
  if (cmd === 'jobs-feedback-done' && args.id !== job.id) return `a planner reports on its own Job only: pass --id ${job.id}`
  if (cmd === 'task-cancel') {
    const task = s.tasks.find((t) => t.id === args.id)
    if (!task || task.jobId !== job.id || task.runId !== undefined) return `a planner cancels the Tasks of its own plan (${job.id}) only`
  }
  if (cmd === 'task-update') {
    const task = s.tasks.find((t) => t.id === args.id)
    if (!task || task.jobId !== job.id) return `a planner edits the Tasks of its own Job (${job.id}) only`
    if (args.status !== undefined || args.convergence !== undefined)
      return 'a planner edits what a Task asks for, not its status'
  }
  return null
}

/** T20: how long the owner's word to run the plan holds. */
export const CHAT_APPROVAL_MS = 30 * 60_000

/** When the plan last changed: a Task made or edited, or one cancelled. null for a plan with no Task. */
export function planChangedAt(s: OrchState, job: Job): number | null {
  const stamps = [...s.tasks.filter((t) => t.jobId === job.id && t.runId === undefined).map((t) => t.updatedAt), job.planCancelledAt]
  const times = stamps.flatMap((x) => (x === undefined ? [] : [Date.parse(x)])).filter((n) => !Number.isNaN(n))
  return times.length ? Math.max(...times) : null
}

/** T20: a planner may start its own Job (`run-start`, the app's "Approve & execute") only when the owner typed in its
 *  terminal after the plan's last change, less than 30 minutes ago, and it quotes what they said. Input an agent sent
 *  (`sessions send`) never sets `typedAt`. The plan itself is still validated by `run-start` (validatePlan). */
function chatApprovalRefusal(s: OrchState, job: Job, args: Record<string, unknown>, owner: { typedAt: number | null; now: number }): string | null {
  if (args.run !== job.id) return `a planner starts its own Job only: pass --run ${job.id}`
  if (!text(args.ownerSaid))
    return `a planner starts its plan only when the person tells it to here: pass --owner-said "<their words, verbatim>". Otherwise the person presses "Approve & execute" in Astera`
  const changed = planChangedAt(s, job)
  const { typedAt, now } = owner
  if (typedAt === null || (changed !== null && typedAt <= changed) || now - typedAt > CHAT_APPROVAL_MS)
    return `the person has not told you to run the plan since its last change: ask them to confirm here (type 'run it'), or they press "Approve & execute" in Astera`
  return null
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '')
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

/** The plan fields in a command's arguments (`--prompt`, `--criteria`, `--affected-paths`, `--difficulty`,
 *  `--effort`, `--provider`, `--model`, `--model-reason`). **A trust boundary**: they come from an agent. */
export function planFieldsFromArgs(args: Record<string, unknown>): { ok: true; fields: PlanFields } | { ok: false; error: string } {
  const fields: PlanFields = {}
  if (args.prompt !== undefined) {
    if (!text(args.prompt)) return { ok: false, error: '--prompt must not be empty' }
    fields.prompt = args.prompt as string
  }
  if (args.criteria !== undefined) {
    if (!isStrings(args.criteria) || args.criteria.length === 0)
      return { ok: false, error: '--criteria must be a JSON array of one or more non-empty strings' }
    fields.acceptanceCriteria = args.criteria
  }
  if (args.affectedPaths !== undefined) {
    if (!isStrings(args.affectedPaths)) return { ok: false, error: '--affected-paths must be a JSON array of paths' }
    fields.affectedPaths = args.affectedPaths
  }
  if (args.noFiles !== undefined) {
    if (args.noFiles !== true) return { ok: false, error: '--no-files takes no value' }
    if (fields.affectedPaths?.length) return { ok: false, error: '--no-files and --affected-paths exclude each other' }
    fields.noFiles = true
  }
  if (args.difficulty !== undefined) {
    if (!(DIFFICULTIES as readonly unknown[]).includes(args.difficulty))
      return { ok: false, error: `--difficulty must be one of ${DIFFICULTIES.join('|')}` }
    fields.difficulty = args.difficulty as Task['difficulty']
  }
  if (args.effort !== undefined) {
    if (!(EFFORTS as readonly unknown[]).includes(args.effort)) return { ok: false, error: `--effort must be one of ${EFFORTS.join('|')}` }
    fields.effort = args.effort as Effort
  }
  if (args.provider !== undefined) {
    if (args.provider !== 'claude' && args.provider !== 'codex') return { ok: false, error: '--provider must be claude|codex' }
    fields.provider = args.provider
  }
  if (args.model !== undefined) {
    if (typeof args.model !== 'string' || !MODEL_ID.test(args.model)) return { ok: false, error: '--model is not a model id' }
    fields.model = args.model
  }
  if (args.modelReason !== undefined) {
    if (!text(args.modelReason) || (args.modelReason as string).includes('\n'))
      return { ok: false, error: '--model-reason is one line' }
    fields.modelReason = args.modelReason as string
  }
  // W6-A: what the planner found of the item (`--basis` and `--evidence` go together)
  if (args.basis !== undefined || args.evidence !== undefined) {
    if (!(BASIS_STATES as readonly unknown[]).includes(args.basis))
      return { ok: false, error: `--basis must be one of ${BASIS_STATES.join('|')} (an item already built gets no Task)` }
    if (!text(args.evidence)) return { ok: false, error: '--evidence is required with --basis: file:line, an issue or PR number, a Job id' }
    fields.basis = { state: args.basis as (typeof BASIS_STATES)[number], evidence: (args.evidence as string).trim() }
  }
  // T9
  if (args.kind !== undefined) {
    if (!(TASK_KINDS as readonly unknown[]).includes(args.kind)) return { ok: false, error: `--kind must be one of ${TASK_KINDS.join('|')}` }
    fields.kind = args.kind as TaskKind
  }
  // T3: where its worker starts; whether `reuse` holds is worktreeRefusal's, against the plan
  if (args.worktree !== undefined) {
    if (args.worktree !== 'new' && args.worktree !== 'reuse') return { ok: false, error: '--worktree must be new|reuse' }
    fields.worktree = args.worktree
  }
  // T7: the objective items it covers, `--covers 1,3`
  if (args.covers !== undefined) {
    const covers = coversArg(args.covers)
    if (covers === null) return { ok: false, error: '--covers takes the numbers of the objective items the Task covers, e.g. 1,3' }
    fields.covers = covers
  }
  return { ok: true, fields }
}

/** T3: why `t`'s `--worktree reuse` cannot hold, or undefined. It continues in its dep's worktree, so it needs exactly
 *  one dep, of its own plan (a definition's Job or an instance's Run), and no other Task of that plan reusing it: one
 *  folder, one Task continuing in it. Asked at task-create and task-update, and again at dispatch. */
export function worktreeRefusal(s: OrchState, t: Task): string | undefined {
  if (t.worktree !== 'reuse') return undefined
  const samePlan = (x: Task): boolean => (t.runId !== undefined ? x.runId === t.runId : x.runId === undefined && x.jobId === t.jobId)
  const dep = t.deps.length === 1 ? s.tasks.find((x) => x.id === t.deps[0]) : undefined
  if (!dep || !samePlan(dep))
    return `--worktree reuse continues in the worktree of the Task's one dependency: ${t.id} needs exactly one dep, of its own plan (it has ${t.deps.length}${dep ? ', of another plan' : ''}); use --worktree new`
  const other = s.tasks.find((x) => x.id !== t.id && samePlan(x) && x.worktree === 'reuse' && x.deps.includes(dep.id))
  if (other) return `${other.id} already reuses ${dep.id}'s worktree, and only one Task continues in a folder: use --worktree new for ${t.id}`
  return undefined
}

/** `--covers`: "1,3", a number, or an array of them; null when any is not a whole number of 1 or more. */
const coversArg = (v: unknown): number[] | null => {
  const raw = typeof v === 'string' ? v.split(',').map((x) => x.trim()) : Array.isArray(v) ? v : [v]
  const nums = raw.map((x) => (typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : x))
  if (nums.length === 0 || !nums.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1)) return null
  return [...new Set(nums as number[])].sort((a, b) => a - b)
}

/** T7 `jobs-set --left-out '[{"item":2,"reason":"..."}]'`: the objective items the plan leaves out on purpose, checked
 *  against the Job's objective. A JSON string (the CLI's) or the array itself; `[]` clears the list. */
export function leftOutArg(v: unknown, objective: string): LeftOutItem[] | { error: string } {
  let list = v
  if (typeof v === 'string') {
    try {
      list = JSON.parse(v)
    } catch {
      return { error: `--left-out must be JSON: '[{"item":2,"reason":"already built: src/x.ts"}]'` }
    }
  }
  if (!Array.isArray(list)) return { error: '--left-out must be a JSON array of {"item": <n>, "reason": "<why>"}' }
  const items = new Set(objectiveItemsOf(objective).map((i) => i.n))
  const out: LeftOutItem[] = []
  for (const e of list as unknown[]) {
    const r = e as { item?: unknown; reason?: unknown }
    if (typeof e !== 'object' || e === null || typeof r.item !== 'number' || !Number.isInteger(r.item) || !text(r.reason))
      return { error: '--left-out entries are {"item": <n>, "reason": "<why>"}, each with a reason' }
    if (!items.has(r.item)) return { error: `the objective has no item ${r.item}${items.size ? ` (its items: ${[...items].join(', ')})` : ''}` }
    out.push({ item: r.item, reason: (r.reason as string).replace(/\s+/g, ' ').trim() })
  }
  return out
}

/** T7: what `sessionId` is to orchestration: a worker's or reviewer's Dispatch, a Run's coordinator, a Job's planner or
 *  replanner. Undefined for any other caller: a shell, the app, the Host, or a tab the owner opened in Astera. */
export function orchestrationRoleOf(s: OrchState, sessionId: string): 'worker' | 'reviewer' | 'coordinator' | 'planner' | undefined {
  if (sessionId === '') return undefined
  const d = s.dispatches.find((x) => x.sessionId === sessionId)
  if (d) return d.review ? 'reviewer' : 'worker'
  if (s.runs.some((r) => r.coordinatorSessionId === sessionId || r.externalCoordinatorSessionId === sessionId)) return 'coordinator'
  if (s.jobs.some((j) => j.plannerSessionIds?.includes(sessionId) || j.replanning?.sessionId === sessionId)) return 'planner'
  return undefined
}

/** T7: a run Task the owner may still re-plan: it has never had a Dispatch, and is pending, ready, or blocked. */
const notStartedYet = (s: OrchState, t: Task): boolean =>
  (t.status === 'pending' || t.status === 'ready' || t.status === 'blocked') && !s.dispatches.some((d) => d.taskId === t.id)

/** The plan fields the owner may change on a run Task that has started and not finished; they apply to its next dispatch. */
const STARTED_EDITABLE = ['model', 'effort', 'difficulty', 'modelReason', 'acceptanceCriteria']

/** The kinds of Task that may change no repository file (`--no-files`): archiving plans, a CLI cleanup, an audit. */
const NO_FILES_KINDS: readonly TaskKind[] = ['ops', 'audit', 'docs']

/** What is wrong with a Job's plan, one sentence each; empty when it may be approved. Every Task needs a
 *  prompt and at least one acceptance criterion, its deps must be Tasks of the same plan (T1: or of another active or
 *  queued plan of the project), and the deps must not form a cycle (graph.ts's `layersOf`, which already finds what it
 *  cannot order; T1: `waitsOnItself` across plans). */
export function validatePlan(s: OrchState, jobId: string): string[] {
  const tasks = s.tasks.filter((t) => t.jobId === jobId && t.runId === undefined)
  if (tasks.length === 0) return ['the plan has no Task']
  const own = new Set(tasks.map((t) => t.id))
  const problems: string[] = []
  for (const t of tasks) {
    const name = `${t.id} (${t.title})`
    if (!t.prompt?.trim()) problems.push(`${name} has no prompt`)
    if (!t.acceptanceCriteria?.length) problems.push(`${name} has no acceptance criterion`)
    // W6-A: no worker opens on unchecked work
    if (!t.basis?.evidence.trim()) problems.push(`${name} has no basis: give --basis missing|partial|broken and its --evidence`)
    // T1: a dep outside the plan names a Task of another active or queued plan of the project
    for (const d of t.deps.filter((x) => !own.has(x))) {
      const dep = s.tasks.find((x) => x.id === d)
      const refused = dep ? crossPlanDepRefusal(s, jobId, dep) : `${d} is not a Task of this plan or of another plan of this project`
      if (refused !== undefined) problems.push(`${name}: ${refused}`)
    }
    if (t.deps.some((d) => !own.has(d)) && waitsOnItself(s.tasks, t.id))
      problems.push(`${name} waits on itself through another plan's Tasks: these plans wait on each other in a cycle`)
    // the file guard only sees declared paths; a Task without any overlaps nothing and conflicts at merge
    if (t.noFiles) {
      if (!t.kind || !NO_FILES_KINDS.includes(t.kind)) problems.push(`Task ${name} says --no-files but is not --kind ${NO_FILES_KINDS.join('|')}`)
      if (t.affectedPaths?.length) problems.push(`Task ${name} names files and says --no-files: drop one`)
    } else if (!t.affectedPaths?.length && !isIntegrationTask(t))
      problems.push(`Task ${name} names no files (--affected-paths; an ops, audit or docs Task that changes no repository file says --kind ops|audit|docs --no-files)`)
  }
  // Tasks neither waiting on the other (directly or through others) may run at once, so their files must differ.
  // T7: only on a project that keeps same-file Tasks apart (schedule.ts `serialFilesOf`); otherwise they run side by side
  // and the merge worker settles a conflict
  const job = s.jobs.find((j) => j.id === jobId)
  const deps = Object.fromEntries(tasks.map((t) => [t.id, t.deps]))
  if (job && serialFilesOf(s, projectKeyOf(s, job))) tasks.forEach((a, i) => {
    const chain = chainOf(deps, a.id)
    for (const b of tasks.slice(i + 1)) {
      if (chain.has(b.id)) continue
      const hit = (a.affectedPaths ?? []).find((p) => (b.affectedPaths ?? []).some((q) => pathsOverlap(p, q)))
      if (hit !== undefined)
        problems.push(`Tasks ${a.id} (${a.title}) and ${b.id} (${b.title}) both change ${hit}: make it one Task or chain them with --deps`)
    }
  })
  const { cyclic } = layersOf(s, jobId)
  if (cyclic.length) problems.push(`these Tasks wait on each other in a cycle: ${cyclic.join(', ')}`)
  // W8-C prompts mode: one Task per prompt, its text the owner's, and no Task besides
  const verbatim = s.jobs.find((j) => j.id === jobId)?.verbatim
  if (verbatim !== undefined) {
    for (const v of verbatim) {
      if (v.skipped !== undefined) continue
      const mine = tasks.filter((t) => t.verbatimOf === v.source)
      if (mine.length !== 1) problems.push(`${v.source} has ${mine.length} Tasks: a Run-as-written prompt is exactly one Task`)
      for (const t of mine)
        if (sha256Of(t.prompt ?? '') !== v.sha256)
          problems.push(`${v.title}'s prompt was changed: a Run-as-written prompt is the owner's text, unchanged`)
    }
    const sources = new Set(verbatim.filter((v) => v.skipped === undefined).map((v) => v.source))
    for (const t of tasks)
      if (t.verbatimOf === undefined || !sources.has(t.verbatimOf))
        problems.push(`${t.id} (${t.title}) is not one of the owner's prompts: Run as written plans the attached prompts only`)
  }
  // T7: every item the objective lists is covered by a Task or left out with a reason. Only for a Job's own plan: a
  // replan's key (replanProblems) names no Job, and its finished Tasks, which covered items too, are not in `tasks`.
  // Run as written is checked above, prompt by prompt.
  if (job !== undefined && verbatim === undefined) {
    const covered = new Set([...tasks.flatMap((t) => t.covers ?? []), ...(job.leftOut ?? []).map((l) => l.item)])
    for (const item of objectiveItemsOf(job.objective))
      if (!covered.has(item.n))
        problems.push(
          `objective item ${item.n} ("${clip(item.text)}") has no Task: add one with --covers ${item.n}, or list it with jobs-set --left-out and a reason`
        )
  }
  return problems
}

/** What `validatePlan` says of one plan Task: the lines naming it, for the planner that has just written it. */
export function taskProblems(s: OrchState, task: Task): string[] {
  if (task.jobId === undefined || task.runId !== undefined) return []
  return validatePlan(s, task.jobId).filter((p) => p.includes(task.id))
}

/** Said to the planner, never a block on the owner's approval: the plan has no real name (no title, or the title is
 *  the start of the objective). */
export function planWarnings(s: OrchState, jobId: string): string[] {
  const job = s.jobs.find((j) => j.id === jobId)
  const title = job?.title?.trim()
  if (!job || (title && !(job.objective.trim().startsWith(title) && title.length >= Math.min(job.objective.trim().length, 40)))) return []
  return [`the plan has no real name: run \`astera jobs rename --id ${jobId} --title "<short name>"\``]
}

const clip = (t: string): string => (t.length > 40 ? `${t.slice(0, 39).trimEnd()}…` : t)

/** Edits a definition Task's plan (`task-update` with plan fields): its title, spec, deps and plan fields.
 *  Refused for a Task already in a run, for deps outside its plan (T1: other than another active plan's of the project,
 *  `depsRefusal`), and for deps that would close a cycle. */
export function editPlanTask(
  s: OrchState,
  taskId: string,
  patch: PlanFields & { title?: string; spec?: string; deps?: string[] },
  now: string,
  /** T7: who asks, for a run Task: `true` is the owner of a running run, who may also change a run Task that has not
   *  started (pending, ready or blocked, no Dispatch ever); a string is why the caller is not that owner. */
  owner: true | string = 'only the owner changes a running plan'
): Res<Task> {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `unknown task: ${taskId}`, missing: true }
  const criteriaOnly = patch.acceptanceCriteria !== undefined && Object.keys(patch).every((k) => k === 'acceptanceCriteria')
  if (owner === true && task.runId !== undefined && !criteriaOnly && !notStartedYet(s, task)) {
    if (isTerminal(task)) return { ok: false, error: `${taskId} has finished (${task.status}): it is not edited` }
    if (!Object.keys(patch).every((k) => STARTED_EDITABLE.includes(k)))
      return { ok: false, error: `${taskId} has started already (${task.status}): only a Task that has not started is re-planned; it takes new --criteria, --model, --effort, --difficulty and --model-reason only` }
    // a new difficulty alone makes the next dispatch pick model and effort again; given together, the values win
    const reset = patch.difficulty !== undefined && patch.model === undefined && patch.effort === undefined
    const next: Task = { ...task, ...patch, ...(reset ? { model: undefined, effort: undefined } : {}), updatedAt: now }
    return { ok: true, state: { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? next : t)) }, value: next }
  }
  if (owner === true && task.runId !== undefined && !criteriaOnly) {
    if (patch.deps) {
      const refused = depsRefusal(s, task, patch.deps, new Set(s.tasks.filter((t) => t.runId === task.runId).map((t) => t.id)))
      if (refused !== undefined) return { ok: false, error: refused }
    }
    const next: Task = { ...task, ...patch, updatedAt: now }
    const tasks = s.tasks.map((t) => (t.id === taskId ? next : t))
    if (layersOf({ ...s, tasks }, task.runId).cyclic.length)
      return { ok: false, error: `those deps would make ${taskId} wait on itself` }
    const settled = holdExternalDeps({ ...s, tasks: recomputeReady(tasks) }).tasks
    return { ok: true, state: { ...s, tasks: settled }, value: settled.find((t) => t.id === taskId)! }
  }
  // W8-F (#100): a Task in a run that has not finished keeps one editable field: its acceptance criteria, which the
  // coordinator narrows when the owner's answer does (the review judges the Task against them)
  if (task.runId !== undefined) {
    if (isTerminal(task)) return { ok: false, error: `${taskId} has finished (${task.status}): it is not edited` }
    if (!criteriaOnly)
      return { ok: false, error: `${taskId} is in a run already and ${owner === true ? 'has started' : owner}: it takes new --criteria only` }
    const next: Task = { ...task, acceptanceCriteria: patch.acceptanceCriteria, updatedAt: now }
    return { ok: true, state: { ...s, tasks: s.tasks.map((t) => (t.id === taskId ? next : t)) }, value: next }
  }
  if (task.jobId === undefined) return { ok: false, error: `${taskId} is in a run already: only a plan's own Tasks are edited` }
  if (patch.deps) {
    const own = new Set(s.tasks.filter((t) => t.jobId === task.jobId && t.runId === undefined).map((t) => t.id))
    const refused = depsRefusal(s, task, patch.deps, own)
    if (refused !== undefined) return { ok: false, error: refused }
  }
  const next: Task = { ...task, ...patch, updatedAt: now }
  const tasks = s.tasks.map((t) => (t.id === taskId ? next : t))
  if (layersOf({ ...s, tasks }, task.jobId).cyclic.length)
    return { ok: false, error: `those deps would make ${taskId} wait on itself` }
  const settled = holdExternalDeps({ ...s, tasks: recomputeReady(tasks) }).tasks
  return { ok: true, state: { ...s, tasks: settled }, value: settled.find((t) => t.id === taskId)! }
}

/** W7-A: removes a Task from a plan before approval (`task-cancel` from its planner). Refused while another Task of the
 *  plan depends on it: the planner changes that Task's deps first, as a replan's cancel asks (cancelRemainingTask). */
export function cancelPlanTask(s: OrchState, taskId: string, now: string = new Date().toISOString()): Res<Task> {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `unknown task: ${taskId}`, missing: true }
  if (task.jobId === undefined || task.runId !== undefined)
    return { ok: false, error: `${taskId} is in a run already: only a plan's own Tasks are cancelled before approval` }
  const waiting = s.tasks.filter((t) => t.jobId === task.jobId && t.runId === undefined && t.deps.includes(taskId))
  if (waiting.length) return { ok: false, error: `${waiting.map((t) => t.id).join(', ')} depend on ${taskId}: change their --deps first` }
  const jobs = s.jobs.map((j) => (j.id === task.jobId ? { ...j, planCancelledAt: now } : j))
  return { ok: true, state: { ...s, jobs, tasks: s.tasks.filter((t) => t.id !== taskId) }, value: task }
}

/** The body a worker's spec file carries (OrchCoordinator.startWorker wraps it). A Task with no plan fields
 *  is its `spec`, unchanged; a planned one adds its prompt, acceptance criteria and affected paths. */
export function workerSpecOf(task: Pick<Task, 'spec' | 'prompt' | 'acceptanceCriteria' | 'affectedPaths'>): string {
  if (!task.prompt && !task.acceptanceCriteria?.length && !task.affectedPaths?.length) return task.spec
  return [
    task.spec,
    ...(task.prompt ? ['', '## Prompt', '', task.prompt] : []),
    ...(task.acceptanceCriteria?.length
      ? ['', '## Acceptance criteria', '', 'The Task is done when every one of these holds:', ...task.acceptanceCriteria.map((c) => `- ${c}`)]
      : []),
    ...(task.affectedPaths?.length
      ? ['', '## Affected paths', '', 'Keep your changes to these; other workers may be editing the rest in parallel:', ...task.affectedPaths.map((p) => `- ${p}`)]
      : [])
  ].join('\n')
}

/** Longest failure report a retried worker reads back; a longer one is cut here. */
const PREVIOUS_ATTEMPT_MAX = 2000

/** A retried worker's spec: the Task's spec, plus why its previous attempt failed, so it does not repeat that.
 *  `failure` is that attempt's own worker_done report; absent means there is no previous failed attempt. */
export function withPreviousAttempt(spec: string, failure: { subject: string; body: string } | undefined): string {
  if (!failure) return spec
  const body = failure.body.length > PREVIOUS_ATTEMPT_MAX ? `${failure.body.slice(0, PREVIOUS_ATTEMPT_MAX)}…` : failure.body
  return [spec, '', '## Previous attempt', '', `The last attempt at this Task failed: ${failure.subject}`, '', body].join('\n')
}

/** Where a Job's plan.md lives: beside orchestration.json in the profile, one folder per Job. */
export const planFileOf = (profileDir: string, jobId: string): string => path.join(profileDir, 'plans', jobId, 'plan.md')

/** T9: a Task's kind: its own `--kind`, else read from its title and then its spec (fix/bug, audit, page/button/design),
 *  else `feature`. */
export function kindOf(t: Pick<Task, 'kind' | 'title' | 'spec'>): TaskKind {
  if (t.kind !== undefined) return t.kind
  const rules: Array<[TaskKind, RegExp]> = [
    ['audit', /\baudit/i],
    ['bugfix', /\b(fix|fixes|fixing|bugs?|regression)\b/i],
    ['ui', /\b(pages?|buttons?|designs?|screens?|layouts?|dialogs?|modals?|ui)\b/i]
  ]
  for (const text of [t.title, t.spec]) for (const [kind, re] of rules) if (re.test(text)) return kind
  return 'feature'
}

/** T9: what the plan folder needs of the Job's Tasks and Run: the Run's own Tasks once there is a Run, else the plan's. */
const planTasksOf = (s: OrchState, job: Job): { tasks: Task[]; scope: string; run?: OrchState['runs'][number] } => {
  const run = s.runs.filter((r) => r.jobId === job.id).at(-1)
  if (run) return { tasks: s.tasks.filter((t) => t.runId === run.id), scope: run.id, run }
  return { tasks: s.tasks.filter((t) => t.jobId === job.id && t.runId === undefined), scope: job.id }
}

const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'task'

/** `tasks/<NN>-<slug>.md` for the Task at `index` (0-based) of the plan's order. */
const taskFileOf = (index: number, t: Task): string => `tasks/${String(index + 1).padStart(2, '0')}-${slugOf(t.title)}.md`

/** The Tasks in plan order (waves, then creation), each with its 1-based wave and file path. */
function orderedTasks(s: OrchState, job: Job): { task: Task; wave: number; file: string }[] {
  const { tasks, scope } = planTasksOf(s, job)
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const { layers, cyclic } = layersOf(s, scope)
  const ids = [...layers.flat(), ...cyclic]
  const wave = new Map(layers.flatMap((l, i) => l.map((id) => [id, i + 1] as const)))
  return ids.flatMap((id, n) => {
    const task = byId.get(id)
    return task ? [{ task, wave: wave.get(id) ?? layers.length + 1, file: taskFileOf(n, task) }] : []
  })
}

/** T9: where the Job stands, in words: planning, waiting for approval, running wave N of M, delivered or failed. */
function planStatusOf(s: OrchState, job: Job): string {
  const { tasks, run } = planTasksOf(s, job)
  if (!run) return job.pendingStart && tasks.length > 0 ? 'waiting for approval' : job.pendingStart ? 'planning' : 'approved'
  if (run.delivery?.sha !== undefined || run.deliveryState?.state === 'delivered' || run.deliveryState?.state === 'delivered-by-owner') return 'delivered'
  const open = tasks.filter((t) => t.status !== 'completed')
  if (open.length === 0) return 'all Tasks done, delivering'
  const working = open.some((t) => ['dispatched', 'validating', 'reviewing', 'merging', 'ready', 'pending'].includes(t.status))
  if (!working && open.some((t) => t.status === 'failed' || t.status === 'blocked')) return 'failed'
  const { layers } = layersOf(s, run.id)
  const waveOf = (t: Task): number => layers.findIndex((l) => l.includes(t.id)) + 1
  return `running wave ${Math.min(...open.map(waveOf).filter((w) => w > 0), layers.length)} of ${layers.length}`
}

const cell = (v: string): string => v.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

/** The `## Decisions` section of a planner's existing.md (without its heading), or undefined. */
export function decisionsOf(existingMd: string | undefined): string | undefined {
  const m = existingMd?.match(/^## Decisions[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)
  return m?.[1].trim() || undefined
}

/** The human-readable plan.md of a Job: status, objective, its Decisions, the waves table and links to each Task's file
 *  (`renderTaskMd`) and to `inputs/`. `decisions` is the Decisions section of inputs/existing.md, read by the caller. */
export function renderPlanMd(s: OrchState, job: Job, decisions?: string): string {
  const rows = orderedTasks(s, job)
  const { cyclic } = layersOf(s, planTasksOf(s, job).scope)
  const accountOf = (t: Task): string => t.accountIds?.join(', ') || 'auto'
  const lines = [
    `# Plan: ${jobNameOf(job)}`,
    '',
    `- Job: \`${job.id}\``,
    `- Status: ${planStatusOf(s, job)}`,
    `- Objective: ${job.objective}`,
    `- Repository: ${job.cwd}`,
    `- Inputs: [inputs/](inputs/)`
  ]
  if (decisions) lines.push('', '## Decisions', '', decisions)
  lines.push('', '## Waves', '')
  if (rows.length === 0) lines.push('_No Task yet._')
  else {
    lines.push('| Wave | Task | Kind | Difficulty | Worktree | Status | Account | Waits for |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
    const num = new Map(rows.map((r, i) => [r.task.id, String(i + 1).padStart(2, '0')]))
    for (const { task: t, wave, file } of rows)
      lines.push(
        `| ${wave} | [${cell(t.title)}](${file}) | ${kindOf(t)} | ${t.difficulty ?? '-'}${t.effort ? `, ${t.effort}` : ''} | ${t.worktree ?? '-'} | ${t.status} | ${cell(accountOf(t))} | ${t.deps.map((d) => num.get(d) ?? d).join(', ') || '-'} |`
      )
  }
  if (cyclic.length) lines.push('', `## Cannot be ordered (dependency cycle)`, '', ...cyclic.map((id) => `- \`${id}\``))
  // W8-C prompts mode: the prompts Astera left out, so the owner sees them at approval
  const skipped = (job.verbatim ?? []).filter((v) => v.skipped !== undefined)
  if (skipped.length) lines.push('', '## Already done (skipped)', '', ...skipped.map((v) => `- ${v.source}: ${v.skipped}`))
  // W10-A: the prompts the owner named instead of attaching, each id with the file it resolved to
  if (job.byName) {
    const b = job.byName
    lines.push('', '## Found by name', '', `From \`${b.dir}\`.`, ...b.why.map((w) => `- Picked by ${w}`), '', ...b.picked.map((p) => `- ${p.id} → \`${p.path}\``))
    if (b.skipped.length) lines.push('', 'Skipped:', '', ...b.skipped.map((x) => `- ${x.id}: ${x.why}`))
  }
  return lines.join('\n') + '\n'
}

/** T9: a Task's status over time, from what the state records: created, each worker's start and end, and where it stands. */
function statusHistoryOf(s: OrchState, t: Task): { at: string; what: string }[] {
  const events = [{ at: t.createdAt, what: 'pending' }]
  for (const d of s.dispatches.filter((x) => x.taskId === t.id)) {
    events.push({ at: d.startedAt, what: `dispatched (${d.provider} ${d.accountId})` })
    if (d.endedAt) events.push({ at: d.endedAt, what: `worker ${d.outcome ?? d.workerState}` })
  }
  if (t.status !== 'pending' && t.updatedAt !== t.createdAt) events.push({ at: t.updatedAt, what: t.status })
  return events.sort((a, b) => a.at.localeCompare(b.at))
}

/** T9: one Task's file of the plan folder: spec, kind, difficulty, deps, paths, criteria as a checklist (ticked once the
 *  Task is completed), status history, the worker's report when there is one, and the prompt last. */
export function renderTaskMd(s: OrchState, task: Task, n: number): string {
  const byId = new Map(s.tasks.map((t) => [t.id, t]))
  const lines = [
    `# ${n}. ${task.title}`,
    '',
    `- Task: \`${task.id}\``,
    `- Status: ${task.status}`,
    `- Kind: ${kindOf(task)}`,
    `- Difficulty: ${task.difficulty ?? '-'}${task.effort ? `, effort ${task.effort}` : ''}${task.modelReason ? ` (${task.modelReason})` : ''}`,
    `- Worktree: ${task.worktree ?? '-'}`,
    `- Waits for: ${task.deps.map((d) => byId.get(d)?.title ?? d).join(', ') || '-'}`,
    `- Affected paths: ${task.affectedPaths?.map((p) => `\`${p}\``).join(', ') || '-'}`,
    '',
    '## Spec',
    '',
    task.spec
  ]
  const done = task.status === 'completed' ? 'x' : ' '
  if (task.acceptanceCriteria?.length) lines.push('', '## Acceptance criteria', '', ...task.acceptanceCriteria.map((c) => `- [${done}] ${c}`))
  lines.push('', '## Status history', '', ...statusHistoryOf(s, task).map((e) => `- ${e.at} ${e.what}`))
  if (task.result || task.filesModified?.length) {
    lines.push('', '## Report', '')
    if (task.result) lines.push(task.result)
    if (task.filesModified?.length) lines.push('', 'Changed files:', ...task.filesModified.map((f) => `- \`${f}\``))
  }
  if (task.prompt) lines.push('', '## Prompt', '', task.prompt)
  return lines.join('\n') + '\n'
}

/** T9: the plan folder of a Job, `plans/<jobId>/`: path (relative to it) → text. `plan.md` and `tasks/<NN>-<slug>.md`. */
export function renderPlanFolder(s: OrchState, job: Job, decisions?: string): Map<string, string> {
  const files = new Map([['plan.md', renderPlanMd(s, job, decisions)]])
  orderedTasks(s, job).forEach(({ task, file }, i) => files.set(file, renderTaskMd(s, task, i + 1)))
  return files
}
