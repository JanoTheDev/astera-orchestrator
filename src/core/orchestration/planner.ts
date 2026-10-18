// W2-A planner stage (SPEC §2): the rules for a planner session and the plan it writes, kept pure.
//
// A planner is an agent session `jobs plan` starts on a Job that has not started (`Job.pendingStart`). It reads
// the repository and writes the plan as the Job's definition Tasks, through `task-create` and `task-update`.
// It never starts work: `plannerRefusal` is the gate `handleCommand` asks first, in the app and in the Host
// alike, and a person approves the plan with the Job's start (`run-start`), which `validatePlan` guards.
import path from 'node:path'
import { BASIS_STATES, recomputeReady, type Job, type Task } from './types'
import type { OrchState, PlanFields, Res } from './state'
import { layersOf } from './graph'
import { jobNameOf } from './jobName'
import { DIFFICULTIES, MODEL_ID } from './roleModels'

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
  'plan-nothing-to-do'
])

/** The Job whose planner `sessionId` is, if it is one. An empty id (a shell, an MCP client) is never one. */
export function plannerJobOf(s: OrchState, sessionId: string): Job | undefined {
  if (sessionId === '') return undefined
  return s.jobs.find((j) => j.plannerSessionIds?.includes(sessionId))
}

/** Why `cmd` is refused to the planner session `sessionId`, or null when it is not a planner or may call it.
 *  A planner writes only its own Job's definition Tasks, and `task-update` only edits them (no status). */
export function plannerRefusal(s: OrchState, sessionId: string, cmd: string, args: Record<string, unknown>): string | null {
  const job = plannerJobOf(s, sessionId)
  if (!job) return null
  if (!PLANNER_COMMANDS.has(cmd))
    return `planner sessions only plan: ${cmd} is refused. The person approves the plan in Astera ("Approve & execute"), and that starts the work`
  if (cmd === 'task-create') {
    const target = args.runId ?? args.run
    if (target !== job.id) return `a planner adds Tasks to its own Job only: pass --run ${job.id}`
  }
  // W6-A: only its own Job
  if (cmd === 'plan-nothing-to-do' && args.job !== job.id) return `a planner ends its own Job only: pass --job ${job.id}`
  if (cmd === 'task-update') {
    const task = s.tasks.find((t) => t.id === args.id)
    if (!task || task.jobId !== job.id) return `a planner edits the Tasks of its own Job (${job.id}) only`
    if (args.status !== undefined || args.convergence !== undefined)
      return 'a planner edits what a Task asks for, not its status'
  }
  return null
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '')
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

/** The plan fields in a command's arguments (`--prompt`, `--criteria`, `--affected-paths`, `--difficulty`,
 *  `--provider`, `--model`, `--model-reason`). **A trust boundary**: they come from an agent. */
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
  if (args.difficulty !== undefined) {
    if (!(DIFFICULTIES as readonly unknown[]).includes(args.difficulty))
      return { ok: false, error: `--difficulty must be one of ${DIFFICULTIES.join('|')}` }
    fields.difficulty = args.difficulty as Task['difficulty']
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
  return { ok: true, fields }
}

/** What is wrong with a Job's plan, one sentence each; empty when it may be approved. Every Task needs a
 *  prompt and at least one acceptance criterion, its deps must be Tasks of the same plan, and the deps must
 *  not form a cycle (graph.ts's `layersOf`, which already finds what it cannot order). */
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
    const unknown = t.deps.filter((d) => !own.has(d))
    if (unknown.length) problems.push(`${name} depends on ${unknown.join(', ')}, which is not a Task of this plan`)
  }
  const { cyclic } = layersOf(s, jobId)
  if (cyclic.length) problems.push(`these Tasks wait on each other in a cycle: ${cyclic.join(', ')}`)
  return problems
}

/** Edits a definition Task's plan (`task-update` with plan fields): its title, spec, deps and plan fields.
 *  Refused for a Task already in a run, for deps outside its plan, and for deps that would close a cycle. */
export function editPlanTask(
  s: OrchState,
  taskId: string,
  patch: PlanFields & { title?: string; spec?: string; deps?: string[] },
  now: string
): Res<Task> {
  const task = s.tasks.find((t) => t.id === taskId)
  if (!task) return { ok: false, error: `unknown task: ${taskId}`, missing: true }
  if (task.jobId === undefined || task.runId !== undefined)
    return { ok: false, error: `${taskId} is in a run already: only a plan's own Tasks are edited` }
  if (patch.deps) {
    const own = new Set(s.tasks.filter((t) => t.jobId === task.jobId && t.runId === undefined).map((t) => t.id))
    const outside = patch.deps.filter((d) => !own.has(d) || d === taskId)
    if (outside.length) return { ok: false, error: `deps must be other Tasks of the same plan: ${outside.join(', ')}` }
  }
  const next: Task = { ...task, ...patch, updatedAt: now }
  const tasks = s.tasks.map((t) => (t.id === taskId ? next : t))
  if (layersOf({ ...s, tasks }, task.jobId).cyclic.length)
    return { ok: false, error: `those deps would make ${taskId} wait on itself` }
  const settled = recomputeReady(tasks)
  return { ok: true, state: { ...s, tasks: settled }, value: settled.find((t) => t.id === taskId)! }
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

/** Where a Job's plan.md lives: beside orchestration.json in the profile, one folder per Job. */
export const planFileOf = (profileDir: string, jobId: string): string => path.join(profileDir, 'plans', jobId, 'plan.md')

/** The human-readable plan.md of a Job: its definition Tasks in dependency order (graph.ts's layers). */
export function renderPlanMd(s: OrchState, job: Job): string {
  const byId = new Map(s.tasks.filter((t) => t.jobId === job.id && t.runId === undefined).map((t) => [t.id, t]))
  const { layers, cyclic } = layersOf(s, job.id)
  const lines = [
    `# Plan: ${jobNameOf(job)}`,
    '',
    `- Job: \`${job.id}\``,
    `- Status: ${job.pendingStart ? 'waiting for approval' : 'approved'}`,
    `- Objective: ${job.objective}`,
    `- Repository: ${job.cwd}`
  ]
  let n = 0
  layers.forEach((layer, depth) => {
    lines.push('', `## Batch ${depth + 1}${layer.length > 1 ? ` (${layer.length} Tasks in parallel)` : ''}`)
    for (const id of layer) {
      const t = byId.get(id)!
      n++
      lines.push('', `### ${n}. ${t.title} (\`${t.id}\`)`, '')
      const model = [t.difficulty, t.provider, t.model].filter(Boolean).join(', ')
      if (model) lines.push(`- Model: ${model}${t.modelReason ? ` (${t.modelReason})` : ''}`)
      if (t.deps.length) lines.push(`- Waits for: ${t.deps.map((d) => `\`${d}\``).join(', ')}`)
      if (t.affectedPaths?.length) lines.push(`- Affected paths: ${t.affectedPaths.map((p) => `\`${p}\``).join(', ')}`)
      lines.push('', t.spec)
      if (t.prompt) lines.push('', '**Prompt**', '', t.prompt)
      if (t.acceptanceCriteria?.length) lines.push('', '**Acceptance criteria**', '', ...t.acceptanceCriteria.map((c) => `- ${c}`))
    }
  })
  if (cyclic.length) lines.push('', `## Cannot be ordered (dependency cycle)`, '', ...cyclic.map((id) => `- \`${id}\``))
  if (byId.size === 0) lines.push('', '_No Task yet._')
  return lines.join('\n') + '\n'
}
