// W6-D wave replanning through the real command layer: the replan's start (hold, brief, fresh planner), what its
// session may change, its end (validate, release, summary, session ended) and the escalations.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from '../command'
import { emptyState, type OrchState } from '../state'
import { deriveActivity, noticeOf, type ActivityEvent } from '../activity'
import type { Dispatch, Task } from '../types'
import type { HostSession } from '../command'
import { replanOn, replansDue } from '../replan'
import { REPLAN_LIFT_HOLD } from './replanStart'

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
const approved = async (r: Rig, job: Record<string, unknown> = {}, asPlanned = false, planArgs: Record<string, unknown> = {}) => {
  const made = await r.person('run-create', { objective: 'ship the feature', cwd: '/repo', coordinatorAccount: 'acc1', auto: true, ...job })
  const jobId = (made.body as { id: string }).id
  expect((await r.person('jobs-plan', { id: jobId, ...planArgs })).status).toBe(200)
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

  it('posts plan.replanned with the startable Tasks to a coordinator when a wave opens, skipped or replanned', async () => {
    const skip = rig()
    const s = await approved(skip, {}, true)
    await skip.person('jobs-replan', { id: s.jobId, run: s.runId, mode: 'wave', wave: 1 })
    const [skipped] = inbox(skip, 'plan.replanned')
    expect(skipped).toMatchObject({ runId: s.runId, type: 'status', answered: false })
    expect(skipped.body).toContain('Wave 2 of the plan is open')
    expect(skipped.body).toContain(`${s.id('B')} (B)`)
    expect(skipped.body).not.toContain(`${s.id('C')} (C)`)

    const done = rig()
    const d = await approved(done, {})
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

  it('ends a timed-out replan as skipped: the hold lifts, the planner stops, the feed says so', async () => {
    const r = rig()
    const { jobId, runId } = await approved(r, {})
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
    await r.as('ses-planner-2')('jobs-replan-done', { id: jobId })
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

describe('T10: a plan planned with the owner hands each wave to its own planner', () => {
  /** The planner the owner chats with, alive in its terminal: what is typed into it is recorded. */
  const chatting = (r: Rig) => {
    const typed: Array<{ id: string; text: string }> = []
    Object.assign(r.deps, {
      listSessions: async (): Promise<HostSession[]> =>
        [{ id: 'ses-planner-1', kind: 'terminal', title: null, accountId: 'acc1', cwd: '/repo', alive: !r.stopped.includes('ses-planner-1'), state: 'unknown' }] as HostSession[],
      sendSession: async (id: string, text: string) => void typed.push({ id, text }),
      sessionTurn: async () => ({ alive: true, state: 'unknown', prompt: null })
    })
    return typed
  }

  it('types the wave results into the same planner, which edits only what has not started, one feed line per change', async () => {
    const r = rig()
    const typed = chatting(r)
    const { jobId, runId, id } = await approved(r, {}, true, { planning: 'chat' })
    // the go kept the planner: it is the owner's chat
    expect(r.stopped).not.toContain('ses-planner-1')
    const s = r.state()
    r.set({ ...s, tasks: s.tasks.map((t) => (t.id === id('B') ? { ...t, status: 'failed' as const, result: 'tests broke in src/B.ts' } : t)) })
    // a wave that went as planned for its other Tasks still reaches the planner of a chat plan
    const res = await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ sessionId: 'ses-planner-1', via: 'typed' })
    expect(r.starts.filter((x) => x.role === 'planner')).toHaveLength(1)
    expect(job(r).replanning).toMatchObject({ sessionId: 'ses-planner-1' })
    expect(typed).toHaveLength(1)
    const line = typed[0].text
    expect(line).not.toContain('\n')
    for (const part of ['built A in src/A.ts', 'review: passed, no issues', 'changed files: src/A.ts', 'FAILED', 'tests broke in src/B.ts', `${id('C')} (C)`])
      expect(line).toContain(part)
    const planner = r.as('ses-planner-1')
    // running and finished Tasks are never rewritten
    expect((await planner('task-update', { id: id('A'), title: 'A again' })).status).toBe(403)
    expect((await planner('task-update', { id: id('B'), title: 'B again' })).status).toBe(403)
    expect((await planner('task-update', { id: id('C'), criteria: ['C works without B'] })).status).toBe(200)
    const before = r.state()
    const done = await planner('jobs-replan-done', { id: jobId, summary: 'C no longer needs B', changes: ['changed C criteria because B failed'] })
    expect(done.status).toBe(200)
    expect(job(r).lastReplan).toMatchObject({ changes: ['changed C criteria because B failed'] })
    expect(job(r).dispatchHold).toBeUndefined()
    const feed = deriveActivity(before, r.state()).filter((e) => e.type === 'plan.changed')
    expect(feed.map((e) => e.payload.summary)).toEqual(['changed C criteria because B failed'])
    // the owner's chat goes on
    expect(r.stopped).not.toContain('ses-planner-1')
  })

  it("names each change itself when the planner names none: one line per Task added, changed or cancelled", async () => {
    const r = rig()
    chatting(r)
    const { jobId, runId, id } = await approved(r, {}, true, { planning: 'chat' })
    await r.person('jobs-replan', { id: jobId, run: runId, mode: 'wave', wave: 1 })
    const planner = r.as('ses-planner-1')
    const c = id('C')
    r.tick()
    expect((await planner('task-update', { id: c, title: 'C, smaller' })).status).toBe(200)
    expect((await planner('jobs-replan-done', { id: jobId, summary: 'shrank C' })).status).toBe(200)
    expect(job(r).lastReplan!.changes).toEqual([`changed ${c} C, smaller`])
  })
})
