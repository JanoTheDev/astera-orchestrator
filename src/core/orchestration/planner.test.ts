// W2-A planner stage: the planner's gate, the plan's validation, its approval, the worker spec and plan.md.
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { editPlanTask, planFileOf, renderPlanMd, validatePlan, workerSpecOf } from './planner'
import { OrchestrationStore } from './store'

const NOW = '2026-10-17T00:00:00.000Z'
const PLANNER = 'ses-planner'

interface Rig {
  deps: OrchServerDeps
  coordinatorStarts: Array<Record<string, unknown>>
  workerStarts: Array<Record<string, unknown>>
}

const rig = (): Rig => {
  let state: OrchState = emptyState()
  const coordinatorStarts: Array<Record<string, unknown>> = []
  const workerStarts: Array<Record<string, unknown>> = []
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
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    readWorker: async () => '',
    now: () => NOW
  } as unknown as OrchServerDeps
  return { deps, coordinatorStarts, workerStarts }
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
    expect((reply.body as { problems: string[] }).problems).toHaveLength(2)
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
