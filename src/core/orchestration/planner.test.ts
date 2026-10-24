// W2-A planner stage: the planner's gate, the plan's validation, its approval, the worker spec and plan.md.
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, startJobRun, type OrchState } from './state'
import type { Task } from './types'
import { cancelPlanTask, editPlanTask, kindOf, planFileOf, planWarnings, renderPlanFolder, renderPlanMd, renderTaskMd, validatePlan, workerSpecOf } from './planner'
import { OrchestrationStore } from './store'
import { replanProblems } from './exec/replanStart'
import { deriveActivity } from './activity'

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
  // T25: a planner start waiting for an account with room shows its reason on the Job, and the Job loses it once it starts
  it('records why the planner start waits on the Job, and clears it once the planner starts', async () => {
    const r = rig()
    let seen: string | undefined
    r.deps.startCoordinator = async (a) => {
      const onWait = a.onWait as (why: string | null) => void
      onWait('no claude account has room to start the planner on: acc1 (its weekly limit is at the usage threshold)')
      seen = r.deps.getState().jobs[0].startWait
      onWait(null)
      return { sessionId: PLANNER }
    }
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    expect((await person(r)('jobs-plan', { id: jobId })).status).toBe(200)
    expect(seen).toMatch(/no claude account has room.*weekly limit/)
    expect(r.deps.getState().jobs[0]).not.toHaveProperty('startWait')
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

  it('takes each --effort level, refuses another, and task-update changes it', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'])
      expect((await planner(r)('task-create', goodTask(jobId, { effort }))).body).toMatchObject({ effort })
    const bad = await planner(r)('task-create', goodTask(jobId, { effort: 'ultra' }))
    expect(bad).toMatchObject({ status: 400, body: { error: '--effort must be one of low|medium|high|xhigh|max' } })
    const made = await planner(r)('task-create', goodTask(jobId, { effort: 'low' }))
    const edited = await planner(r)('task-update', { id: (made.body as { id: string }).id, effort: 'max' })
    expect(edited.body).toMatchObject({ effort: 'max' })
    expect((await planner(r)('task-update', { id: (made.body as { id: string }).id, effort: 'x' })).status).toBe(400)
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
  /** T7: the Job's project, with serial files on. */
  const serialFiles = async (r: Rig, jobId: string): Promise<void> => {
    const s = r.deps.getState()
    const cwd = s.jobs.find((j) => j.id === jobId)!.cwd
    await r.deps.setState({
      ...s,
      projects: [...s.projects, { id: 'prj_t7', path: cwd, name: 'p', addedAt: s.jobs[0].createdAt, serialFiles: true }],
      jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, projectId: 'prj_t7' } : j))
    })
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

  it('names a dependency that is no Task of a plan', async () => {
    const { r, jobId } = await planWith()
    const t = (await planner(r)('task-create', goodTask(jobId))).body as { id: string }
    const s = r.deps.getState()
    await r.deps.setState({ ...s, tasks: s.tasks.map((x) => (x.id === t.id ? { ...x, deps: ['tsk_gone'] } : x)) })
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([`${t.id} (form): tsk_gone is not a Task of this plan or of another plan of this project`])
  })

  // T1 the main plan: a Task may wait on a Task of another active plan of the same project
  it('accepts a dep on a Task of another active plan of the project', async () => {
    const { r, jobId } = await planWith()
    const other = await person(r)('run-create', { objective: 'other', cwd: 'D:/p', auto: true })
    const foreign = (await person(r)('task-create', { run: (other.body as { id: string }).id, account: 'acc1', spec: 's' })).body as { id: string }
    const t = await person(r)('task-create', { ...goodTask(jobId), deps: [foreign.id] })
    expect(t.status).toBe(200)
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([])
  })

  it("refuses a dep on another project's Task, at task-create and task-update", async () => {
    const { r, jobId } = await planWith()
    const other = await person(r)('run-create', { objective: 'other', cwd: 'D:/q', auto: true })
    const foreign = (await person(r)('task-create', { run: (other.body as { id: string }).id, account: 'acc1', spec: 's' })).body as { id: string }
    const made = await planner(r)('task-create', { ...goodTask(jobId), deps: [foreign.id] })
    expect(made.status).toBe(400)
    expect(JSON.stringify(made.body)).toContain('another project')
    const t = (await planner(r)('task-create', goodTask(jobId))).body as { id: string }
    const edited = await planner(r)('task-update', { id: t.id, deps: [foreign.id] })
    expect(edited.status).toBe(400)
    expect(JSON.stringify(edited.body)).toContain('another project')
  })

  it("refuses a dep on an archived plan's Task", async () => {
    const { r, jobId } = await planWith()
    const other = (await person(r)('run-create', { objective: 'other', cwd: 'D:/p', auto: true })).body as { id: string }
    const foreign = (await person(r)('task-create', { run: other.id, account: 'acc1', spec: 's' })).body as { id: string }
    const s = r.deps.getState()
    await r.deps.setState({ ...s, jobs: s.jobs.map((j) => (j.id === other.id ? { ...j, archivedAt: NOW } : j)) })
    const made = await planner(r)('task-create', { ...goodTask(jobId), deps: [foreign.id] })
    expect(made.status).toBe(400)
    expect(JSON.stringify(made.body)).toContain('archived')
  })

  it('refuses a cycle across two plans', async () => {
    const { r, jobId } = await planWith()
    const other = (await person(r)('run-create', { objective: 'other', cwd: 'D:/p', auto: true })).body as { id: string }
    const b = (await person(r)('task-create', { run: other.id, account: 'acc1', spec: 's' })).body as { id: string }
    const a = (await planner(r)('task-create', { ...goodTask(jobId), deps: [b.id] })).body as { id: string }
    const back = await person(r)('task-update', { id: b.id, deps: [a.id] })
    expect(back.status).toBe(400)
    expect(JSON.stringify(back.body)).toContain('wait on itself')
    // written by hand, validatePlan names it
    const s = r.deps.getState()
    await r.deps.setState({ ...s, tasks: s.tasks.map((x) => (x.id === b.id ? { ...x, deps: [a.id] } : x)) })
    expect(validatePlan(r.deps.getState(), jobId)).toContain(
      `${a.id} (form) waits on itself through another plan's Tasks: these plans wait on each other in a cycle`
    )
  })

  it('names a Task without affected paths, but not one the app made for a merge', async () => {
    const { r, jobId } = await planWith()
    const t = (await planner(r)('task-create', goodTask(jobId, { affectedPaths: undefined }))).body as { id: string }
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([expect.stringContaining(`Task ${t.id} (form) names no files (--affected-paths`)])
    const s = r.deps.getState()
    const merge = { ...s, tasks: s.tasks.map((x) => (x.id === t.id ? { ...x, parentId: 'tsk_other' } : x)) }
    expect(validatePlan(merge, jobId)).toEqual([])
  })

  it('accepts an ops, audit or docs Task that says --no-files, and still refuses one with no paths and no flag', async () => {
    const { r, jobId } = await planWith()
    const t = (await planner(r)('task-create', goodTask(jobId, { affectedPaths: undefined, kind: 'ops', noFiles: true }))).body as { id: string }
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([])
    expect(r.deps.getState().tasks.find((x) => x.id === t.id)?.noFiles).toBe(true)
    const bare = (await planner(r)('task-create', goodTask(jobId, { title: 'bare', affectedPaths: undefined, kind: 'ops' }))).body as { id: string }
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([expect.stringContaining(`Task ${bare.id} (bare) names no files`)])
  })

  it('refuses --no-files on a feature Task, and next to --affected-paths', async () => {
    const { r, jobId } = await planWith()
    const feature = (await planner(r)('task-create', goodTask(jobId, { affectedPaths: undefined, kind: 'feature', noFiles: true }))).body as { id: string }
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([expect.stringContaining(`Task ${feature.id} (form) says --no-files but is not --kind ops|audit|docs`)])
    const both = await planner(r)('task-create', goodTask(jobId, { kind: 'ops', noFiles: true }))
    expect(both.status).toBe(400)
  })

  it('a --no-files Task overlaps no other Task', async () => {
    const { r, jobId } = await planWith()
    await serialFiles(r, jobId)
    await planner(r)('task-create', goodTask(jobId, { title: 'a', affectedPaths: ['src/ui'] }))
    await planner(r)('task-create', goodTask(jobId, { title: 'b', affectedPaths: undefined, kind: 'audit', noFiles: true }))
    expect(validatePlan(r.deps.getState(), jobId)).toEqual([])
  })

  it('task-create and task-update answer with the problems approval would find in that Task', async () => {
    const { r, jobId } = await planWith()
    const made = await planner(r)('task-create', goodTask(jobId, { affectedPaths: undefined, kind: 'ops' }))
    const id = (made.body as { id: string }).id
    expect((made.body as { warnings: string[] }).warnings).toEqual([expect.stringContaining('names no files')])
    const fixed = await planner(r)('task-update', { id, noFiles: true })
    expect((fixed.body as { warnings?: string[] }).warnings).toBeUndefined()
    const wrong = await planner(r)('task-update', { id, kind: 'feature' })
    expect((wrong.body as { warnings: string[] }).warnings).toEqual([expect.stringContaining('says --no-files but is not --kind')])
  })

  it('warns the planner, never the owner, when the plan has no real name', async () => {
    const { r, jobId } = await planWith()
    expect(planWarnings(r.deps.getState(), jobId)).toEqual([expect.stringContaining(`astera jobs rename --id ${jobId}`)])
    const s = r.deps.getState()
    const job = s.jobs.find((j) => j.id === jobId)!
    const titled = (title: string) => ({ ...s, jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, title } : j)) })
    expect(planWarnings(titled(job.objective), jobId)).toHaveLength(1)
    expect(planWarnings(titled('Login form'), jobId)).toEqual([])
    expect(validatePlan(s, jobId).join()).not.toContain('real name')
  })

  it('names two parallel Tasks whose paths overlap (folder vs file), and accepts a dep chain', async () => {
    const { r, jobId } = await planWith()
    await serialFiles(r, jobId)
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

  it('T7: without serial files two parallel Tasks on the same files are a valid plan', async () => {
    const { r, jobId } = await planWith()
    await planner(r)('task-create', goodTask(jobId, { title: 'a', affectedPaths: ['src/ui'] }))
    await planner(r)('task-create', goodTask(jobId, { title: 'b', affectedPaths: ['src/ui/form.tsx'] }))
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

describe('plan folder', () => {
  /** Three Tasks over two waves: a and b in wave 1, c after a. */
  const threeTasks = async (r: Rig): Promise<{ jobId: string; a: string }> => {
    const jobId = await plannedJob(r)
    const a = (await planner(r)('task-create', goodTask(jobId, { title: 'a', kind: 'bugfix' }))).body as { id: string }
    await planner(r)('task-create', goodTask(jobId, { title: 'b' }))
    await planner(r)('task-create', goodTask(jobId, { title: 'c', deps: [a.id] }))
    return { jobId, a: a.id }
  }

  it('plan.md has the status, a waves table and links to the task files', async () => {
    const r = rig()
    const { jobId } = await threeTasks(r)
    const job = r.deps.getState().jobs.find((j) => j.id === jobId)!
    const md = renderPlanMd(r.deps.getState(), job, 'Use the existing store.')
    expect(md).toContain('# Plan: add a login page')
    expect(md).toContain('- Status: waiting for approval')
    expect(md).toContain('## Decisions\n\nUse the existing store.')
    expect(md).toContain('[inputs/](inputs/)')
    expect(md).toContain('| 1 | [a](tasks/01-a.md) | bugfix | standard |')
    expect(md).toContain('| 2 | [c](tasks/03-c.md) | feature | standard | - | pending | acc1 | 01 |')
  })

  it('renders plan.md and one file per Task', async () => {
    const r = rig()
    const { jobId } = await threeTasks(r)
    const job = r.deps.getState().jobs.find((j) => j.id === jobId)!
    const files = renderPlanFolder(r.deps.getState(), job)
    expect([...files.keys()]).toEqual(['plan.md', 'tasks/01-a.md', 'tasks/02-b.md', 'tasks/03-c.md'])
    const task = files.get('tasks/01-a.md')!
    expect(task).toContain('- Kind: bugfix')
    expect(task).toContain('- [ ] the form renders')
    expect(task.indexOf('## Prompt')).toBeGreaterThan(task.indexOf('## Status history'))
  })

  it('a completed Task ticks its criteria and carries its report', async () => {
    const r = rig()
    const { jobId } = await threeTasks(r)
    const state = r.deps.getState()
    const done = state.tasks.map((t) => (t.title === 'a' ? { ...t, status: 'completed' as const, result: 'Built the form.', filesModified: ['src/login.tsx'], updatedAt: '2026-10-17T01:00:00.000Z' } : t))
    const md = renderTaskMd({ ...state, tasks: done }, done.find((t) => t.title === 'a')!, 1)
    expect(md).toContain('- [x] the form renders')
    expect(md).toContain('## Report\n\nBuilt the form.')
    expect(md).toContain('- `src/login.tsx`')
    expect(md).toContain('2026-10-17T01:00:00.000Z completed')
    expect(jobId).toBeTruthy()
  })

  it('the Run, once there is one, is what the folder follows: wave N of M', async () => {
    const r = rig()
    const { jobId } = await threeTasks(r)
    const state = r.deps.getState()
    const started = startJobRun(state, jobId, NOW)
    if (!started.ok) throw new Error(started.error)
    const job = started.state.jobs.find((j) => j.id === jobId)!
    expect(renderPlanMd(started.state, { ...job, pendingStart: false })).toContain('- Status: running wave 1 of 2')
  })

  it('the store writes the folder for a planned Job only, and removes the file of a deleted Task', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-plan-'))
    try {
      const r = rig()
      const { jobId } = await threeTasks(r)
      await person(r)('run-create', { objective: 'unplanned', cwd: 'D:/p', auto: true })
      const store = new OrchestrationStore(path.join(dir, 'orchestration.json'))
      await fs.mkdir(path.join(dir, 'plans', jobId, 'inputs'), { recursive: true })
      await fs.writeFile(path.join(dir, 'plans', jobId, 'inputs', 'existing.md'), '# Existing\n\n## Decisions\n\n- pick sqlite\n\n## Other\n\nx\n')
      await store.save(r.deps.getState())
      expect(await fs.readFile(planFileOf(dir, jobId), 'utf8')).toContain('## Decisions\n\n- pick sqlite')
      expect(await fs.readdir(path.join(dir, 'plans'))).toEqual([jobId])
      expect(await fs.readdir(path.join(dir, 'plans', jobId, 'tasks'))).toEqual(['01-a.md', '02-b.md', '03-c.md'])
      const c = r.deps.getState().tasks.find((t) => t.title === 'c')!
      const cancelled = cancelPlanTask(r.deps.getState(), c.id)
      if (!cancelled.ok) throw new Error(cancelled.error)
      await r.deps.setState(cancelled.state)
      await store.save(r.deps.getState())
      expect(await fs.readdir(path.join(dir, 'plans', jobId, 'tasks'))).toEqual(['01-a.md', '02-b.md'])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('kindOf', () => {
  it('uses the Task kind, else reads the title and spec', () => {
    const k = (title: string, spec = '', kind?: Task['kind']) => kindOf({ title, spec, kind })
    expect(k('Fix the crash on save')).toBe('bugfix')
    expect(k('Audit the auth flow')).toBe('audit')
    expect(k('Login page')).toBe('ui')
    expect(k('Add export', 'a button to download')).toBe('ui')
    expect(k('Add export')).toBe('feature')
    expect(k('Fix the crash', '', 'docs')).toBe('docs')
  })
})

describe('--kind', () => {
  it('task-create and task-update take a kind and refuse an unknown one', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const made = await planner(r)('task-create', goodTask(jobId, { kind: 'refactor' }))
    const id = (made.body as { id: string }).id
    expect(r.deps.getState().tasks.find((t) => t.id === id)?.kind).toBe('refactor')
    await planner(r)('task-update', { id, kind: 'ui' })
    expect(r.deps.getState().tasks.find((t) => t.id === id)?.kind).toBe('ui')
    const bad = await planner(r)('task-update', { id, kind: 'magic' })
    expect(JSON.stringify(bad)).toContain('--kind must be one of')
  })
})

// T3: worktree per Task
describe('--worktree', () => {
  it('takes new|reuse on task-create and task-update, shown in plan.md and the task file', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const a = (await planner(r)('task-create', goodTask(jobId, { title: 'a', worktree: 'new' }))).body as Task
    expect(a.worktree).toBe('new')
    const b = (await planner(r)('task-create', goodTask(jobId, { title: 'b', deps: [a.id], worktree: 'reuse' }))).body as Task
    expect(b.worktree).toBe('reuse')
    expect(JSON.stringify(await planner(r)('task-update', { id: b.id, worktree: 'shared' }))).toContain('--worktree must be new|reuse')
    const s = r.deps.getState()
    expect(renderPlanMd(s, s.jobs.find((j) => j.id === jobId)!)).toContain('| standard | reuse | pending |')
    expect(renderTaskMd(s, s.tasks.find((t) => t.id === b.id)!, 2)).toContain('- Worktree: reuse')
  })

  it('refuses reuse without exactly one dep of its plan, or for a dep another Task reuses', async () => {
    const r = rig()
    const jobId = await plannedJob(r)
    const a = (await planner(r)('task-create', goodTask(jobId, { title: 'a' }))).body as Task
    const b = (await planner(r)('task-create', goodTask(jobId, { title: 'b' }))).body as Task
    const none = await planner(r)('task-create', goodTask(jobId, { title: 'c', worktree: 'reuse' }))
    expect(none.status).toBe(400)
    expect(JSON.stringify(none.body)).toContain('needs exactly one dep')
    expect((await planner(r)('task-create', goodTask(jobId, { title: 'c', deps: [a.id, b.id], worktree: 'reuse' }))).status).toBe(400)
    const c = (await planner(r)('task-create', goodTask(jobId, { title: 'c', deps: [a.id], worktree: 'reuse' }))).body as Task
    const second = await planner(r)('task-create', goodTask(jobId, { title: 'd', deps: [a.id], worktree: 'reuse' }))
    expect(second.status).toBe(400)
    expect(JSON.stringify(second.body)).toContain(`${c.id} already reuses ${a.id}'s worktree`)
    // a refused create leaves no Task behind, and an edit that breaks the rule is refused too
    expect(r.deps.getState().tasks.filter((t) => t.jobId === jobId)).toHaveLength(3)
    const d = (await planner(r)('task-create', goodTask(jobId, { title: 'd', deps: [b.id] }))).body as Task
    expect((await planner(r)('task-update', { id: d.id, deps: [a.id], worktree: 'reuse' })).status).toBe(400)
    expect((await planner(r)('task-update', { id: c.id, deps: [a.id, b.id] })).status).toBe(400)
    expect((await planner(r)('task-update', { id: d.id, worktree: 'reuse' })).status).toBe(200)
  })
})

// W6-C: a Job runs up to 100 workers at once; more reads as 100
describe('Job concurrency up to 100', () => {
  const made = async (r: Rig, extra: Record<string, unknown> = {}): Promise<string> =>
    ((await person(r)('run-create', { objective: 'wide', cwd: 'D:/p', coordinatorAccount: 'acc1', auto: true, ...extra })).body as { id: string }).id

  it('jobs create takes 100 and clamps a larger --concurrency to 100', async () => {
    const r = rig()
    const ten = await made(r, { concurrency: '100' })
    const fifty = await made(r, { concurrency: 500 })
    const none = await made(r)
    const of = (id: string) => r.deps.getState().jobs.find((j) => j.id === id)?.concurrency
    expect([of(ten), of(fifty), of(none)]).toEqual([100, 100, undefined])
  })

  it('jobs plan --concurrency sets the width, clamped, and the planner brief says it', async () => {
    const r = rig()
    const jobId = await made(r)
    expect((await person(r)('jobs-plan', { id: jobId, concurrency: '250' })).status).toBe(200)
    expect(r.deps.getState().jobs[0].concurrency).toBe(100)
    expect(String(r.coordinatorStarts[0].brief)).toContain('workers that may run at once: 100')
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

describe('T2 editPlanTask on a started Task', () => {
  const started = async (status: 'dispatched' | 'completed' = 'dispatched'): Promise<{ s: OrchState; a: string }> => {
    const r = rig()
    const made = await person(r)('run-create', { objective: 'o', cwd: 'D:/p' })
    const runId = (made.body as { id: string }).id
    const a = ((await person(r)('task-create', { run: runId, account: 'acc1', spec: 'a' })).body as { id: string }).id
    const s = r.deps.getState()
    return { s: { ...s, tasks: s.tasks.map((t) => (t.id === a ? { ...t, status, model: 'sonnet', effort: 'low' as const } : t)) }, a }
  }

  it('lets the owner change model, effort, difficulty and model reason', async () => {
    const { s, a } = await started()
    const res = editPlanTask(s, a, { model: 'opus', effort: 'high', difficulty: 'hard', modelReason: 'retry needs more' }, NOW, true)
    expect(res.ok && res.value).toMatchObject({ model: 'opus', effort: 'high', difficulty: 'hard', modelReason: 'retry needs more', status: 'dispatched' })
  })

  it('clears model and effort when --difficulty comes alone', async () => {
    const { s, a } = await started()
    const res = editPlanTask(s, a, { difficulty: 'hard' }, NOW, true)
    expect(res.ok && res.value.difficulty).toBe('hard')
    expect(res.ok && res.value.model).toBeUndefined()
    expect(res.ok && res.value.effort).toBeUndefined()
  })

  it('still refuses --spec and --prompt on a started Task', async () => {
    const { s, a } = await started()
    for (const patch of [{ spec: 'x' }, { prompt: 'x' }, { model: 'opus', spec: 'x' }])
      expect(editPlanTask(s, a, patch, NOW, true)).toMatchObject({ ok: false, error: expect.stringContaining('has started already') })
  })

  it('refuses everything on a finished Task', async () => {
    const { s, a } = await started('completed')
    for (const patch of [{ model: 'opus' }, { difficulty: 'hard' as const }, { spec: 'x' }])
      expect(editPlanTask(s, a, patch, NOW, true)).toMatchObject({ ok: false, error: expect.stringContaining('has finished') })
  })

  it('refuses a non-owner', async () => {
    const { s, a } = await started()
    expect(editPlanTask(s, a, { model: 'opus' }, NOW, 'this is a worker session')).toMatchObject({ ok: false, error: expect.stringContaining('this is a worker session') })
  })
})

describe('T20 run it from the planner chat', () => {
  const T0 = Date.parse(NOW)
  const MIN = 60_000
  const WORDS = 'okay finish the plan and start'
  /** A ready plan; `typedAt` is when a person last typed in the planner's terminal (registry.ts lastTyped), null for never. */
  const ready = async (typedAt: number | null) => {
    const r = rig()
    ;(r.deps as { ownerInputAt?: (id: string) => number | null }).ownerInputAt = (id) => (id === PLANNER ? typedAt : null)
    const jobId = await plannedJob(r)
    expect((await planner(r)('task-create', goodTask(jobId))).status).toBe(200)
    return { r, jobId }
  }
  const approve = (r: Rig, args: Record<string, unknown>) => planner(r)('run-start', args)

  it('approves when the person typed after the last plan change, and records their words', async () => {
    const { r, jobId } = await ready(T0 + MIN)
    const before = r.deps.getState()
    const reply = await approve(r, { run: jobId, ownerSaid: WORDS })
    expect(reply.status).toBe(200)
    const s = r.deps.getState()
    expect(s.jobs[0]).not.toHaveProperty('pendingStart')
    expect(s.jobs[0].approvedFromChat).toEqual({ at: NOW, words: WORDS })
    expect(deriveActivity(before, s).find((d) => d.type === 'plan.chat-approved')?.payload.reason).toBe(WORDS)
    expect(r.stopped.map(([id]) => id)).toContain(PLANNER)
  })

  it('refuses with the ask-the-person text when nobody typed (what input sent by an agent leaves: sessions send never sets it)', async () => {
    const { r, jobId } = await ready(null)
    const reply = await approve(r, { run: jobId, ownerSaid: WORDS })
    expect(reply.status).toBe(403)
    expect(JSON.stringify(reply.body)).toContain("ask them to confirm here (type 'run it')")
    expect(r.deps.getState().jobs[0].pendingStart).toBe(true)
  })

  it('refuses input from before the plan last changed, and a cancel is a change', async () => {
    const { r, jobId } = await ready(T0 - MIN)
    expect((await approve(r, { run: jobId, ownerSaid: WORDS })).status).toBe(403)
    const t = await ready(T0 + MIN)
    const second = (await planner(t.r)('task-create', goodTask(t.jobId, { title: 'b', affectedPaths: ['src/b.tsx'] }))).body as { id: string }
    t.r.deps.now = () => new Date(T0 + 2 * MIN).toISOString()
    // the second Task was made at NOW; cancelling it later is the last change
    expect((await planner(t.r)('task-cancel', { id: second.id, reason: 'not needed' })).status).toBe(200)
    expect((await approve(t.r, { run: t.jobId, ownerSaid: WORDS })).status).toBe(403)
  })

  it('refuses input older than 30 minutes', async () => {
    const { r, jobId } = await ready(T0 + MIN)
    r.deps.now = () => new Date(T0 + 40 * MIN).toISOString()
    expect((await approve(r, { run: jobId, ownerSaid: WORDS })).status).toBe(403)
  })

  it('needs the words, and only its own Job', async () => {
    const { r, jobId } = await ready(T0 + MIN)
    expect(JSON.stringify((await approve(r, { run: jobId })).body)).toContain('--owner-said')
    const other = await approve(r, { run: 'job_other', ownerSaid: WORDS })
    expect(other.status).toBe(403)
    expect(JSON.stringify(other.body)).toContain(`pass --run ${jobId}`)
    expect(r.deps.getState().jobs[0].pendingStart).toBe(true)
  })

  it('a plan that does not hold answers with every problem, and stays unapproved', async () => {
    const { r, jobId } = await ready(T0 + MIN)
    await person(r)('task-create', { run: jobId, account: 'acc1', title: 'by hand', spec: 's' })
    r.deps.ownerInputAt = () => T0 + MIN
    const reply = await approve(r, { run: jobId, ownerSaid: WORDS })
    expect(reply.status).toBe(400)
    const body = reply.body as { problems: string[]; error: string }
    expect(body.problems).toHaveLength(4)
    expect(body.error).toContain('ask the person to confirm again')
    expect(r.deps.getState().jobs[0].pendingStart).toBe(true)
  })

  it('the app button path is unchanged: a person approves with no words and nothing is recorded', async () => {
    const { r, jobId } = await ready(null)
    expect((await person(r)('run-start', { run: jobId })).status).toBe(200)
    expect(r.deps.getState().jobs[0]).not.toHaveProperty('approvedFromChat')
  })

  it('another agent session cannot use --owner-said', async () => {
    const { r, jobId } = await ready(T0 + MIN)
    expect((await handleCommand(r.deps, { sessionId: 'ses-other' }, 'run-start', { run: jobId, ownerSaid: WORDS })).status).toBe(403)
  })
})
