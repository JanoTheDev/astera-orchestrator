// coordinatorRotate.ts on the real command layer: a fresh coordinator at a wave boundary and past the context setting,
// the hand-off brief, no refresh while a worker-start is in flight, finished workers and reviewers released while
// the plan runs, and worker tab titles.
import { describe, it, expect, vi } from 'vitest'
import { coordinatorHandoff, createCoordinatorRotation, FINISHED_RELEASE_RETRY_MS, FINISHED_RELEASE_TRIES, taskRefOf, workerTabTitle, type RotationContext } from './coordinatorRotate'
import { handleCommand, type OrchServerDeps } from '../command'
import { APP_CALLER } from '../../host/driver'
import { emptyState, type OrchState } from '../state'
import type { Dispatch, Gate, Task } from '../types'

const NOW = '2026-10-18T00:00:00.000Z'
const NOW_MS = Date.parse(NOW)

const task = (over: Partial<Task> & Pick<Task, 'id'>): Task => ({
  runId: 'run_1',
  title: over.id,
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['accA'],
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})
const dispatch = (over: Partial<Dispatch> & Pick<Dispatch, 'id' | 'taskId' | 'sessionId'>): Dispatch => ({
  provider: 'claude',
  accountId: 'accA',
  cwd: '/wt',
  specPath: '/specs/x.md',
  startedAt: NOW,
  endedAt: NOW,
  outcome: 'succeeded',
  workerState: 'stopped',
  retained: false,
  ...over
})
const gate = (over: Partial<Gate> & Pick<Gate, 'id' | 'taskId'>): Gate => ({ runId: 'run_1', question: 'which one?', status: 'open', createdAt: NOW, ...over })

/** One coordinator-driven plan: its Run works in /wt, the coordinator `coord-old` holds its slot. */
const plan = (tasks: Task[], extra: Partial<OrchState> = {}): OrchState => ({
  ...emptyState(),
  jobs: [{ id: 'job_1', objective: 'ship it', cwd: '/p', createdAt: NOW, coordinatorAccountId: 'accA' } as OrchState['jobs'][number]],
  runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt', coordinatorSessionId: 'coord-old' }],
  tasks,
  ...extra
})

function rig(initial: OrchState, o: { pct?: number | null; threshold?: number; typed?: string[]; typedAgoMs?: number; releaseStatus?: number } = {}) {
  let state = initial
  const order: string[] = []
  const startCoordinator = vi.fn(async (a: { brief: string }) => {
    order.push('start')
    return { sessionId: `coord-new-${startCoordinator.mock.calls.length}`, brief: a.brief }
  })
  const stopCoordinator = vi.fn(async (id: string) => {
    order.push(`stop:${id}`)
  })
  const releaseWorker = vi.fn(async (_a: { dispatchId: string }) => {})
  const deps = {
    getState: () => state,
    setState: async (next: OrchState) => {
      state = next
    },
    now: () => NOW,
    startWorker: async () => ({ sessionId: 's', cwd: '/wt', specPath: 'x' }),
    startCoordinator,
    stopCoordinator,
    releaseWorker,
    listAccounts: async () => [{ id: 'accA', label: 'accA', provider: 'claude' as const }],
    log: () => {}
  } as unknown as OrchServerDeps
  const logs: string[] = []
  const activities: string[] = []
  const ctx: RotationContext = {
    handle: (cmd, args) => handleCommand(deps, { sessionId: APP_CALLER }, cmd, args),
    getState: () => state,
    sessionAlive: () => true,
    lastPersonInputAt: (id) => (o.typed?.includes(id) ? NOW_MS - (o.typedAgoMs ?? 0) : null),
    activity: (_run, _task, reason) => activities.push(reason),
    sessionContextPct: () => o.pct ?? null,
    freshCoordinatorPct: () => o.threshold ?? 70,
    mayStart: () => true,
    log: (m) => logs.push(m),
    nowMs: () => NOW_MS
  }
  return { ctx, rotation: createCoordinatorRotation(ctx), state: () => state, startCoordinator, stopCoordinator, releaseWorker, order, logs, activities }
}

describe('coordinator rotation', () => {
  it("T5: records the fresh coordinator's model on the Run and lists the project's standing grants in its brief", async () => {
    const withProject = plan([task({ id: 't1', status: 'completed' }), task({ id: 't2', deps: ['t1'] })], {
      projects: [{ id: 'prj_1', path: '/p', name: 'p', addedAt: NOW, grants: ['migrations'] }]
    })
    const h = rig({ ...withProject, jobs: withProject.jobs.map((j) => ({ ...j, projectId: 'prj_1' })), runs: withProject.runs.map((r) => ({ ...r, coordinatorModel: 'haiku' })) })
    h.startCoordinator.mockImplementationOnce(async (a: { brief: string }) => ({ sessionId: 'coord-new-1', brief: a.brief, model: 'opus' }))
    await h.rotation.rotate()
    expect(h.startCoordinator.mock.calls[0][0].brief).toContain('The owner granted in advance: migrations.')
    expect(h.state().runs[0]).toMatchObject({ coordinatorSessionId: 'coord-new-1', coordinatorModel: 'opus' })
  })

  // T5b: the restart re-ranks (chooseStartAccount behind startCoordinator) and the Job records where it started
  it('records the account a restarted coordinator actually started on, keeping the named one as the preference', async () => {
    const h = rig(plan([task({ id: 't1', status: 'completed' }), task({ id: 't2', deps: ['t1'] })]))
    h.startCoordinator.mockImplementationOnce(async (a: { brief: string }) => ({ sessionId: 'coord-new-1', brief: a.brief, accountId: 'accB' }))
    await h.rotation.rotate()
    expect(h.startCoordinator.mock.calls[0][0]).toMatchObject({ accountId: 'accA' })
    expect(h.state().jobs[0]).toMatchObject({ coordinatorAccountId: 'accB', preferredAccountId: 'accA' })
  })

  it('replaces the coordinator at a wave boundary, starting the new one before ending the old', async () => {
    const h = rig(plan([task({ id: 't1', status: 'completed' }), task({ id: 't2', deps: ['t1'] })]))
    await h.rotation.rotate()
    expect(h.startCoordinator).toHaveBeenCalledTimes(1)
    expect(h.startCoordinator.mock.calls[0][0]).toMatchObject({ runId: 'run_1', cwd: '/p', accountId: 'accA' })
    expect(h.startCoordinator.mock.calls[0][0].brief).toContain('YOU REPLACE A COORDINATOR')
    expect(h.order).toEqual(['start', 'stop:coord-old'])
    const run = h.state().runs[0]
    expect(run.coordinatorSessionId).toBe('coord-new-1')
    expect(run.coordinatorRefreshes).toEqual([expect.objectContaining({ reason: 'wave 2', wave: 2, from: 'coord-old', to: 'coord-new-1' })])
    // Once per boundary
    await h.rotation.rotate()
    expect(h.startCoordinator).toHaveBeenCalledTimes(1)
  })

  it('replaces it when its context passes the setting, and not below', async () => {
    const below = rig(plan([task({ id: 't1' })]), { pct: 60 })
    await below.rotation.rotate()
    expect(below.startCoordinator).not.toHaveBeenCalled()
    const above = rig(plan([task({ id: 't1' })]), { pct: 72.4 })
    await above.rotation.rotate()
    expect(above.startCoordinator).toHaveBeenCalledTimes(1)
    expect(above.state().runs[0].coordinatorRefreshes?.[0]).toMatchObject({ reason: 'context 72%', contextPct: 72 })
    const off = rig(plan([task({ id: 't1' })]), { pct: 99, threshold: 0 })
    await off.rotation.rotate()
    expect(off.startCoordinator).not.toHaveBeenCalled()
  })

  it('does not refresh while a worker-start is in flight', async () => {
    const s = plan([task({ id: 't1', status: 'completed' }), task({ id: 't2', deps: ['t1'], status: 'dispatched' })], {
      dispatches: [dispatch({ id: 'd2', taskId: 't2', sessionId: 'pending:ab12', endedAt: undefined, outcome: undefined, workerState: 'ready' })]
    })
    const h = rig(s, { pct: 95 })
    await h.rotation.rotate()
    expect(h.startCoordinator).not.toHaveBeenCalled()
    const asked = await h.ctx.handle('run-coordinator-refresh', { run: 'run_1', reason: 'stalled' })
    expect(asked.status).toBe(409)
    expect(h.state().runs[0].coordinatorSessionId).toBe('coord-old')
  })

  it('briefs the fresh coordinator with the open Gates, their answers and the dispatches in flight', () => {
    const s = plan(
      [task({ id: 't1', status: 'completed' }), task({ id: 't2', status: 'blocked' }), task({ id: 't3', status: 'dispatched' })],
      {
        gates: [gate({ id: 'gate_open', taskId: 't2', question: 'Postgres or SQLite?' }), gate({ id: 'gate_done', taskId: 't1', status: 'resolved', resolution: 'use v2' })],
        dispatches: [dispatch({ id: 'dsp_live', taskId: 't3', sessionId: 'w3', endedAt: undefined, outcome: undefined, workerState: 'ready' })]
      }
    )
    s.jobs[0].feedback = [{ at: NOW, text: 'keep the API stable', phase: 'run' }]
    const brief = coordinatorHandoff(s, 'run_1', 'wave 2')
    expect(brief).toContain('gate_open on T2 t2: Postgres or SQLite?')
    expect(brief).toContain('gate_done on T1 t1')
    expect(brief).toContain('use v2')
    expect(brief).toContain('dsp_live for T3 t3')
    expect(brief).toContain('keep the API stable')
    expect(brief).toContain('T1 t1 [completed]')
  })

  it('never titles a worker or reviewer tab like the coordinator', () => {
    const s = plan([task({ id: 't1', title: 'Coordinator push notify' }), task({ id: 't2', title: 'Review it' })])
    expect(taskRefOf(s, 't2')).toBe('T2')
    for (const [id, title] of [['t1', 'Coordinator push notify'], ['t2', 'Review: Coordinator x'], ['nope', 'Coordinator · run_1']] as const)
      expect(workerTabTitle(s, id, title)).not.toMatch(/^Coordinator/)
    expect(workerTabTitle(s, 't1', 'Coordinator push notify')).toBe('T1 · Coordinator push notify')
  })
})

describe('finished sessions of a running plan', () => {
  const running = (tasks: Task[], dispatches: Dispatch[], gates: Gate[] = []): OrchState =>
    plan([...tasks, task({ id: 'tLater', deps: ['tDone'] })], { dispatches, gates })

  it('ends a completed and merged worker, keeps a failed one, an open Gate and one the owner typed into', async () => {
    const s = running(
      [
        task({ id: 'tDone', status: 'completed' }),
        task({ id: 'tFail', status: 'failed' }),
        task({ id: 'tGated', status: 'completed' }),
        task({ id: 'tTyped', status: 'completed' })
      ],
      [
        dispatch({ id: 'dDone', taskId: 'tDone', sessionId: 'wDone' }),
        dispatch({ id: 'dFail', taskId: 'tFail', sessionId: 'wFail', outcome: 'failed' }),
        dispatch({ id: 'dGated', taskId: 'tGated', sessionId: 'wGated' }),
        dispatch({ id: 'dTyped', taskId: 'tTyped', sessionId: 'wTyped' })
      ],
      [gate({ id: 'g1', taskId: 'tGated' })]
    )
    const h = rig(s, { typed: ['wTyped'] })
    await h.rotation.releaseFinished()
    expect(h.releaseWorker.mock.calls.map((c) => c[0].dispatchId)).toEqual(['dDone'])
  })

  it('ends a completed worktree worker without waiting for its merge', async () => {
    const s = running([task({ id: 'tDone', status: 'completed' })], [dispatch({ id: 'dDone', taskId: 'tDone', sessionId: 'wDone', cwd: '/wt-own' })])
    const h = rig(s)
    await h.rotation.releaseFinished()
    expect(h.releaseWorker.mock.calls.map((c) => c[0].dispatchId)).toEqual(['dDone'])
    // The command layer releases the session only; nothing in it removes the worktree
    expect(h.state().dispatches[0].cwd).toBe('/wt-own')
  })

  it('keeps a worker the owner typed into within 10 minutes, and ends it after', async () => {
    const mk = () => running([task({ id: 'tDone', status: 'completed' })], [dispatch({ id: 'dDone', taskId: 'tDone', sessionId: 'wDone' })])
    const recent = rig(mk(), { typed: ['wDone'], typedAgoMs: 9 * 60_000 })
    await recent.rotation.releaseFinished()
    expect(recent.releaseWorker).not.toHaveBeenCalled()
    const old = rig(mk(), { typed: ['wDone'], typedAgoMs: 11 * 60_000 })
    await old.rotation.releaseFinished()
    expect(old.releaseWorker).toHaveBeenCalledTimes(1)
  })

  it('records one activity line after the last failed release try', async () => {
    const s = running([task({ id: 'tDone', status: 'completed' })], [dispatch({ id: 'dDone', taskId: 'tDone', sessionId: 'wDone' })])
    const h = rig(s)
    h.releaseWorker.mockRejectedValue(new Error('boom'))
    let now = NOW_MS
    h.ctx.nowMs = () => now
    for (let i = 0; i < FINISHED_RELEASE_TRIES + 2; i++) {
      await h.rotation.releaseFinished()
      expect(h.activities).toHaveLength(i + 1 >= FINISHED_RELEASE_TRIES ? 1 : 0)
      now += FINISHED_RELEASE_RETRY_MS
    }
    expect(h.releaseWorker).toHaveBeenCalledTimes(FINISHED_RELEASE_TRIES)
    expect(h.activities).toEqual(['Could not close console wDone'])
  })

  it("ends a reviewer once its verdict is recorded, while the Task is still being repaired", async () => {
    const s = running(
      [task({ id: 'tDone', status: 'dispatched' })],
      [
        dispatch({ id: 'dImpl', taskId: 'tDone', sessionId: 'wImpl' }),
        dispatch({ id: 'dRev', taskId: 'tDone', sessionId: 'wRev', review: true }),
        dispatch({ id: 'dRepair', taskId: 'tDone', sessionId: 'wImpl2', repair: 'review-failure', endedAt: undefined, outcome: undefined, workerState: 'ready' })
      ]
    )
    s.jobs[0].convergence = {} as never
    const h = rig(s)
    await h.rotation.releaseFinished()
    expect(h.releaseWorker.mock.calls.map((c) => c[0].dispatchId)).toEqual(['dRev'])
  })
})
