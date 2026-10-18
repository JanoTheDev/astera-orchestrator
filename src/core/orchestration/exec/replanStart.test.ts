// W6-D wave replanning through the real command layer: the replan's start (hold, brief, fresh planner), what its
// session may change, its end (validate, release, summary, session ended) and the escalations.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from '../command'
import { emptyState, type OrchState } from '../state'
import { deriveActivity, noticeOf, type ActivityEvent } from '../activity'
import type { Task } from '../types'

const NOW = '2026-10-18T00:00:00.000Z'
const LATER = '2026-10-18T01:00:00.000Z'

const rig = () => {
  let state: OrchState = emptyState()
  let now = NOW
  let planners = 0
  const starts: Array<Record<string, unknown>> = []
  const stopped: string[] = []
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    startWorker: async () => ({ sessionId: 'ses-worker', cwd: '/repo', specPath: '/s.md' }),
    startCoordinator: async (a: Record<string, unknown>) => {
      starts.push(a)
      return { sessionId: a.role === 'planner' ? `ses-planner-${++planners}` : 'ses-coordinator' }
    },
    stopCoordinator: async (sessionId: string) => {
      stopped.push(sessionId)
    },
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'a', provider: 'claude' }],
    readWorker: async () => '',
    now: () => now
  } as unknown as OrchServerDeps
  const as = (sessionId: string) => (cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId }, cmd, args)
  return {
    deps,
    starts,
    stopped,
    person: as(''),
    as,
    state: () => state,
    set: (s: OrchState) => (state = s),
    tick: () => (now = LATER)
  }
}
type Rig = ReturnType<typeof rig>

const plan = (title: string, extra: Record<string, unknown> = {}) => ({
  account: 'acc1',
  title,
  spec: `the ${title} part`,
  prompt: `Build ${title}.`,
  criteria: [`${title} works`],
  affectedPaths: [`src/${title}.ts`],
  // W6-A: validatePlan asks every planned Task why it is needed
  basis: 'missing',
  evidence: `no ${title} in src/`,
  ...extra
})

/** A planned Job with A ← B ← C, approved, its Run running; A has completed with a report and a passed review. */
const approved = async (r: Rig, job: Record<string, unknown> = {}) => {
  const made = await r.person('run-create', { objective: 'ship the feature', cwd: '/repo', coordinatorAccount: 'acc1', auto: true, ...job })
  const jobId = (made.body as { id: string }).id
  expect((await r.person('jobs-plan', { id: jobId })).status).toBe(200)
  const planner = r.as('ses-planner-1')
  const a = (await planner('task-create', { run: jobId, ...plan('A') })).body as Task
  const b = (await planner('task-create', { run: jobId, ...plan('B', { deps: [a.id] }) })).body as Task
  await planner('task-create', { run: jobId, ...plan('C', { deps: [b.id] }) })
  expect((await r.person('run-start', { run: jobId })).status).toBe(200)
  const runId = r.state().runs[0].id
  const s = r.state()
  r.set({
    ...s,
    tasks: s.tasks.map((t) =>
      t.runId === runId && t.title === 'A'
        ? { ...t, status: 'completed' as const, result: 'built A in src/A.ts', filesModified: ['src/A.ts'], reviewRequested: true, reviewIssues: [] }
        : t.runId === runId && t.title === 'B'
          ? { ...t, status: 'ready' as const }
          : t
    )
  })
  const id = (title: string) => r.state().tasks.find((t) => t.runId === runId && t.title === title)!.id
  return { jobId, runId, id }
}

const job = (r: Rig) => r.state().jobs[0]

describe('jobs-replan', () => {
  it('holds the Job and starts a fresh planner whose brief has what was done and what is left', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    const before = r.state()
    const started = await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    expect(started.status).toBe(200)
    expect(job(r).dispatchHold).toBe(true)
    expect(job(r).replanning).toMatchObject({ runId, mode: 'wave', wave: 1, done: 1, sessionId: 'ses-planner-2' })
    expect(job(r).plannerSessionIds).toContain('ses-planner-2')
    const start = r.starts.at(-1)!
    expect(start).toMatchObject({ role: 'planner', runId: jobId, accountId: 'acc1' })
    const brief = start.brief as string
    expect(brief).toContain('ship the feature')
    expect(brief).toContain('built A in src/A.ts')
    expect(brief).toContain('review: passed, no issues')
    expect(brief).toContain('changed files: src/A.ts')
    expect(brief).toContain(`${id('B')} (B)`)
    expect(brief).toContain(`--run ${runId}`)
    expect(deriveActivity(before, r.state()).map((e) => e.type)).toContain('plan.replanning')
  })

  it('is refused to an agent session, while one runs, and with replanning off', async () => {
    const r = rig()
    const { jobId } = await approved(r)
    expect((await r.as('ses-coordinator')('jobs-replan', { id: jobId })).status).toBe(403)
    expect((await r.person('jobs-replan', { id: jobId })).status).toBe(200)
    expect((await r.person('jobs-replan', { id: jobId })).status).toBe(409)
    const off = rig()
    const o = await approved(off, { replan: 'off' })
    expect(off.state().jobs[0].replan).toBe('off')
    expect((await off.person('jobs-replan', { id: o.jobId })).status).toBe(409)
  })

  it('escalates and keeps the hold when its planner cannot start', async () => {
    const r = rig()
    const { jobId } = await approved(r)
    r.deps.startCoordinator = async () => {
      throw new Error('no pty')
    }
    expect((await r.person('jobs-replan', { id: jobId })).status).toBe(502)
    expect(job(r).replanning).toBeUndefined()
    expect(job(r).dispatchHold).toBe(true)
    expect(job(r).lastReplan?.escalated).toContain('no pty')
  })
})

describe('a replan session', () => {
  it('changes only what has not started, adds to its Run, cancels with a reason, and never starts work', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    await r.person('jobs-replan', { id: jobId, run: runId })
    r.tick()
    const replanner = r.as('ses-planner-2')
    expect((await replanner('task-update', { id: id('A'), prompt: 'redo A' })).status).toBe(403)
    expect((await replanner('task-update', { id: id('B'), status: 'completed' })).status).toBe(403)
    expect((await replanner('task-update', { id: id('B'), prompt: 'Build B on top of src/A.ts.' })).status).toBe(200)
    expect(r.state().tasks.find((t) => t.id === id('B'))!.prompt).toBe('Build B on top of src/A.ts.')
    expect((await replanner('task-create', { run: jobId, ...plan('D') })).status).toBe(403)
    expect((await replanner('task-create', { run: runId, ...plan('D', { deps: [id('A')] }) })).status).toBe(200)
    expect((await replanner('worker-start', { task: id('B'), agent: 'claude', account: 'acc1' })).status).toBe(403)
    expect((await replanner('task-cancel', { id: id('C') })).status).toBe(400)
    expect((await replanner('task-cancel', { id: id('B'), reason: 'not needed' })).status).toBe(400)
    expect((await replanner('task-cancel', { id: id('C'), reason: 'A already covers it' })).status).toBe(200)
    expect(r.state().tasks.some((t) => t.id === id('B'))).toBe(true)
    // no other agent cancels
    expect((await r.as('ses-coordinator')('task-cancel', { id: id('B'), reason: 'x' })).status).toBe(403)

    const before = r.state()
    const done = await replanner('jobs-replan-done', { id: jobId, summary: 'B builds on A; C was folded into A' })
    expect(done.status).toBe(200)
    expect(job(r).dispatchHold).toBeUndefined()
    expect(job(r).replanning).toBeUndefined()
    expect(job(r).lastReplan).toMatchObject({ runId, mode: 'wave', summary: '1 Task added, 1 changed, 1 cancelled: B builds on A; C was folded into A' })
    expect(r.stopped).toContain('ses-planner-2')
    const lines = deriveActivity(before, r.state())
    expect(lines.find((e) => e.type === 'plan.replanned')?.payload.summary).toContain('1 Task added')
  })

  it('never touches a running Task', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    const s = r.state()
    r.set({
      ...s,
      tasks: s.tasks.map((t) => (t.id === id('B') ? { ...t, status: 'dispatched' as const } : t)),
      dispatches: [{ id: 'dsp_b', taskId: id('B'), provider: 'claude', accountId: 'acc1', sessionId: 'ses-w', cwd: '/wt', specPath: '/s.md', startedAt: NOW, workerState: 'ready', retained: false }]
    })
    await r.person('jobs-replan', { id: jobId, run: runId })
    const replanner = r.as('ses-planner-2')
    expect((await replanner('task-update', { id: id('B'), prompt: 'x' })).status).toBe(403)
    expect((await replanner('task-cancel', { id: id('B'), reason: 'x' })).status).toBe(403)
  })
})

describe('jobs-replan-done', () => {
  it('keeps the hold and escalates when the remaining plan does not hold', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    await r.person('jobs-replan', { id: jobId, run: runId })
    const s = r.state()
    r.set({ ...s, tasks: s.tasks.map((t) => (t.id === id('C') ? { ...t, prompt: undefined } : t)) })
    const before = r.state()
    const done = await r.as('ses-planner-2')('jobs-replan-done', { id: jobId })
    expect(done.body).toMatchObject({ held: true })
    expect(job(r).dispatchHold).toBe(true)
    expect(job(r).lastReplan?.escalated).toContain('has no prompt')
    const line = deriveActivity(before, r.state()).find((e) => e.type === 'task.escalated')
    expect(line).toBeDefined()
    expect(noticeOf({ ...line!, id: 'e1', sequence: 1, occurredAt: NOW } as ActivityEvent)).not.toBeNull()
  })

  it("leaves a person's own hold in place", async () => {
    const r = rig()
    const { jobId } = await approved(r)
    await r.person('jobs-hold', { id: jobId })
    await r.person('jobs-replan', { id: jobId })
    await r.as('ses-planner-2')('jobs-replan-done', { id: jobId })
    expect(job(r).dispatchHold).toBe(true)
    expect(job(r).lastReplan?.escalated).toBeUndefined()
  })

  it('is refused to another agent session', async () => {
    const r = rig()
    const { jobId } = await approved(r)
    await r.person('jobs-replan', { id: jobId })
    expect((await r.as('ses-coordinator')('jobs-replan-done', { id: jobId })).status).toBe(403)
  })

  it('counts follow-up waves of the final check and escalates the 4th', async () => {
    for (const [had, escalates] of [
      [0, false],
      [3, true]
    ] as const) {
      const r = rig()
      const { jobId, runId } = await approved(r)
      const s = r.state()
      r.set({
        ...s,
        jobs: s.jobs.map((j) => ({ ...j, replanFollowUps: had })),
        tasks: s.tasks.map((t) => (t.runId === runId ? { ...t, status: 'completed' as const } : t))
      })
      await r.person('jobs-replan', { id: jobId, run: runId, mode: 'completion', wave: 3 })
      expect(r.starts.at(-1)!.brief).toContain('FINAL CHECK')
      r.tick()
      expect((await r.as('ses-planner-2')('task-create', { run: runId, ...plan('fix') })).status).toBe(200)
      await r.as('ses-planner-2')('jobs-replan-done', { id: jobId, summary: 'the login page lacked a test' })
      expect(job(r).replanFollowUps).toBe(had + 1)
      expect(job(r).lastReplan?.escalated !== undefined).toBe(escalates)
      expect(job(r).dispatchHold === true).toBe(escalates)
    }
  })

  it('reports a final check that added nothing as the plan done', async () => {
    const r = rig()
    const { jobId, runId } = await approved(r)
    const s = r.state()
    r.set({ ...s, tasks: s.tasks.map((t) => (t.runId === runId ? { ...t, status: 'completed' as const } : t)) })
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'completion', wave: 3 })
    const before = r.state()
    await r.as('ses-planner-2')('jobs-replan-done', { id: jobId, summary: 'meets the objective' })
    const types = deriveActivity(before, r.state()).map((e) => e.type)
    expect(types).toEqual(['plan.replanned', 'plan.done'])
    expect(job(r).lastReplan?.summary).toBe('done, nothing to add: meets the objective')
  })
})

describe('the wave gate on worker-start', () => {
  it('refuses a later wave while an earlier Task is unfinished, as a wait', async () => {
    const r = rig()
    const { runId, id } = await approved(r)
    const s = r.state()
    // a second wave-0 Task still running: B (wave 1) is ready but its wave is not open
    const extra: Task = { ...s.tasks.find((t) => t.id === id('A'))!, id: 'tsk_extra', title: 'E', status: 'pending', deps: [] }
    r.set({ ...s, tasks: [...s.tasks, { ...extra, runId }] })
    const reply = await r.as('ses-coordinator')('worker-start', { task: id('B'), agent: 'claude', account: 'acc1' })
    expect(reply.status).toBe(409)
    expect(reply.body).toMatchObject({ held: true })
  })
})

describe('--replan', () => {
  it('is set by jobs plan, and only to waves or off', async () => {
    const r = rig()
    const made = await r.person('run-create', { objective: 'o', cwd: '/repo', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    expect((await r.person('jobs-plan', { id: jobId, replan: 'never' })).status).toBe(400)
    expect((await r.person('jobs-plan', { id: jobId, replan: 'off' })).status).toBe(200)
    expect(job(r).replan).toBe('off')
    expect((await r.person('run-create', { objective: 'o', cwd: '/repo', replan: 'sometimes' })).status).toBe(400)
  })
})
