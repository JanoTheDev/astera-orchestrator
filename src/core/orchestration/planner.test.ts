// W2-A planner stage: the planner's gate, the plan's validation, its approval, the worker spec and plan.md.
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { editPlanTask, planFileOf, renderPlanMd, validatePlan, workerSpecOf } from './planner'
import { OrchestrationStore } from './store'
import { replanProblems } from './exec/replanStart'

const NOW = '2026-10-17T00:00:00.000Z'
const PLANNER = 'ses-planner'

interface Rig {
  deps: OrchServerDeps
  coordinatorStarts: Array<Record<string, unknown>>
  workerStarts: Array<Record<string, unknown>>
  /** The sessions `stopCoordinator` was asked to end, with the reason */
  stopped: Array<[string, string | undefined]>
}

const rig = (): Rig => {
  let state: OrchState = emptyState()
  const coordinatorStarts: Array<Record<string, unknown>> = []
  const workerStarts: Array<Record<string, unknown>> = []
  const stopped: Array<[string, string | undefined]> = []
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    startWorker: async (a: Record<string, unknown>) => {
      workerStarts.push(a)
      return { sessionId: 'ses-worker', cwd: 'D:/p', specPath: 'D:/s.md' }
    },
    startCoordinator: async (a: Record<string, unknown>) => {
      coordinatorStarts.push(a)
      return { sessionId: a.role === 'planner' ? PLANNER : 'ses-coordinator' }
    },
    stopCoordinator: async (sessionId: string, reason?: string) => {
      stopped.push([sessionId, reason])
    },
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    readWorker: async () => '',
    now: () => NOW
  } as unknown as OrchServerDeps
  return { deps, coordinatorStarts, workerStarts, stopped }
}

/** A person at their own shell: no ASTERA_SESSION. */
const person = (r: Rig) => (cmd: string, args: Record<string, unknown>) => handleCommand(r.deps, { sessionId: '' }, cmd, args)
const planner = (r: Rig) => (cmd: string, args: Record<string, unknown>) => handleCommand(r.deps, { sessionId: PLANNER }, cmd, args)

/** A Job made the way the "+ New job" form makes it (pendingStart), with its planner started. */
const plannedJob = async (r: Rig): Promise<string> => {
  const made = await person(r)('run-create', { objective: 'add a login page', cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true })
  const jobId = (made.body as { id: string }).id
  const planned = await person(r)('jobs-plan', { id: jobId })
  expect(planned.status).toBe(200)
  return jobId
}

const goodTask = (jobId: string, extra: Record<string, unknown> = {}) => ({
  run: jobId,
  account: 'acc1',
  title: 'form',
  spec: 'the login form',
  prompt: 'Build the login form in src/login.tsx.',
  criteria: ['the form renders', 'npm test passes'],
  affectedPaths: ['src/login.tsx'],
  difficulty: 'standard',
  modelReason: 'an ordinary component',
  // W6-A: what the planner found of the item
  basis: 'missing',
  evidence: 'no login form under src/',
  ...extra
})

describe('jobs plan', () => {
  it('starts a planner on the coordinator spawn path and records its session on the Job', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    expect(r.coordinatorStarts).toHaveLength(1)
    const start = r.coordinatorStarts[0]
    expect(start).toMatchObject({ role: 'planner', runId: jobId, cwd: 'D:/p', accountId: 'acc1' })
    expect(start.brief).toContain(jobId)
    expect(start.brief).toContain('CLAUDE.md and AGENTS.md')
    expect(start.brief).toContain('You do not implement anything')
    const job = r.deps.getState().jobs[0]
    expect(job.plannerSessionIds).toEqual([PLANNER])
    expect(job.pendingStart).toBe(true)
    expect(r.deps.getState().runs).toHaveLength(0)
  })

  it('is refused once the Job has started', async () => {
    const r = rig()
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p' })
    const jobId = r.deps.getState().runs.find((x) => x.id === (made.body as { id: string }).id)!.jobId
    expect((await person(r)('jobs-plan', { id: jobId })).status).toBe(409)
  })

  it('leaves the Job unplanned when the planner does not start', async () => {
    const r = rig()
    r.deps.startCoordinator = async () => {
      throw new Error('no pty')
    }
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    expect((await person(r)('jobs-plan', { id: jobId })).status).toBe(400)
    expect(r.deps.getState().jobs[0]).not.toHaveProperty('plannerSessionIds')
  })
  // T5b (decision 6): the named account is a preference; the Job records the one actually started
  it('records the account the planner actually started on, and keeps the named one as the preference', async () => {
    const r = rig()
    r.deps.startCoordinator = async (a) => {
      r.coordinatorStarts.push(a)
      return { sessionId: PLANNER, accountId: 'acc2' }
    }
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    const planned = await person(r)('jobs-plan', { id: jobId })
    expect(planned.body).toMatchObject({ accountId: 'acc2' })
    expect(r.deps.getState().jobs[0]).toMatchObject({ plannerAccountId: 'acc2', preferredAccountId: 'acc1' })
    expect(r.coordinatorStarts[0]).toMatchObject({ accountId: 'acc1' })
    expect(r.coordinatorStarts[0]).not.toHaveProperty('auto')
  })

  it('with no account named, the planner starts on auto', async () => {
    const r = rig()
    ;(r.deps as { listAccounts: unknown }).listAccounts = () => [{ id: 'acc1', label: 'a', provider: 'claude', default: true }]
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p', auto: true })
    const jobId = (made.body as { id: string }).id
    const planned = await person(r)('jobs-plan', { id: jobId })
    expect(planned.body).toMatchObject({ sessionId: PLANNER })
    expect(r.coordinatorStarts[0]).toMatchObject({ accountId: 'acc1', auto: true })
  })
})

describe('a planner session cannot dispatch', () => {
  it.each([
    ['worker-start', { taskId: 'x', agent: 'claude', account: 'acc1' }],
    ['run-merge', { run: 'x' }],
    ['run-start', { run: 'x' }],
    ['jobs-run', { id: 'x' }],
    ['tasks-dispatch', { id: 'x' }],
    ['run-create', { objective: 'o', cwd: 'D:/p' }],
    ['sessions-send', { id: 'x', text: 'hi' }],
    ['sessions-create', { account: 'acc1', cwd: 'D:/p' }],
    ['jobs-plan', { id: 'x' }]
  ])('%s is refused with 403', async (cmd, args) => {
    const r = rig()
    await plannedJob(r)
    const reply = await planner(r)(cmd, args)
    expect(reply.status).toBe(403)
    expect(JSON.stringify(reply.body)).toContain('planner')
  })

  it('cannot approve its own plan, even with a plan that holds', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    expect((await planner(r)('task-create', goodTask(jobId))).status).toBe(200)
    expect((await planner(r)('run-start', { run: jobId })).status).toBe(403)
    expect(r.deps.getState().jobs[0].pendingStart).toBe(true)
  })

  it('no other agent session may approve a planned Job either', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    await planner(r)('task-create', goodTask(jobId))
    expect((await handleCommand(r.deps, { sessionId: 'ses-other' }, 'jobs-run', { id: jobId })).status).toBe(403)
  })

  // W3-D: the gaps the cases above leave.
  it('stays gated after the person approves: it still cannot start, send to or merge the run it planned', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    await planner(r)('task-create', goodTask(jobId))
    expect((await person(r)('run-start', { run: jobId })).status).toBe(200)
    const s = r.deps.getState()
    const runId = s.runs[0].id
    const taskId = s.tasks.find((t) => t.runId === runId)!.id
    for (const [cmd, args] of [
      ['worker-start', { taskId, agent: 'claude', account: 'acc1' }],
      ['tasks-dispatch', { id: taskId }],
      ['run-start', { run: runId }],
      ['jobs-run', { id: jobId }],
      ['run-merge', { run: runId }],
      ['sessions-send', { id: 'ses-coordinator', text: 'go' }]
    ] as const) {
      const reply = await planner(r)(cmd, args)
      expect(reply.status, cmd).toBe(403)
    }
    expect(r.workerStarts).toEqual([])
    expect(r.deps.getState().runs).toHaveLength(1)
  })

  it('a second jobs plan on the same Job adds a second planner, and both are gated', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    r.deps.startCoordinator = async () => ({ sessionId: 'ses-planner-2' })
    expect((await person(r)('jobs-plan', { id: jobId })).status).toBe(200)
    expect(r.deps.getState().jobs[0].plannerSessionIds).toEqual([PLANNER, 'ses-planner-2'])
    await planner(r)('task-create', goodTask(jobId))
    for (const sessionId of [PLANNER, 'ses-planner-2']) {
      for (const cmd of ['run-start', 'jobs-run'])
        expect((await handleCommand(r.deps, { sessionId }, cmd, cmd === 'run-start' ? { run: jobId } : { id: jobId })).status, `${sessionId} ${cmd}`).toBe(403)
    }
    expect(r.deps.getState().jobs[0].pendingStart).toBe(true)
  })

  it('no agent session approves through jobs run while the planner is still starting', async () => {
    const r = rig()
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    await person(r)('task-create', { run: jobId, account: 'acc1', spec: 's', prompt: 'p', criteria: ['c'] })
    let release: (v: { sessionId: string }) => void = () => {}
    r.deps.startCoordinator = () => new Promise((resolve) => (release = resolve))
    const planning = person(r)('jobs-plan', { id: jobId })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // marked planned before the session exists: an agent's approval is refused in that window
    expect(r.deps.getState().jobs[0].plannerSessionIds).toEqual([])
    expect((await handleCommand(r.deps, { sessionId: 'ses-other' }, 'jobs-run', { id: jobId })).status).toBe(403)
    release({ sessionId: PLANNER })
    expect((await planning).status).toBe(200)
    expect(r.deps.getState().jobs[0].pendingStart).toBe(true)
    expect(r.deps.getState().runs).toHaveLength(0)
  })

  it('an MCP client cannot approve a plan through run_job (jobs run), though the person at a shell can', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    await planner(r)('task-create', goodTask(jobId))
    const mcp = await handleCommand(r.deps, { sessionId: '', role: 'mcp' }, 'jobs-run', { id: jobId })
    expect(mcp.status).toBe(403)
    expect(r.deps.getState().jobs[0].pendingStart).toBe(true)
    expect((await handleCommand(r.deps, { sessionId: '', role: 'cli' }, 'jobs-run', { id: jobId })).status).toBe(200)
  })
})

describe('a planner writes Tasks', () => {
  it('creates a definition Task with the plan fields', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const reply = await planner(r)('task-create', goodTask(jobId))
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({
      jobId,
      prompt: 'Build the login form in src/login.tsx.',
      acceptanceCriteria: ['the form renders', 'npm test passes'],
      affectedPaths: ['src/login.tsx'],
      difficulty: 'standard',
      modelReason: 'an ordinary component'
    })
  })

  it('must give a prompt and at least one criterion', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    expect((await planner(r)('task-create', goodTask(jobId, { criteria: undefined }))).status).toBe(400)
    expect((await planner(r)('task-create', goodTask(jobId, { prompt: undefined }))).status).toBe(400)
    expect((await planner(r)('task-create', goodTask(jobId, { criteria: [] }))).status).toBe(400)
    expect((await planner(r)('task-create', goodTask(jobId, { difficulty: 'easy' }))).status).toBe(400)
  })

  it('writes only into its own Job', async () => {
    const r = rig()
    await plannedJob(r)
    const other = await person(r)('run-create', { objective: 'other', cwd: 'D:/p', auto: true })
    const otherId = (other.body as { id: string }).id
    expect((await planner(r)('task-create', goodTask(otherId))).status).toBe(403)
  })

  it('edits a Task with task-update, but never its status', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const a = (await planner(r)('task-create', goodTask(jobId))).body as { id: string }
    const b = (await planner(r)('task-create', goodTask(jobId, { title: 'b' }))).body as { id: string }
    const edited = await planner(r)('task-update', { id: b.id, deps: [a.id], criteria: ['b works'] })
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ deps: [a.id], acceptanceCriteria: ['b works'] })
    // a cycle back is refused
    expect((await planner(r)('task-update', { id: a.id, deps: [b.id] })).status).toBe(400)
    expect((await planner(r)('task-update', { id: a.id, status: 'completed' })).status).toBe(403)
  })
})

describe('validatePlan', () => {
  const planWith = async (): Promise<{ r: Rig; jobId: string }> => {
    const r = rig()
    const jobId = await plannedJob(r)
    return { r, jobId }
  }

  it('wants at least one Task', async () => {
    const { r, jobId } = await planWith()
    expect(validatePlan(r.deps.getState(), jobId)).toEqual(['the plan has no Task'])
  })

  it('names a Task without a criterion or a prompt', async () => {
    const { r, jobId } = await planWith()
    // A person may add a Task by hand (NewTaskModal sends neither field).
    const t = (await person(r)('task-create', { run: jobId, account: 'acc1', title: 'by hand', spec: 's' })).body as { id: string }
    const problems = validatePlan(r.deps.getState(), jobId)
    expect(problems).toContain(`${t.id} (by hand) has no prompt`)
    expect(problems).toContain(`${t.id} (by hand) has no acceptance criterion`)
  })

  it('names a dependency outside the plan', async () => {
    const { r, jobId } = await planWith()
    const other = await person(r)('run-create', { objective: 'other', cwd: 'D:/p', auto: true })
    const foreign = (await person(r)('task-create', { run: (other.body as { id: string }).id, account: 'acc1', spec: 's' })).body as { id: string }
    // createTask accepts any existing id; the plan does not.
    const t = (await person(r)('task-create', { ...goodTask(jobId), deps: [foreign.id] })).body as { id: string }
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([`${t.id} (form) depends on ${foreign.id}, which is not a Task of this plan`])
  })

  it('names a Task without affected paths, but not one the app made for a merge', async () => {
    const { r, jobId } = await planWith()
    const t = (await planner(r)('task-create', goodTask(jobId, { affectedPaths: undefined }))).body as { id: string }
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([`Task ${t.id} (form) names no files (--affected-paths)`])
    const s = r.deps.getState()
    const merge = { ...s, tasks: s.tasks.map((x) => (x.id === t.id ? { ...x, parentId: 'tsk_other' } : x)) }
    expect(validatePlan(merge, jobId)).toEqual([])
  })

  it('names two parallel Tasks whose paths overlap (folder vs file), and accepts a dep chain', async () => {
    const { r, jobId } = await planWith()
    const a = (await planner(r)('task-create', goodTask(jobId, { title: 'a', affectedPaths: ['src/ui'] }))).body as { id: string }
    const b = (await planner(r)('task-create', goodTask(jobId, { title: 'b', affectedPaths: ['src/ui/form.tsx'] }))).body as { id: string }
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([
      `Tasks ${a.id} (a) and ${b.id} (b) both change src/ui: make it one Task or chain them with --deps`
    ])
    // a transitive dependency (b waits on c, c waits on a) serialises them
    const c = (await planner(r)('task-create', goodTask(jobId, { title: 'c', affectedPaths: ['docs'], deps: [a.id] }))).body as { id: string }
    await planner(r)('task-update', { id: b.id, deps: [c.id] })
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([])
  })

  it('names a cycle (a hand-edited orchestration.json)', async () => {
    const { r, jobId } = await planWith()
    const a = (await planner(r)('task-create', goodTask(jobId, { title: 'a' }))).body as { id: string }
    const b = (await planner(r)('task-create', goodTask(jobId, { title: 'b', deps: [a.id] }))).body as { id: string }
    const s = r.deps.getState()
    const cyclic = { ...s, tasks: s.tasks.map((t) => (t.id === a.id ? { ...t, deps: [b.id] } : t)) }
    expect(validatePlan(cyclic, jobId)).toEqual([`these Tasks wait on each other in a cycle: ${a.id}, ${b.id}`])
  })

  it('editPlanTask refuses a Task already in a run', async () => {
    const r = rig()
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p' })
    const runTask = (await person(r)('task-create', { run: (made.body as { id: string }).id, account: 'acc1', spec: 's' })).body as { id: string }
    const res = editPlanTask(r.deps.getState(), runTask.id, { prompt: 'p' }, NOW)
    expect(res.ok).toBe(false)
  })
})

describe('approval', () => {
  it('refuses a plan that does not hold, saying what is wrong', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    await planner(r)('task-create', goodTask(jobId))
    await person(r)('task-create', { run: jobId, account: 'acc1', title: 'by hand', spec: 's' })
    const reply = await person(r)('run-start', { run: jobId })
    expect(reply.status).toBe(400)
    // the hand-made Task has no prompt, no criterion, no files and no basis (W6-A)
    expect((reply.body as { problems: string[] }).problems).toHaveLength(4)
    expect(r.deps.getState().jobs[0].pendingStart).toBe(true)
    expect(r.deps.getState().runs).toHaveLength(0)
  })

  it('a person approves: the Job leaves pendingStart, its run gets the Tasks with their plan fields and a coordinator', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const a = (await planner(r)('task-create', goodTask(jobId, { title: 'a' }))).body as { id: string }
    await planner(r)('task-create', goodTask(jobId, { title: 'b', deps: [a.id], difficulty: 'hard' }))
    const reply = await person(r)('run-start', { run: jobId })
    expect(reply.status).toBe(200)
    const s = r.deps.getState()
    expect(s.jobs[0]).not.toHaveProperty('pendingStart')
    expect(s.jobs[0].plannerSessionIds).toEqual([PLANNER])
    expect(s.runs).toHaveLength(1)
    const runTasks = s.tasks.filter((t) => t.runId === s.runs[0].id)
    expect(runTasks.map((t) => [t.title, t.status, t.difficulty])).toEqual([
      ['a', 'ready', 'standard'],
      ['b', 'pending', 'hard']
    ])
    expect(runTasks[0]).toMatchObject({ prompt: 'Build the login form in src/login.tsx.', acceptanceCriteria: ['the form renders', 'npm test passes'], affectedPaths: ['src/login.tsx'] })
    // execution is handed to the coordinator as before (W1 behaviour)
    expect(r.coordinatorStarts.map((x) => x.role ?? 'coordinator')).toEqual(['planner', 'coordinator'])
    expect(s.runs[0].coordinatorSessionId).toBe('ses-coordinator')
    // W5-B (#47): the planner's work is done, so it ends with the approval, and only the planner
    expect(r.stopped).toEqual([[PLANNER, 'its plan was approved']])
  })

  it('a refused approval leaves the planner running', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    await person(r)('task-create', { run: jobId, account: 'acc1', title: 'by hand', spec: 's' })
    expect((await person(r)('run-start', { run: jobId })).status).toBe(400)
    expect(r.stopped).toEqual([])
  })

  it('a Job planned by hand (no planner) starts as before, unvalidated', async () => {
    const r = rig()
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p', auto: true })
    const jobId = (made.body as { id: string }).id
    await person(r)('task-create', { run: jobId, account: 'acc1', spec: 's' })
    expect((await person(r)('run-start', { run: jobId })).status).toBe(200)
  })
})

describe('the worker spec carries the plan fields', () => {
  it('worker-start hands startWorker the prompt, the criteria and the paths', async () => {
    const r = rig()
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p' })
    const runId = (made.body as { id: string }).id
    const t = (await handleCommand(r.deps, { sessionId: 'ses-coordinator' }, 'task-create', { ...goodTask(runId) })).body as { id: string }
    const started = await handleCommand(r.deps, { sessionId: 'ses-coordinator' }, 'worker-start', { taskId: t.id, agent: 'claude', account: 'acc1', worktree: 'current' })
    expect(started.status).toBe(200)
    const spec = r.workerStarts[0].spec as string
    expect(spec).toContain('the login form')
    expect(spec).toContain('## Prompt\n\nBuild the login form in src/login.tsx.')
    expect(spec).toContain('## Acceptance criteria')
    expect(spec).toContain('- npm test passes')
    expect(spec).toContain('## Affected paths')
    expect(spec).toContain('- src/login.tsx')
  })

  it('a Task with no plan fields keeps its spec as it was', () => {
    expect(workerSpecOf({ spec: 'just do it' })).toBe('just do it')
  })
})

describe('plan.md', () => {
  it('renders the Tasks in dependency batches', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const a = (await planner(r)('task-create', goodTask(jobId, { title: 'a' }))).body as { id: string }
    await planner(r)('task-create', goodTask(jobId, { title: 'b' }))
    await planner(r)('task-create', goodTask(jobId, { title: 'c', deps: [a.id] }))
    const md = renderPlanMd(r.deps.getState(), r.deps.getState().jobs[0])
    expect(md).toContain('# Plan: add a login page')
    expect(md).toContain('waiting for approval')
    expect(md).toContain('## Batch 1 (2 Tasks in parallel)')
    expect(md).toContain('## Batch 2')
    expect(md).toContain(`- Waits for: \`${a.id}\``)
    expect(md).toContain('- npm test passes')
  })

  it('the store writes it beside orchestration.json for a planned Job only', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-plan-'))
    try {
      const r = rig()
      const jobId = await plannedJob(r)
      await planner(r)('task-create', goodTask(jobId))
      await person(r)('run-create', { objective: 'unplanned', cwd: 'D:/p', auto: true })
      const store = new OrchestrationStore(path.join(dir, 'orchestration.json'))
      await store.save(r.deps.getState())
      const md = await fs.readFile(planFileOf(dir, jobId), 'utf8')
      expect(md).toContain('Build the login form')
      expect(await fs.readdir(path.join(dir, 'plans'))).toEqual([jobId])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

// W6-C: a Job runs up to 10 workers at once; more reads as 10
describe('Job concurrency up to 10', () => {
  const made = async (r: Rig, extra: Record<string, unknown> = {}): Promise<string> =>
    ((await person(r)('run-create', { objective: 'wide', cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true, ...extra })).body as { id: string }).id

  it('jobs create takes 10 and clamps a larger --concurrency to 10', async () => {
    const r = rig()
    const ten = await made(r, { concurrency: '10' })
    const fifty = await made(r, { concurrency: 50 })
    const none = await made(r)
    const of = (id: string) => r.deps.getState().jobs.find((j) => j.id === id)?.concurrency
    expect([of(ten), of(fifty), of(none)]).toEqual([10, 10, undefined])
  })

  it('jobs plan --concurrency sets the width, clamped, and the planner brief says it', async () => {
    const r = rig()
    const jobId = await made(r)
    expect((await person(r)('jobs-plan', { id: jobId, concurrency: '25' })).status).toBe(200)
    expect(r.deps.getState().jobs[0].concurrency).toBe(10)
    expect(String(r.coordinatorStarts[0].brief)).toContain('workers that may run at once: 10')
    expect((await person(r)('jobs-plan', { id: jobId, concurrency: '0' })).status).toBe(400)
  })
})

// W6-A: check what exists before planning
describe('Task.basis', () => {
  it('validatePlan refuses a Task without a basis, so it cannot be approved', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const t = (await planner(r)('task-create', goodTask(jobId, { basis: undefined, evidence: undefined }))).body as { id: string }
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([`${t.id} (form) has no basis: give --basis missing|partial|broken and its --evidence`])
    const approve = await person(r)('run-start', { run: jobId })
    expect(approve.status).toBe(400)
    expect((approve.body as { problems: string[] }).problems).toHaveLength(1)
  })

  it('task-create refuses a basis that is not missing|partial|broken, and one without evidence', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    for (const extra of [{ basis: 'built' }, { basis: 'missing', evidence: ' ' }, { basis: undefined, evidence: 'x' }])
      expect((await planner(r)('task-create', goodTask(jobId, extra))).status, JSON.stringify(extra)).toBe(400)
  })

  it('task-update sets the basis (PLAN_EDIT), which then holds the plan', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const t = (await planner(r)('task-create', goodTask(jobId, { basis: undefined, evidence: undefined }))).body as { id: string }
    const edited = await planner(r)('task-update', { id: t.id, basis: 'broken', evidence: 'web/login.py:12 throws on submit' })
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ basis: { state: 'broken', evidence: 'web/login.py:12 throws on submit' } })
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([])
  })
})

describe('plan-nothing-to-do', () => {
  it("its planner ends a Job with no Tasks: summary kept, archived, the planner's session ended", async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const reply = await planner(r)('plan-nothing-to-do', { job: jobId, summary: '| login page | built | web/login.py:1 |' })
    expect(reply).toEqual({ status: 200, body: { id: jobId, nothingToDo: true } })
    const job = r.deps.getState().jobs[0]
    expect(job.nothingToDo).toEqual({ at: NOW, summary: '| login page | built | web/login.py:1 |' })
    expect(job.archivedAt).toBe(NOW)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(r.stopped.map(([id]) => id)).toEqual([PLANNER])
  })

  it('is refused with Tasks in the plan, without a summary, for another Job, and to another agent', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    expect((await planner(r)('plan-nothing-to-do', { job: jobId })).status).toBe(400)
    expect((await planner(r)('plan-nothing-to-do', { job: 'job_other', summary: 's' })).status).toBe(403)
    expect((await handleCommand(r.deps, { sessionId: 'ses-coordinator' }, 'plan-nothing-to-do', { job: jobId, summary: 's' })).status).toBe(403)
    await planner(r)('task-create', goodTask(jobId))
    expect((await person(r)('plan-nothing-to-do', { job: jobId, summary: 's' })).status).toBe(409)
    expect(r.deps.getState().jobs[0].nothingToDo).toBeUndefined()
  })
})

describe('T7 objective coverage', () => {
  const OBJECTIVE = 'Fix the follow-ups:\n1. login fails on Safari\n2. logout keeps the cookie\n3. signup has no captcha'
  const listedJob = async (): Promise<{ r: Rig; jobId: string }> => {
    const r = rig()
    const made = await person(r)('run-create', { objective: OBJECTIVE, cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    expect((await person(r)('jobs-plan', { id: jobId })).status).toBe(200)
    return { r, jobId }
  }

  it('names each objective item no Task covers and none is left out', async () => {
    const { r, jobId } = await listedJob()
    await planner(r)('task-create', goodTask(jobId, { covers: '1' }))
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([
      'objective item 2 ("logout keeps the cookie") has no Task: add one with --covers 2, or list it with jobs-set --left-out and a reason',
      'objective item 3 ("signup has no captcha") has no Task: add one with --covers 3, or list it with jobs-set --left-out and a reason'
    ])
    // approval and jobs-plan-ready read the same problems, so the plan goes back to its planner
    const reply = await person(r)('run-start', { run: jobId })
    expect(reply.status).toBe(400)
  })

  it('passes once every item is covered or left out with a reason, which the planner may set', async () => {
    const { r, jobId } = await listedJob()
    const t = (await planner(r)('task-create', goodTask(jobId, { covers: '1,3' }))).body as { id: string; covers: number[] }
    expect(t.covers).toEqual([1, 3])
    const left = await planner(r)('jobs-set', { id: jobId, leftOut: '[{"item":2,"reason":"already built: src/logout.ts"}]' })
    expect(left.status).toBe(200)
    expect(r.deps.getState().jobs[0].leftOut).toEqual([{ item: 2, reason: 'already built: src/logout.ts' }])
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([])
    // a covers edit is a plan edit too
    expect((await planner(r)('task-update', { id: t.id, covers: '1' })).status).toBe(200)
    expect(validatePlan(r.deps.getState(), jobId)).toHaveLength(1)
  })

  it('refuses a left-out item the objective does not have, or one with no reason', async () => {
    const { r, jobId } = await listedJob()
    expect((await planner(r)('jobs-set', { id: jobId, leftOut: '[{"item":9,"reason":"x"}]' })).status).toBe(400)
    expect((await planner(r)('jobs-set', { id: jobId, leftOut: '[{"item":2}]' })).status).toBe(400)
    expect((await planner(r)('jobs-set', { id: jobId, leftOut: '[{"item":2,"reason":"x"}]', concurrency: 2 })).status).toBe(403)
  })

  it('an objective with no list is not checked', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    await planner(r)('task-create', goodTask(jobId))
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([])
  })

  it('a Run planned before --covers existed still replans: replanProblems does not check coverage', async () => {
    const r = rig()
    const made = await person(r)('run-create', { objective: OBJECTIVE, cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    await person(r)('task-create', goodTask(jobId))
    expect((await person(r)('run-start', { run: jobId })).status).toBe(200)
    const runId = r.deps.getState().runs[0].id
    expect(replanProblems(r.deps.getState(), runId)).toEqual([])
  })

  it('the planner renames its own Job only', async () => {
    const { r, jobId } = await listedJob()
    const renamed = await planner(r)('jobs-rename', { id: jobId, title: 'Auth follow-ups' })
    expect(renamed.status).toBe(200)
    expect(r.deps.getState().jobs[0].title).toBe('Auth follow-ups')
    const other = (await person(r)('run-create', { objective: 'another', cwd: 'D:/p' })).body as { jobId?: string; id: string }
    const otherJob = r.deps.getState().jobs.find((j) => j.id !== jobId)!.id
    expect(other.id).toBeDefined()
    expect((await planner(r)('jobs-rename', { id: otherJob, title: 'x' })).status).toBe(403)
  })
})

describe('T7 editPlanTask from the owner', () => {
  const running = async (): Promise<{ r: Rig; a: string; b: string }> => {
    const r = rig()
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p' })
    const runId = (made.body as { id: string }).id
    const a = ((await person(r)('task-create', { run: runId, account: 'acc1', spec: 'a' })).body as { id: string }).id
    const b = ((await person(r)('task-create', { run: runId, account: 'acc1', spec: 'b', deps: [a] })).body as { id: string }).id
    return { r, a, b }
  }

  it('changes deps of a Task that has not started, blocked included, and recomputes readiness', async () => {
    const { r, a, b } = await running()
    const s = r.deps.getState()
    const blocked = { ...s, tasks: s.tasks.map((t) => (t.id === b ? { ...t, status: 'blocked' as const } : t)) }
    const res = editPlanTask(blocked, b, { deps: [] }, NOW, true)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.deps).toEqual([])
    const pending = editPlanTask(s, b, { deps: [] }, NOW, true)
    expect(pending.ok && pending.value.status).toBe('ready')
    expect(editPlanTask(s, a, { deps: [b] }, NOW, true)).toMatchObject({ ok: false, error: `those deps would make ${a} wait on itself` })
  })

  it('refuses a Task that has started, and a caller who is not the owner, naming the rule', async () => {
    const { r, a } = await running()
    const s = r.deps.getState()
    const started = { ...s, tasks: s.tasks.map((t) => (t.id === a ? { ...t, status: 'dispatched' as const } : t)) }
    expect(editPlanTask(started, a, { spec: 'x' }, NOW, true)).toMatchObject({ ok: false, error: expect.stringContaining('has started already (dispatched)') })
    expect(editPlanTask(s, a, { spec: 'x' }, NOW, 'this is a worker session: only the owner changes a running plan, not an agent')).toMatchObject({
      ok: false,
      error: expect.stringContaining('this is a worker session')
    })
  })
})
