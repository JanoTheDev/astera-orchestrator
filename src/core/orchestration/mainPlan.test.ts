// T1 the main plan: sub-plans in run order with their links, and Tasks that wait on another plan's Task.
import { describe, expect, it } from 'vitest'
import { activeOrQueued, externalDepsOf, holdExternalDeps, mainPlanOf } from './mainPlan'
import { refreshOverlaps, STOPPED_DEP_OPTIONS } from './overlap'
import { createTask, emptyState, resolveGate, startJobRun, type OrchState } from './state'
import type { Job, JobRun, Task } from './types'

const T0 = '2026-10-18T00:00:00.000Z'
const T1 = '2026-10-18T01:00:00.000Z'

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  objective: id,
  cwd: '/repo',
  projectId: 'prj_1',
  createdAt: T0,
  autoDispatch: true,
  concurrency: 3,
  ...over
})
const run = (id: string, jobId: string, over: Partial<JobRun> = {}): JobRun => ({ id, jobId, ordinal: 1, createdAt: T0, ...over })
const task = (id: string, owner: { runId?: string; jobId?: string }, over: Partial<Task> = {}): Task => ({
  id,
  ...owner,
  title: id.toUpperCase(),
  spec: 's',
  deps: [],
  status: 'ready',
  consecutiveFailures: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over
})
const delivered = { sha: 'abc' } as JobRun['delivery']

/** Plan A (r1) has a completed tA, not delivered yet; plan B (r2) has tB waiting on it, ready as `recomputeReady` leaves it. */
const waiting = (aRun: Partial<JobRun> = {}, aJob: Partial<Job> = {}): OrchState => ({
  ...emptyState(),
  jobs: [job('jA', aJob), job('jB')],
  runs: [run('r1', 'jA', aRun), run('r2', 'jB')],
  tasks: [task('tA', { runId: 'r1' }, { status: 'completed' }), task('tB', { runId: 'r2' }, { deps: ['tA'] })]
})

const statusOf = (s: OrchState, id: string): string | undefined => s.tasks.find((t) => t.id === id)?.status

// T15: a plan whose Run lost its Tasks (the 2026-10-22 wipe) but was delivered is finished, not active
describe('a plan whose Run lost its Tasks', () => {
  it('reads by its delivery in the main plan and drops out of the active plans', () => {
    const s: OrchState = {
      ...emptyState(),
      jobs: [job('jDone'), job('jStuck'), job('jNew')],
      runs: [
        run('rDone', 'jDone', { pr: { at: T0, url: 'https://github.com/o/r/pull/1' } }),
        run('rStuck', 'jStuck', { delivery: { at: T0, branch: 'main', error: 'merge failed' } }),
        run('rNew', 'jNew')
      ]
    }
    const states = Object.fromEntries(mainPlanOf(s, 'prj_1').plans.map((p) => [p.job.id, p.state]))
    expect(states).toEqual({ jDone: 'completed', jStuck: 'failed', jNew: 'running' })
    expect(activeOrQueued(s, s.jobs[0])).toBe(false)
    expect(activeOrQueued(s, s.jobs[1])).toBe(false)
    expect(activeOrQueued(s, s.jobs[2])).toBe(true)
  })
})

describe('mainPlanOf', () => {
  it('lists the project’s not-archived plans in run order: priority, then age, a queued plan after the one it waits on', () => {
    const s: OrchState = {
      ...emptyState(),
      jobs: [
        job('jOld', { createdAt: T0 }),
        job('jUrgent', { createdAt: T1, priority: 1 }),
        // older than both, but queued after jOld
        job('jNext', { createdAt: '2026-10-17T00:00:00.000Z', after: 'jOld', pendingStart: true }),
        job('jGone', { archivedAt: T1 }),
        job('jElse', { projectId: 'prj_2' })
      ],
      tasks: [task('d1', { jobId: 'jNext' }, { status: 'pending' })]
    }
    const main = mainPlanOf(s, 'prj_1')
    expect(main.projectKey).toBe('prj_1')
    expect(main.plans.map((p) => p.job.id)).toEqual(['jUrgent', 'jOld', 'jNext'])
    expect(main.plans[2]).toMatchObject({ state: 'not started', tasks: [{ id: 'd1' }] })
  })

  it('links the plans: a cross-plan dep, a lease wait, a duplicate Gate and an overlap', () => {
    const base = waiting()
    const s: OrchState = {
      ...base,
      // T7: a lease only with serial files on
      projects: [{ id: 'prj_1', path: '/repo', name: 'repo', addedAt: T0, serialFiles: true }],
      jobs: base.jobs.map((j) =>
        j.id === 'jB' ? { ...j, overlaps: [{ taskId: 'tB', jobId: 'jA', otherTaskId: 'tA', by: 'path' as const, path: 'src/a.ts' }] } : j
      ),
      tasks: [
        task('tA', { runId: 'r1' }, { status: 'completed', affectedPaths: ['src/a.ts'] }),
        task('tB', { runId: 'r2' }, { deps: ['tA'], status: 'pending' }),
        task('tC', { runId: 'r2' }, { affectedPaths: ['src/a.ts'] })
      ],
      gates: [{ id: 'g1', runId: 'r2', taskId: 'tC', question: 'dup?', options: ['cancel as duplicate', 'keep both'], status: 'open', createdAt: T0 }]
    }
    const links = mainPlanOf(s, 'prj_1').links
    expect(links).toContainEqual({ kind: 'dep', jobId: 'jB', taskId: 'tB', otherJobId: 'jA', otherTaskId: 'tA', satisfied: false, why: 'not delivered' })
    expect(links).toContainEqual({ kind: 'lease', jobId: 'jB', taskId: 'tC', otherJobId: 'jA', otherTaskId: 'tA', path: 'src/a.ts' })
    expect(links).toContainEqual({ kind: 'duplicate', jobId: 'jB', taskId: 'tC', gateId: 'g1', status: 'open' })
    expect(links).toContainEqual({ kind: 'overlap', jobId: 'jB', overlap: { taskId: 'tB', jobId: 'jA', otherTaskId: 'tA', by: 'path', path: 'src/a.ts' } })
  })
})

describe('a Task waiting on another plan’s Task', () => {
  it('stays pending while that Task is completed but its plan has not delivered, and turns ready once it delivers', () => {
    const held = refreshOverlaps(emptyState(), waiting(), T0)
    expect(statusOf(held, 'tB')).toBe('pending')
    expect(externalDepsOf(held, held.tasks.find((t) => t.id === 'tB')!)).toMatchObject([{ id: 'tA', jobId: 'jA', satisfied: false, why: 'not delivered' }])
    const landed = { ...held, runs: held.runs.map((r) => (r.id === 'r1' ? { ...r, delivery: delivered } : r)) }
    expect(statusOf(refreshOverlaps(held, landed, T0), 'tB')).toBe('ready')
  })

  it('a Task created with such a dep starts pending (state.ts ready rule), and one of its own plan is unaffected', () => {
    const s = holdExternalDeps(waiting())
    const made = createTask(s, { runId: 'r2', title: 'c', spec: 's', deps: ['tA'] }, T0)
    if (!made.ok) throw new Error(made.error)
    expect(made.value.status).toBe('pending')
    const own = createTask({ ...s, tasks: [...s.tasks, task('tB2', { runId: 'r2' }, { status: 'completed' })] }, { runId: 'r2', title: 'd', spec: 's', deps: ['tB2'] }, T0)
    if (!own.ok) throw new Error(own.error)
    expect(own.value.status).toBe('ready')
  })

  it('a started plan keeps its dep on another plan’s Task; that plan starting points it at the copy that runs', () => {
    let s: OrchState = {
      ...emptyState(),
      jobs: [job('jA'), job('jB')],
      tasks: [task('dA', { jobId: 'jA' }, { status: 'pending' }), task('dB', { jobId: 'jB' }, { status: 'pending', deps: ['dA'] })]
    }
    const b = startJobRun(s, 'jB', T0)
    if (!b.ok) throw new Error(b.error)
    s = b.state
    const copyB = s.tasks.find((t) => t.runId === b.value.id)!
    expect(copyB.deps).toEqual(['dA'])
    expect(copyB.status).toBe('pending')
    const a = startJobRun(s, 'jA', T0)
    if (!a.ok) throw new Error(a.error)
    const copyA = a.state.tasks.find((t) => t.runId === a.value.id)!
    expect(a.state.tasks.find((t) => t.id === copyB.id)?.deps).toEqual([copyA.id])
    // plan B's definition too, so a later Run of B waits on the copy that runs; plan A's own definitions keep their ids
    expect(a.state.tasks.find((t) => t.id === 'dB')?.deps).toEqual([copyA.id])
  })
})

describe('the stopped-dependency Gate', () => {
  const stopped = (): OrchState => refreshOverlaps(emptyState(), waiting({}, { archivedAt: T1 }), T0)

  it('opens exactly one owner Gate when the plan it waits on stops, never again on the next commit', () => {
    const s = stopped()
    const gates = s.gates.filter((g) => g.taskId === 'tB')
    expect(gates).toHaveLength(1)
    expect(gates[0].options).toEqual([...STOPPED_DEP_OPTIONS])
    expect(gates[0].question).toContain('whose plan stopped')
    expect(statusOf(s, 'tB')).toBe('blocked')
    expect(refreshOverlaps(s, { ...s, tasks: [...s.tasks] }, T0).gates).toHaveLength(1)
  })

  it('opens one when the Task it waits on was cancelled', () => {
    const base = waiting()
    const s = refreshOverlaps(emptyState(), { ...base, tasks: base.tasks.filter((t) => t.id !== 'tA') }, T0)
    expect(s.gates.filter((g) => g.taskId === 'tB')).toHaveLength(1)
    expect(s.gates[0].question).toContain('which was cancelled')
  })

  it('carries out each answer: keep waiting, drop this dependency, cancel this Task', () => {
    const held = stopped()
    const gateId = held.gates[0].id
    const answer = (resolution: string): OrchState => {
      const r = resolveGate(held, { gateId, resolution }, T0)
      if (!r.ok) throw new Error(r.error)
      return refreshOverlaps(held, r.state, T0)
    }
    const kept = answer(STOPPED_DEP_OPTIONS[0])
    expect(statusOf(kept, 'tB')).toBe('pending')
    expect(kept.tasks.find((t) => t.id === 'tB')?.deps).toEqual(['tA'])
    expect(kept.gates.filter((g) => g.status === 'open')).toEqual([])
    const dropped = answer(STOPPED_DEP_OPTIONS[1])
    expect(dropped.tasks.find((t) => t.id === 'tB')).toMatchObject({ deps: [], status: 'ready' })
    expect(answer(STOPPED_DEP_OPTIONS[2]).tasks.some((t) => t.id === 'tB')).toBe(false)
  })
})
