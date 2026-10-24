// W6-D wave replanning through the real command layer: the replan's start (hold, brief, fresh planner), what its
// session may change, its end (validate, release, summary, session ended) and the escalations.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from '../command'
import { emptyState, type OrchState } from '../state'
import { deriveActivity, noticeOf, type ActivityEvent } from '../activity'
import type { Dispatch, Task } from '../types'
import { replanOn, replansDue } from '../replan'
import { REPLAN_LIFT_HOLD, buildReplanBrief } from './replanStart'

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
const approved = async (r: Rig, job: Record<string, unknown> = {}, asPlanned = false) => {
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
  // A failed attempt, then success: the retry resets consecutiveFailures, so only the Dispatch history shows it
  if (!asPlanned)
    r.set({ ...r.state(), dispatches: [...r.state().dispatches, { id: 'dsp_failed', taskId: id('A'), outcome: 'failed', workerState: 'failed', sessionId: 'ses-dead', provider: 'claude', accountId: 'acc1', cwd: '/repo', specPath: '/s.md', startedAt: '2026-10-17T00:00:00.000Z', endedAt: '2026-10-17T00:01:00.000Z' } as Dispatch] })
  return { jobId, runId, id }
}

const job = (r: Rig) => r.state().jobs[0]

describe('jobs-replan', () => {
  it('starts a fresh planner, scoped to the deviation, whose brief has what was done and what is left', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    const before = r.state()
    const started = await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    expect(started.status).toBe(200)
    // a replan for deviations holds only the Tasks they can affect (replan.ts waveOpen), not the Job
    expect(job(r).dispatchHold).toBeUndefined()
    expect(job(r).replanning).toMatchObject({ runId, mode: 'wave', wave: 1, done: 1, sessionId: 'ses-planner-2', scoped: true })
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
    expect(brief).toContain('the rest of the plan goes on meanwhile')
    expect(deriveActivity(before, r.state()).map((e) => e.type)).toContain('plan.replanning')
  })

  it('skips the planner when the wave went as planned, and says so in the feed', async () => {
    const r = rig()
    const { jobId, runId } = await approved(r, {}, true)
    const before = r.state()
    const res = await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    expect(res.body).toMatchObject({ skipped: true })
    expect(r.starts.filter((s) => s.role === 'planner')).toHaveLength(1)
    expect(job(r).replanning).toBeUndefined()
    expect(job(r).dispatchHold).toBeUndefined()
    expect(job(r).lastReplan).toMatchObject({ runId, mode: 'wave', wave: 1, summary: 'Replan skipped: wave 1 went as planned' })
    const feed = deriveActivity(before, r.state())
    expect(feed.map((e) => e.type)).not.toContain('plan.replanning')
    expect(JSON.stringify(feed)).toContain('Replan skipped: wave 1 went as planned')
    expect(replansDue(r.state(), () => true)).toEqual([])
  })

  it('briefs only the deviating Task and what it can affect', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r, {}, true)
    const s = r.state()
    // a second wave-0 Task D (completed, as planned) with its own path, and an unrelated not-started E
    const planner = r.as('ses-planner-1')
    const d = (await planner('task-create', { run: jobId, ...plan('D') })).body as Task
    const e = (await planner('task-create', { run: jobId, ...plan('E') })).body as Task
    r.set({
      ...r.state(),
      tasks: r.state().tasks.map((t) =>
        t.id === d.id ? { ...t, status: 'completed' as const, result: 'built D', filesModified: ['src/D.ts'] } : t.id === id('A') ? { ...t, filesModified: ['src/elsewhere.ts'] } : t
      )
    })
    expect(s.tasks.length).toBeLessThan(r.state().tasks.length)
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    const brief = r.starts.at(-1)!.brief as string
    expect(brief).toContain(`${id('A')} (A)`)
    expect(brief).not.toContain(`${d.id} (D)`)
    expect(brief).toContain(`${id('B')} (B)`)
    expect(brief).toContain(`${id('C')} (C)`)
    expect(brief).not.toContain(`${e.id} (E)`)
  })

  it('still replans for owner feedback, with the wave as planned', async () => {
    const r = rig()
    const { jobId, runId } = await approved(r, {}, true)
    const res = await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1, feedback: 'also add X' })
    expect(res.status).toBe(200)
    expect(res.body).not.toHaveProperty('skipped')
    expect(job(r).replanning).toBeDefined()
    // owner feedback holds the whole Job, as before
    expect(job(r).dispatchHold).toBe(true)
    expect(job(r).replanning).not.toHaveProperty('scoped')
  })

  it("holds the whole Job for the final check and for a person's own ask", async () => {
    const asked = rig()
    const a = await approved(asked)
    await asked.person('jobs-replan', { id: a.jobId, run: a.runId })
    expect(job(asked).dispatchHold).toBe(true)
    const final = rig()
    const f = await approved(final)
    final.set({ ...final.state(), tasks: final.state().tasks.map((t) => (t.runId === f.runId ? { ...t, status: 'completed' as const } : t)) })
    await final.person('jobs-replan', { id: f.jobId, run: f.runId, mode: 'completion', wave: 3 })
    expect(job(final).dispatchHold).toBe(true)
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

describe('T5: the owner cancels a Task', () => {
  /** B is dispatched with an open worker, C (the one waiting on it) is not in the way once cancelled first. */
  const started = async (r: Rig) => {
    const run = await approved(r)
    const s = r.state()
    r.set({
      ...s,
      tasks: s.tasks.map((t) => (t.id === run.id('B') ? { ...t, status: 'dispatched' as const } : t)),
      dispatches: [{ id: 'dsp_b', taskId: run.id('B'), provider: 'claude', accountId: 'acc1', sessionId: 'ses-w', cwd: '/wt', specPath: '/s.md', startedAt: NOW, workerState: 'ready', retained: false } as Dispatch]
    })
    return run
  }
  const releasing = (r: Rig) => {
    const released: unknown[] = []
    r.deps.releaseWorker = async (a) => {
      released.push(a)
    }
    return released
  }

  it('cancels a started Task: its worker is released, its Dispatch closed, and the Run says so', async () => {
    const r = rig()
    const { id } = await started(r)
    const b = id('B')
    const released = releasing(r)
    expect((await r.person('task-cancel', { id: b, reason: 'x' })).status).toBe(400)
    expect((await r.person('task-cancel', { id: id('C'), reason: 'drop C first' })).status).toBe(200)
    expect((await r.person('task-cancel', { id: id('B') })).status).toBe(400)
    const done = await r.person('task-cancel', { id: id('B'), reason: 'replaced by B2' })
    expect(done.status).toBe(200)
    expect(released).toEqual([{ dispatchId: 'dsp_b', closeReason: 'stopped' }])
    expect(r.state().tasks.some((t) => t.id === b)).toBe(false)
    expect(r.state().dispatches.find((d) => d.id === 'dsp_b')).toMatchObject({ workerState: 'stopped', closedBy: 'stop' })
    expect(r.state().messages.at(-1)?.subject).toBe('B cancelled by the owner: replaced by B2')
  })

  it('is refused while the worker is still starting, and writes nothing', async () => {
    const r = rig()
    const { id } = await started(r)
    await r.person('task-cancel', { id: id('C'), reason: 'drop C first' })
    r.set({ ...r.state(), dispatches: r.state().dispatches.map((d) => ({ ...d, sessionId: 'pending:1', startedAt: NOW })) })
    const released = releasing(r)
    const before = r.state()
    const res = await r.person('task-cancel', { id: id('B'), reason: 'x' })
    expect(res.status).toBe(409)
    expect(released).toEqual([])
    expect(r.state()).toEqual(before)
  })

  it('is refused for an agent session, an MCP client and a coordinator', async () => {
    const r = rig()
    const { id } = await started(r)
    const released = releasing(r)
    await r.person('task-cancel', { id: id('C'), reason: 'drop C first' })
    expect((await r.as('ses-coordinator')('task-cancel', { id: id('B'), reason: 'x' })).status).toBe(403)
    expect((await r.as('ses-w')('task-cancel', { id: id('B'), reason: 'x' })).status).toBe(403)
    expect((await handleCommand(r.deps, { sessionId: '', role: 'mcp' }, 'task-cancel', { id: id('B'), reason: 'x' })).status).toBe(403)
    expect(released).toEqual([])
    expect(r.state().tasks.some((t) => t.id === id('B'))).toBe(true)
  })
})

describe('jobs-replan-done', () => {
  it('keeps the hold and escalates when the remaining plan does not hold and its planner is gone', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    await r.person('jobs-replan', { id: jobId, run: runId })
    const s = r.state()
    r.set({ ...s, tasks: s.tasks.map((t) => (t.id === id('C') ? { ...t, prompt: undefined } : t)) })
    const before = r.state()
    const done = await r.person('jobs-replan-done', { id: jobId, gone: true })
    expect(done.body).toMatchObject({ held: true })
    expect(job(r).dispatchHold).toBe(true)
    expect(job(r).lastReplan?.escalated).toContain('has no prompt')
    const line = deriveActivity(before, r.state()).find((e) => e.type === 'task.escalated')
    expect(line).toBeDefined()
    expect(noticeOf({ ...line!, id: 'e1', sequence: 1, occurredAt: NOW } as ActivityEvent)).not.toBeNull()
  })

  it('refuses its own planner while the plan does not hold, until the planner fixes the Task itself', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    await r.person('jobs-replan', { id: jobId, run: runId })
    const replanner = r.as('ses-planner-2')
    const added = (await replanner('task-create', { run: runId, ...plan('D', { deps: [id('A')], basis: undefined, evidence: undefined }) })).body as Task
    const refused = await replanner('jobs-replan-done', { id: jobId, summary: 'added D' })
    expect(refused.status).toBe(409)
    expect((refused.body as { problems: string[] }).problems).toEqual([expect.stringContaining('has no basis')])
    expect(job(r).replanning).toBeDefined()
    expect(job(r).dispatchHold).toBe(true)
    expect(r.state().messages.filter((m) => m.type === 'escalation')).toHaveLength(0)
    expect(r.stopped).not.toContain('ses-planner-2')

    const fixed = await replanner('task-update', { id: added.id, basis: 'partial', evidence: `${id('A')} review round 2: D is missing` })
    expect(fixed.status).toBe(200)
    expect((await replanner('jobs-replan-done', { id: jobId, summary: 'added D' })).status).toBe(200)
    expect(job(r).replanning).toBeUndefined()
    expect(job(r).dispatchHold).toBeUndefined()
    expect(job(r).lastReplan?.escalated).toBeUndefined()
    expect(r.state().messages.filter((m) => m.type === 'escalation')).toHaveLength(0)
    expect(r.stopped).toContain('ses-planner-2')
  })

  it("leaves a person's hold placed while a scoped replan ran, and records when it began", async () => {
    const r = rig()
    const { jobId, runId } = await approved(r)
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    await r.person('jobs-hold', { id: jobId })
    r.tick()
    await r.as('ses-planner-2')('jobs-replan-done', { id: jobId, summary: 'fine' })
    expect(job(r).dispatchHold).toBe(true)
    expect(job(r).lastReplan).toMatchObject({ startedAt: NOW, at: LATER })
    expect(job(r).lastReplan).not.toHaveProperty('scoped')
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

describe('the per-Task gate on worker-start', () => {
  it('refuses a Task downstream of a deviation until its replan, as a wait, not for an unrelated unfinished Task', async () => {
    for (const asPlanned of [false, true]) {
      const r = rig()
      const { runId, id } = await approved(r, {}, asPlanned)
      const s = r.state()
      // a second wave-0 Task not finished; B (wave 1) is ready, and A, all it waits on, completed
      const extra: Task = { ...s.tasks.find((t) => t.id === id('A'))!, id: 'tsk_extra', title: 'E', status: 'pending', deps: [], affectedPaths: ['src/E.ts'] }
      r.set({ ...s, tasks: [...s.tasks, { ...extra, runId }] })
      const reply = await r.as('ses-coordinator')('worker-start', { task: id('B'), agent: 'claude', account: 'acc1' })
      if (asPlanned) expect(reply.body).not.toMatchObject({ held: true })
      else expect(reply).toMatchObject({ status: 409, body: { held: true } })
    }
  })
})

describe('worker-start during a scoped replan', () => {
  it('accepts a Task the deviation cannot affect and refuses one it can, as a wait', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    const s = r.state()
    // E neither waits on A (which deviated) nor shares its paths
    const e: Task = { ...s.tasks.find((t) => t.id === id('A'))!, id: 'tsk_e', title: 'E', status: 'ready', deps: [], affectedPaths: ['src/E.ts'], filesModified: undefined }
    r.set({ ...s, runs: s.runs.map((x) => (x.id === runId ? { ...x, worktree: '/wt' } : x)), tasks: [...s.tasks, e] })
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    expect(job(r).replanning).toMatchObject({ scoped: true })
    const coordinator = r.as('ses-coordinator')
    expect(await coordinator('worker-start', { task: id('B'), agent: 'claude', account: 'acc1' })).toMatchObject({ status: 409, body: { held: true } })
    const started = await coordinator('worker-start', { task: 'tsk_e', agent: 'claude', account: 'acc1' })
    expect(started.status).toBe(200)
  })

  it('still refuses every Task while an unscoped replan runs', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    await r.person('jobs-replan', { id: jobId, run: runId })
    expect(await r.as('ses-coordinator')('worker-start', { task: id('B'), agent: 'claude', account: 'acc1' })).toMatchObject({ status: 409, body: { held: true, replanning: true } })
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

describe('W7-E', () => {
  it('#70: a planned Job reviews every Task, from its planner and its coordinator, unless a Task opts out', async () => {
    const r = rig()
    const made = await r.person('run-create', { objective: 'ship', cwd: '/repo', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    await r.person('jobs-plan', { id: jobId })
    expect(job(r)).toMatchObject({ review: true, convergence: {}, plannerAccountId: 'acc1' })
    const planner = r.as('ses-planner-1')
    expect(((await planner('task-create', { run: jobId, ...plan('A') })).body as Task).reviewRequested).toBe(true)
    expect(((await planner('task-create', { run: jobId, ...plan('B', { noReview: true }) })).body as Task).reviewRequested).toBeUndefined()
    await r.person('run-start', { run: jobId })
    const runId = r.state().runs[0].id
    expect(r.state().tasks.filter((t) => t.runId === runId && t.title === 'A').every((t) => t.reviewRequested === true)).toBe(true)
    const added = await r.as('ses-coordinator')('task-create', { run: runId, account: 'acc1', spec: 'x' })
    expect((added.body as Task).reviewRequested).toBe(true)
  })

  it('#70: --no-review at jobs-plan or jobs-create leaves review off', async () => {
    const r = rig()
    const made = await r.person('run-create', { objective: 'ship', cwd: '/repo', coordinatorAccount: 'acc1', auto: true })
    const jobId = (made.body as { id: string }).id
    await r.person('jobs-plan', { id: jobId, noReview: true })
    expect(job(r).review).toBe(false)
    const t = (await r.as('ses-planner-1')('task-create', { run: jobId, ...plan('A') })).body as Task
    expect(t.reviewRequested).toBeUndefined()
    const r2 = rig()
    const c = await r2.person('jobs-create', { objective: 'ship', cwd: '/repo', coordinatorAccount: 'acc1', noReview: true })
    expect(c.status).toBe(200)
    await r2.person('jobs-plan', { id: (c.body as { id: string }).id })
    expect(r2.state().jobs[0].review).toBe(false)
  })

  it('#74: a plan with no coordinator replans and gets its final check on the planner account', async () => {
    const r = rig()
    const made = await r.person('run-create', { objective: 'ship', cwd: '/repo', auto: true })
    const jobId = (made.body as { id: string }).id
    expect((await r.person('jobs-plan', { id: jobId, account: 'acc1' })).status).toBe(200)
    await r.as('ses-planner-1')('task-create', { run: jobId, ...plan('A') })
    expect((await r.person('run-start', { run: jobId })).status).toBe(200)
    const runId = r.state().runs[0].id
    expect(replanOn(job(r))).toBe(true)
    const s = r.state()
    r.set({ ...s, tasks: s.tasks.map((t) => (t.runId === runId ? { ...t, status: 'completed' as const } : t)) })
    expect(replansDue(r.state(), () => true)).toMatchObject([{ runId, mode: 'completion' }])
    expect((await r.person('jobs-replan', { id: jobId, run: runId, mode: 'completion', wave: 1 })).status).toBe(200)
    expect(r.starts.at(-1)!.accountId).toBe('acc1')
  })

  it('#74: a state read back from disk does not report the same final check twice', async () => {
    const r = rig()
    const { jobId, runId } = await approved(r)
    const s = r.state()
    r.set({ ...s, tasks: s.tasks.map((t) => (t.runId === runId ? { ...t, status: 'completed' as const } : t)) })
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'completion', wave: 3 })
    await r.as('ses-planner-2')('jobs-replan-done', { id: jobId, summary: 'meets the objective' })
    const after = r.state()
    expect(deriveActivity(after, JSON.parse(JSON.stringify(after)))).toEqual([])
  })
})

describe('the wave boundary moves on', () => {
  const inbox = (r: Rig, subject: string) => r.state().messages.filter((m) => m.subject === subject)
  /** T3: the app places an attached coordinator's ready Tasks, so only a Run driven from outside still starts its
   *  own: its Astera coordinator detached, an outside session in its place. */
  const drivenFromOutside = (r: Rig, runId: string) =>
    r.set({
      ...r.state(),
      runs: r.state().runs.map((x) => {
        if (x.id !== runId) return x
        const { coordinatorSessionId: _gone, ...rest } = x
        return { ...rest, externalCoordinatorSessionId: 'ses-outside' }
      })
    })

  it('posts plan.replanned with the startable Tasks to a Run driven from outside when a wave opens, skipped or replanned', async () => {
    const skip = rig()
    const s = await approved(skip, {}, true)
    drivenFromOutside(skip, s.runId)
    await skip.person('jobs-replan', { id: s.jobId, run: s.runId, mode: 'wave', wave: 1 })
    const [skipped] = inbox(skip, 'plan.replanned')
    expect(skipped).toMatchObject({ runId: s.runId, type: 'status', answered: false })
    expect(skipped.body).toContain('The replan before wave 2 has ended')
    expect(skipped.body).toContain(`${s.id('B')} (B)`)
    expect(skipped.body).not.toContain(`${s.id('C')} (C)`)

    const done = rig()
    const d = await approved(done, {})
    drivenFromOutside(done, d.runId)
    await done.person('jobs-replan', { id: d.jobId, run: d.runId, mode: 'wave', wave: 1 })
    expect(inbox(done, 'plan.replanned')).toHaveLength(0)
    await done.as('ses-planner-2')('jobs-replan-done', { id: d.jobId, summary: 'fine' })
    expect(inbox(done, 'plan.replanned')).toHaveLength(1)
    expect(inbox(done, 'plan.replanned')[0].body).toContain(`${d.id('B')} (B)`)
  })

  it('posts no plan.replanned for a Run the app places itself', async () => {
    const r = rig()
    const { jobId, runId } = await approved(r, {}, true)
    r.set({ ...r.state(), jobs: r.state().jobs.map((j) => ({ ...j, autoDispatch: true })) })
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    expect(inbox(r, 'plan.replanned')).toHaveLength(0)
  })

  it('posts no plan.replanned to an attached coordinator: the app starts the wave (T3)', async () => {
    const r = rig()
    const { jobId, runId } = await approved(r, {}, true)
    expect(r.state().runs[0].coordinatorSessionId).toBeDefined()
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    expect(inbox(r, 'plan.replanned')).toHaveLength(0)
  })

  it('ends a timed-out replan as skipped: the hold lifts, the planner stops, the feed says so', async () => {
    const r = rig()
    const { jobId, runId } = await approved(r, {})
    drivenFromOutside(r, runId)
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    const before = r.state()
    // the driving loop's call (exec/dispatchLoop.ts hurryReplan)
    expect((await r.person('jobs-replan-done', { id: jobId, timedOut: true })).status).toBe(200)
    expect(job(r).replanning).toBeUndefined()
    expect(job(r).dispatchHold).toBeUndefined()
    expect(job(r).lastReplan?.summary).toMatch(/^Replan skipped: its planner did not finish in time/)
    expect(r.stopped).toContain('ses-planner-2')
    const line = deriveActivity(before, r.state()).find((e) => e.type === 'plan.replanned')
    expect(line?.payload.summary).toMatch(/^Replan skipped/)
    expect(inbox(r, 'plan.replanned')).toHaveLength(1)
  })

  it('raises an escalated replan as an open Inbox question whose option lifts the hold', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    await r.person('jobs-replan', { id: jobId, run: runId })
    const s = r.state()
    r.set({ ...s, tasks: s.tasks.map((t) => (t.id === id('C') ? { ...t, prompt: undefined } : t)) })
    await r.person('jobs-replan-done', { id: jobId, gone: true })
    const esc = r.state().messages.filter((m) => m.type === 'escalation')
    expect(esc).toHaveLength(1)
    expect(esc[0]).toMatchObject({ runId, options: [REPLAN_LIFT_HOLD] })
    expect(esc[0].body).toContain(`jobs-unhold --id ${jobId}`)
    const open = (await r.person('questions-list', { status: 'open' })).body as Array<{ id: string; options?: string[] }>
    expect(open.find((q) => q.id === esc[0].id)?.options).toEqual([REPLAN_LIFT_HOLD])
    expect(inbox(r, 'plan.replanned')).toHaveLength(0)
  })

  it('raises the same item when the replan planner cannot start', async () => {
    const r = rig()
    const { jobId } = await approved(r)
    r.deps.startCoordinator = async () => {
      throw new Error('no pty')
    }
    await r.person('jobs-replan', { id: jobId })
    expect(r.state().messages.find((m) => m.type === 'escalation')?.options).toEqual([REPLAN_LIFT_HOLD])
  })
})

describe('T36: the replan brief and gaps', () => {
  it('prints a gaps line for a done Task that reported gaps, and none for one that did not', () => {
    const brief = (gaps?: string): string =>
      buildReplanBrief({
        job: { id: 'job_1', objective: 'o', cwd: '/r' },
        runId: 'run_1',
        mode: 'wave',
        wave: 1,
        accountId: 'acc1',
        followUps: 0,
        done: [{ task: { id: 'tsk_a', title: 'A', result: 'built A', ...(gaps ? { gaps } : {}) }, changed: null }],
        running: [],
        left: []
      })
    expect(brief('e2e not run: no display')).toContain('  gaps: e2e not run: no display')
    expect(brief()).not.toContain('gaps:')
  })
})

describe('the replan reviews deps', () => {
  it('brief asks for the dep review', () => {
    const brief = buildReplanBrief({ job: { id: 'job_1', objective: 'o', cwd: '/r' }, runId: 'run_1', mode: 'wave', wave: 1, accountId: 'acc1', followUps: 0, done: [], running: [], left: [] })
    expect(brief).toContain('REVIEW THE DEPS')
    expect(brief).toContain('"Same area", "same files", "nicer order" and "review after" are not reasons')
  })

  it('a dropped dep needs a reason, is applied, and is listed with it in the summary', async () => {
    const r = rig()
    const { jobId, runId, id } = await approved(r)
    await r.person('jobs-replan', { id: jobId, run: runId })
    r.tick()
    const replanner = r.as('ses-planner-2')
    // C waits on B; B's work is not something C uses
    expect((await replanner('task-update', { id: id('C'), deps: [] })).status).toBe(400)
    expect(r.state().tasks.find((t) => t.id === id('C'))!.deps).toEqual([id('B')])
    expect((await replanner('task-update', { id: id('C'), deps: [], reason: 'C uses nothing B builds' })).status).toBe(200)
    expect(r.state().tasks.find((t) => t.id === id('C'))!.deps).toEqual([])
    // keeping the deps needs no reason
    expect((await replanner('task-update', { id: id('B'), deps: [id('A')] })).status).toBe(200)
    const done = await replanner('jobs-replan-done', { id: jobId, summary: 'C runs beside B' })
    expect(done.status).toBe(200)
    expect(job(r).lastReplan?.summary).toBe('2 changed: C runs beside B; deps dropped: C: B (C uses nothing B builds)')
  })
})

describe('T36: a replan for a failed Task', () => {
  /** A completed as planned; B failed with its tries used up; C waits on B. */
  const failedB = async (r: Rig) => {
    const ids = await approved(r, {}, true)
    const b = ids.id('B')
    r.set({
      ...r.state(),
      tasks: r.state().tasks.map((t) => (t.id === b ? { ...t, status: 'failed' as const, consecutiveFailures: 3, result: 'made 19 of 25 screens' } : t)),
      dispatches: [
        ...r.state().dispatches,
        { id: 'dsp_b', taskId: b, outcome: 'failed', workerState: 'failed', sessionId: 'ses-b', provider: 'claude', accountId: 'acc1', cwd: '/repo', specPath: '/s.md', startedAt: NOW, endedAt: NOW, retained: false } as Dispatch
      ]
    })
    return ids
  }

  it('is due, and briefs the failure with its report and what waits on it', async () => {
    const r = rig()
    const { jobId, runId, id } = await failedB(r)
    const due = replansDue(r.state(), () => true)
    expect(due).toEqual([expect.objectContaining({ runId, mode: 'wave' })])
    expect((await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: due[0].wave })).status).toBe(200)
    expect(job(r).replanning).toMatchObject({ scoped: true })
    const brief = r.starts.at(-1)!.brief as string
    expect(brief).toContain('WHAT FAILED')
    expect(brief).toContain('report: made 19 of 25 screens')
    expect(brief).toContain(`${id('C')} (C)`)
    expect(brief).not.toMatch(/RUNNING NOW[^]*\(B\)/)
    expect(brief).toContain('--status completed --reason')
  })

  it('may retry it with a changed spec, or accept it with a reason, and nothing else about its status', async () => {
    const r = rig()
    const { jobId, runId, id } = await failedB(r)
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    const replanner = r.as('ses-planner-2')
    expect((await replanner('task-update', { id: id('B'), status: 'blocked' })).status).toBe(403)
    expect((await replanner('task-update', { id: id('B'), status: 'completed' })).status).toBe(400)
    expect((await replanner('task-update', { id: id('B'), status: 'ready', spec: 'only the 6 missing screens' })).status).toBe(200)
    expect(r.state().tasks.find((t) => t.id === id('B'))).toMatchObject({ status: 'ready', consecutiveFailures: 0, spec: 'only the 6 missing screens' })
  })

  it('may accept it as done with its gaps', async () => {
    const r = rig()
    const { jobId, runId, id } = await failedB(r)
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    const reply = await r.as('ses-planner-2')('task-update', { id: id('B'), status: 'completed', reason: 'the 19 screens cover the plan' })
    expect(reply.status).toBe(200)
    const b = r.state().tasks.find((t) => t.id === id('B'))!
    expect(['completed', 'merging']).toContain(b.status)
    expect(b.completionOverride?.reason).toBe('the 19 screens cover the plan')
  })
})

describe('T36: task-failed-resolve and run-failed-ask', () => {
  it('are the person\'s and Astera\'s, never an agent\'s; the person resolves, Astera asks once', async () => {
    const r = rig()
    const { runId, id } = await approved(r, {}, true)
    const b = id('B')
    r.set({ ...r.state(), jobs: r.state().jobs.map((j) => ({ ...j, replan: 'off' as const })), runs: r.state().runs.map((x) => ({ ...x, coordinatorSessionId: undefined })), tasks: r.state().tasks.map((t) => (t.id === b ? { ...t, status: 'failed' as const, result: 'half done' } : t)) })
    expect((await r.as('ses-coordinator')('task-failed-resolve', { id: b, action: 'retry' })).status).toBe(403)
    expect((await r.as('ses-coordinator')('run-failed-ask', { run: runId })).status).toBe(403)
    expect((await r.person('task-failed-resolve', { id: b, action: 'nope' })).status).toBe(400)
    const ask = await r.person('run-failed-ask', { run: runId })
    expect(ask.body).toMatchObject({ stalled: true, asked: [{ taskId: b }] })
    expect((await r.person('run-failed-ask', { run: runId })).body).toMatchObject({ stalled: true, asked: [] })
    const c = id('C')
    expect((await r.person('task-failed-resolve', { id: b, action: 'cancel' })).status).toBe(200)
    expect(r.state().tasks.some((t) => t.id === c)).toBe(false)
    expect(r.state().messages.find((m) => m.taskId === b && m.type === 'escalation')).toMatchObject({ answered: true, answerBody: 'Cancel what waits on it' })
  })
})

describe('T1: the replan brief', () => {
  it('teaches --kind with the task-create flags, and briefs owner feedback on a finished plan as more work', () => {
    const brief = (mode: 'wave' | 'completion', feedback?: string): string =>
      buildReplanBrief({
        job: { id: 'job_1', objective: 'o', cwd: '/r' },
        runId: 'run_1',
        mode,
        wave: 1,
        accountId: 'acc1',
        followUps: 0,
        done: [],
        running: [],
        left: [],
        ...(feedback !== undefined ? { feedback } : {})
      })
    expect(brief('wave')).toContain('--kind bugfix|feature|refactor|ui|audit|docs|test|ops')
    expect(brief('wave')).toContain('--effort')
    const reopened = brief('completion', 'add a dark mode')
    expect(reopened).toContain('add a dark mode')
    expect(reopened).toContain('finished')
    expect(reopened).not.toContain('THE FINAL CHECK')
  })
})
