import { describe, it, expect, vi } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, REVIEW_PAUSED_REASON, type OrchState } from './state'
import { createReviewGate } from './exec/reviewGate'
import type { Gate, Task } from './types'

const NOW = '2026-11-01T00:00:00.000Z'

const task = (id: string, status: Task['status']): Task => ({
  id,
  runId: 'run_1',
  jobId: 'job_1',
  title: 't',
  spec: 's',
  deps: [],
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  status
})

/** A paused run with a task whose review is waiting. `scheduled` makes the pause the Job's (run-resume's), not the run's. */
const pausedRun = (scheduled = false): OrchState => ({
  ...emptyState(),
  jobs: [
    scheduled
      ? { id: 'job_1', objective: 'o', cwd: 'D:/p', createdAt: NOW, schedule: { kind: 'daily', time: '09:00' }, paused: true }
      : { id: 'job_1', objective: 'o', cwd: 'D:/p', createdAt: NOW }
  ],
  runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, ...(scheduled ? {} : { paused: true }) }],
  tasks: [task('tsk_1', 'reviewing')]
})

/** A review refused while paused, through the real gate, so the Gate is the one the app opens. */
const refusedWhilePaused = async (initial: OrchState): Promise<OrchState> => {
  let state = initial
  const gate = createReviewGate({ getState: () => state, setState: async (n) => void (state = n), now: () => NOW, log: () => {} })
  expect(await gate.refuseIfRunGated({ taskId: 'tsk_1' })).toBe(true)
  return state
}

const depsOf = (initial: OrchState): OrchServerDeps & { box: { state: OrchState }; startReview: ReturnType<typeof vi.fn> } => {
  const box = { state: initial }
  const startReview = vi.fn()
  return {
    box,
    startReview,
    getState: () => box.state,
    setState: async (n: OrchState) => void (box.state = n),
    startWorker: async () => ({ sessionId: 's', cwd: 'D:/p', specPath: 'D:/p/s.md' }),
    releaseWorker: async () => {},
    listAccounts: () => [],
    readWorker: async () => '',
    now: () => NOW
  } as unknown as OrchServerDeps & { box: { state: OrchState }; startReview: ReturnType<typeof vi.fn> }
}

const call = (deps: OrchServerDeps, cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: 'coordinator' }, cmd, args)

describe('resuming a run clears the review-paused Gates', () => {
  it('a review refused while the run is paused opens a Gate marked run-paused', async () => {
    const s = await refusedWhilePaused(pausedRun())
    expect(s.tasks[0].status).toBe('blocked')
    expect(s.gates).toHaveLength(1)
    expect(s.gates[0]).toMatchObject({ kind: 'review-ended', cause: 'run-paused', status: 'open' })
  })

  it('runs-resume closes the Gate, puts the Task back to reviewing and starts the reviewer', async () => {
    const deps = depsOf(await refusedWhilePaused(pausedRun()))
    expect((await call(deps, 'runs-resume', { id: 'run_1' })).status).toBe(200)
    expect(deps.box.state.gates[0]).toMatchObject({ status: 'resolved', resolution: 'resolved: the run was resumed' })
    expect(deps.box.state.tasks[0].status).toBe('reviewing')
    expect(deps.startReview).toHaveBeenCalledWith({ taskId: 'tsk_1' })
  })

  it('run-resume (a scheduled Job) does the same', async () => {
    const deps = depsOf(await refusedWhilePaused(pausedRun(true)))
    expect((await call(deps, 'run-resume', { run: 'job_1' })).status).toBe(200)
    expect(deps.box.state.gates[0].status).toBe('resolved')
    expect(deps.box.state.tasks[0].status).toBe('reviewing')
    expect(deps.startReview).toHaveBeenCalledTimes(1)
  })

  it('leaves a Gate of another kind open', async () => {
    const base = pausedRun()
    const other: Gate = { id: 'gat_x', runId: 'run_1', taskId: 'tsk_1', question: 'q', kind: 'merge-failed', status: 'open', createdAt: NOW }
    const deps = depsOf({ ...base, tasks: [task('tsk_1', 'blocked')], gates: [other] })
    await call(deps, 'runs-resume', { id: 'run_1' })
    expect(deps.box.state.gates[0].status).toBe('open')
    expect(deps.box.state.tasks[0].status).toBe('blocked')
    expect(deps.startReview).not.toHaveBeenCalled()
  })

  it('clears a legacy Gate that has the old reason text and no marker', async () => {
    const s = await refusedWhilePaused(pausedRun())
    const { cause: _drop, ...legacy } = s.gates[0]
    expect(legacy.question).toContain(REVIEW_PAUSED_REASON)
    const deps = depsOf({ ...s, gates: [legacy] })
    await call(deps, 'runs-resume', { id: 'run_1' })
    expect(deps.box.state.gates[0].status).toBe('resolved')
    expect(deps.box.state.tasks[0].status).toBe('reviewing')
    expect(deps.startReview).toHaveBeenCalledWith({ taskId: 'tsk_1' })
  })
})
