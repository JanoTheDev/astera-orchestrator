// Hands-off means hands off (owner, 2026-11-03, run run_1d3738cb220c3595): a start the machine could not make is retried,
// never asked; a Task past its circuit breaker gets a fresh attempt and then is given up on, never left waiting on the
// owner; and the watchdog never starts a second worker beside a live one.
import { describe, expect, it } from 'vitest'
import { emptyState, type OrchState } from '../state'
import { FAILURE_LIMIT, type Dispatch, type Task } from '../types'
import { handleCommand, type OrchServerDeps } from '../command'
import { APP_CALLER } from '../../host/driver'
import {
  FRESH_ATTEMPTS,
  START_RETRY_BACKOFF_MS,
  START_RETRY_LIMIT,
  START_RETRY_LIMIT_OTHER,
  failureSummaryOf,
  freshAttemptNote,
  isTransientStartFailure,
  recordStartFailure,
  recoverHandsOffTask,
  startRetryStep,
  startRetryWaiting
} from './handsOffRecovery'
import { createStallWatch, LOST_STALL_MS, STALL_WATCH_MS, stallRemedies, type StallEntry, type StallProbe } from './stallWatch'

const NOW = '2026-11-03T07:00:00.000Z'
const T0 = Date.parse(NOW)
const MIN = 60_000

const task = (over: Partial<Task> & Pick<Task, 'id'>): Task => ({
  runId: 'run_1',
  jobId: 'job_1',
  title: over.id.toUpperCase(),
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['accA'],
  consecutiveFailures: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over
})

const dispatch = (over: Partial<Dispatch> & Pick<Dispatch, 'id'>): Dispatch => ({
  taskId: 'tsk_1',
  provider: 'claude',
  accountId: 'accA',
  sessionId: `ses_${over.id}`,
  cwd: '/wt1',
  specPath: '',
  startedAt: NOW,
  workerState: 'stopped',
  retained: false,
  ...over
})

/** A running hands-off plan with a coordinator (the watchdog drives its lost Tasks), tsk_2 waiting on tsk_1. */
function plan(over: Partial<OrchState> = {}, handsOff = true): OrchState {
  return {
    ...emptyState(),
    projects: [{ id: 'prj', path: '/p', name: 'p', addedAt: NOW }],
    jobs: [{ id: 'job_1', objective: 'Announcements', cwd: '/p', projectId: 'prj', createdAt: NOW, concurrency: 2, autoDispatch: false, handsOff }],
    runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt1', coordinatorSessionId: 'coord-1' }],
    tasks: [task({ id: 'tsk_1' }), task({ id: 'tsk_2', status: 'pending', deps: ['tsk_1'] })],
    ...over
  }
}

describe('start failures under hands-off', () => {
  it('tells a machine that did not answer from a refusal (the 2026-11-03 Gates)', () => {
    expect(isTransientStartFailure('failed to start worker: WORKTREE_ROOT_UNREACHABLE: could not check whether C:\\wt\\x is free')).toBe(true)
    expect(isTransientStartFailure('Error: the pty supervisor did not answer the spawn')).toBe(true)
    expect(isTransientStartFailure('fork: origin main could not be fetched: timed out')).toBe(true)
    expect(isTransientStartFailure('--agent must be claude|codex')).toBe(false)
  })

  it('backs off a growing wait, more tries for a transient cause, then gives up', () => {
    let t: Pick<Task, 'startRetry'> = {}
    const waits: number[] = []
    for (;;) {
      const step = startRetryStep(t, 'the pty supervisor did not answer the spawn', T0)
      if (step.kind === 'give-up') {
        expect(step.tries).toBe(START_RETRY_LIMIT)
        break
      }
      waits.push(step.waitMs)
      t = { startRetry: step.retry }
    }
    expect(waits).toEqual(START_RETRY_BACKOFF_MS.slice(0, START_RETRY_LIMIT))
    const other = startRetryStep({ startRetry: { tries: START_RETRY_LIMIT_OTHER, at: NOW, reason: 'x' } }, 'refused', T0)
    expect(other.kind).toBe('give-up')
    expect(startRetryWaiting({ startRetry: { tries: 1, at: new Date(T0 + 1).toISOString(), reason: 'x' } }, T0)).toBe(true)
    expect(startRetryWaiting({ startRetry: { tries: 1, at: NOW, reason: 'x' } }, T0)).toBe(false)
  })

  it('records a failed start as a backoff on a ready Task, and holds it (blocked, no Gate) once its tries are spent', () => {
    const r = recordStartFailure(plan(), 'tsk_1', 'did not answer', T0, NOW)!
    expect(r.state.tasks[0]).toMatchObject({ status: 'ready', consecutiveFailures: 0, startRetry: { tries: 1 } })
    const spent = plan({ tasks: [task({ id: 'tsk_1', startRetry: { tries: START_RETRY_LIMIT, at: NOW, reason: 'x' } })] })
    const held = recordStartFailure(spent, 'tsk_1', 'did not answer', T0, NOW)!
    expect(held.state.tasks[0]).toMatchObject({ status: 'blocked', consecutiveFailures: 0 })
    expect(held.state.tasks[0].startRetry).toBeUndefined()
    expect(held.state.gates).toEqual([])
  })
})

describe('the circuit breaker under hands-off', () => {
  const tripped = (over: Partial<Task> = {}): OrchState =>
    plan({
      tasks: [
        task({
          id: 'tsk_1',
          status: 'failed',
          consecutiveFailures: 4,
          result: 'Still missing (HIGH): role-split acceptance (475) now fails on announcements.post',
          reviewIssues: [{ id: 'r1', severity: 'high', blocking: true, title: 'role-split acceptance (475) now fails', description: '' }],
          ...over
        }),
        task({ id: 'tsk_2', status: 'pending', deps: ['tsk_1'] })
      ],
      dispatches: [dispatch({ id: 'dsp_1', outcome: 'failed', endedAt: NOW, model: 'sonnet', effort: 'high' })]
    })

  it('a fresh attempt: ready, its count at 0, one rung stronger, what failed kept for its spec', () => {
    const r = recoverHandsOffTask(tripped(), 'tsk_1', NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.value.step).toMatchObject({ kind: 'fresh', model: 'opus' })
    expect(r.value.task).toMatchObject({ status: 'ready', consecutiveFailures: 0, model: 'opus', freshAttempt: { n: 1, at: NOW } })
    expect(r.value.task.freshAttempt!.summary).toContain('role-split acceptance (475)')
    // The next worker reads it, until an attempt started after it
    expect(freshAttemptNote(r.state, r.value.task)?.body).toBe(r.value.task.freshAttempt!.summary)
    const later = { ...r.state, dispatches: [...r.state.dispatches, dispatch({ id: 'dsp_2', startedAt: new Date(T0 + 1).toISOString() })] }
    expect(freshAttemptNote(later, r.value.task)).toBeUndefined()
  })

  it(`after ${FRESH_ATTEMPTS} fresh attempt(s), given up: failed, what waits on it cancelled, and never again`, () => {
    const r = recoverHandsOffTask(tripped({ freshAttempt: { n: FRESH_ATTEMPTS, at: NOW, summary: 's' } }), 'tsk_1', NOW)
    if (!r.ok) throw new Error(r.error)
    expect(r.value.step.kind).toBe('give-up')
    expect(r.value.task).toMatchObject({ status: 'failed', handsOffGaveUpAt: NOW })
    expect(r.value.task.consecutiveFailures).toBeGreaterThanOrEqual(FAILURE_LIMIT)
    expect(r.state.tasks.map((t) => t.id)).toEqual(['tsk_1'])
    expect(recoverHandsOffTask(r.state, 'tsk_1', NOW).ok).toBe(false)
  })

  it('refuses a plan that is not hands-off, a Task with a worker on it, and one with an open question', () => {
    expect(recoverHandsOffTask({ ...tripped(), jobs: tripped().jobs.map((j) => ({ ...j, handsOff: false })) }, 'tsk_1', NOW).ok).toBe(false)
    const working = { ...tripped(), dispatches: [dispatch({ id: 'dsp_open' })] }
    expect(recoverHandsOffTask(working, 'tsk_1', NOW).ok).toBe(false)
    const gated = { ...tripped(), gates: [{ id: 'g', runId: 'run_1', taskId: 'tsk_1', question: 'q', status: 'open' as const, createdAt: NOW }] }
    expect(recoverHandsOffTask(gated, 'tsk_1', NOW).ok).toBe(false)
  })

  it('the summary names the last result, the blocking issues and the failed checks', () => {
    const s = failureSummaryOf(tripped().tasks[0])
    expect(s).toContain('failed 4 times in a row')
    expect(s).toContain('HIGH role-split acceptance (475) now fails')
  })
})

describe('the commands', () => {
  function rig(s0: OrchState) {
    let state = s0
    const started: { taskId: string; spec: string }[] = []
    const deps = {
      getState: () => state,
      setState: async (next: OrchState) => {
        state = next
      },
      now: () => NOW,
      startWorker: async (a: { taskId: string; spec: string }) => (started.push(a), { sessionId: 's-new', cwd: '/wt1', specPath: 'x' }),
      listAccounts: async () => [{ id: 'accA', label: 'accA', provider: 'claude' as const }],
      startAccount: async () => ({ ok: true as const, accountId: 'accA', release: () => {} }),
      log: () => {},
      runningSessions: () => 0,
      appVersion: () => '1.0.0'
    } as unknown as OrchServerDeps
    return {
      state: () => state,
      started,
      as: (sessionId: string, cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId }, cmd, args)
    }
  }

  it("task-start-retry and task-hands-off-recover are Astera's own, and only for a hands-off plan", async () => {
    const h = rig(plan())
    expect((await h.as(APP_CALLER, 'task-start-retry', { id: 'tsk_1', reason: 'did not answer' })).status).toBe(200)
    expect(h.state().tasks[0].startRetry?.tries).toBe(1)
    const off = rig(plan({}, false))
    expect((await off.as(APP_CALLER, 'task-start-retry', { id: 'tsk_1', reason: 'x' })).status).toBe(409)
    const agent = rig(plan({ dispatches: [dispatch({ id: 'dsp_w', taskId: 'tsk_2', sessionId: 'ses_worker' })] }))
    expect((await agent.as('ses_worker', 'task-hands-off-recover', { id: 'tsk_1' })).status).toBe(403)
  })

  it('worker-start --owed starts a lost attempt past the breaker only when the Host lost sight of it (outcome_unknown)', async () => {
    const lost = (workerState: Dispatch['workerState']) =>
      plan({
        tasks: [task({ id: 'tsk_1', status: 'dispatched', consecutiveFailures: 4 }), task({ id: 'tsk_2', status: 'pending', deps: ['tsk_1'] })],
        dispatches: [dispatch({ id: 'dsp_lost', endedAt: NOW, workerState, grantedExtra: undefined })]
      })
    const args = { task: 'tsk_1', agent: 'claude', account: 'accA', retryOf: 'dsp_lost', owed: true }
    const machine = rig(lost('outcome_unknown'))
    const r = await machine.as(APP_CALLER, 'worker-start', args)
    expect(r.status).toBe(200)
    expect(machine.state().dispatches.at(-1)).toMatchObject({ retryOf: 'dsp_lost', grantedExtra: true })
    // A worker that exited on its own is the work's failure: the breaker holds
    const exited = rig(lost('failed'))
    expect((await exited.as(APP_CALLER, 'worker-start', args)).status).toBe(400)
    // Without --owed, as before
    expect((await rig(lost('outcome_unknown')).as(APP_CALLER, 'worker-start', { ...args, owed: undefined })).status).toBe(400)
  })

  it("a fresh attempt's worker reads what failed before it in its spec", async () => {
    const h = rig(
      plan({
        tasks: [task({ id: 'tsk_1', status: 'failed', consecutiveFailures: 3, result: 'announcements.post breaks role-split' }), task({ id: 'tsk_2', status: 'pending', deps: ['tsk_1'] })],
        dispatches: [dispatch({ id: 'dsp_1', outcome: 'succeeded', endedAt: NOW })]
      })
    )
    expect((await h.as(APP_CALLER, 'task-hands-off-recover', { id: 'tsk_1' })).status).toBe(200)
    expect((await h.as(APP_CALLER, 'worker-start', { task: 'tsk_1', agent: 'claude', account: 'accA' })).status).toBe(200)
    expect(h.started.at(-1)?.spec).toContain('fresh attempt')
    expect(h.started.at(-1)?.spec).toContain('announcements.post breaks role-split')
  })
})

describe('the watchdog under hands-off', () => {
  const every30s = (to: number): number[] => Array.from({ length: Math.floor(to / STALL_WATCH_MS) + 1 }, (_, i) => T0 + i * STALL_WATCH_MS)
  function watch(s: OrchState, to: number, probe: StallProbe) {
    let memo = new Map<string, StallEntry>()
    const out = []
    for (const t of every30s(to)) {
      const r = stallRemedies(s, t, memo, probe)
      memo = r.memo
      out.push(...r.due)
    }
    return out
  }
  const probe: StallProbe = { busy: () => false, isRegistered: () => false, alive: () => false }
  /** tsk_1 dispatched, its last worker lost; `failures` its count. */
  const lost = (failures: number, last: Partial<Dispatch> = {}, earlier: Dispatch[] = []): OrchState =>
    plan({
      tasks: [task({ id: 'tsk_1', status: 'dispatched', consecutiveFailures: failures }), task({ id: 'tsk_2', status: 'pending', deps: ['tsk_1'] })],
      dispatches: [...earlier, dispatch({ id: 'dsp_last', endedAt: NOW, workerState: 'failed', startedAt: NOW, ...last })]
    })

  it('past its breaker: a fresh attempt, never "raised it to you" (tsk_3cebea8da9e1e45e)', () => {
    const due = watch(lost(4), 10 * MIN, probe)
    expect(due.map((d) => d.kind)).toEqual(['recover'])
    expect(watch(lost(4), 10 * MIN, probe).some((d) => d.kind === 'escalate')).toBe(false)
    // Not hands-off: raised to the owner as before
    const off = { ...lost(4), jobs: lost(4).jobs.map((j) => ({ ...j, handsOff: false })) }
    expect(watch(off, 10 * MIN, probe).map((d) => d.kind)).toEqual(['escalate'])
  })

  it('a worker the Host lost sight of (outcome_unknown) is owed its attempt past the breaker, and does not count as lost', () => {
    const due = watch(lost(4, { workerState: 'outcome_unknown', grantedExtra: true }), LOST_STALL_MS, probe)
    expect(due).toEqual([expect.objectContaining({ kind: 'retry-lost', owed: true })])
    // Two machine losses and one real one are not three lost workers
    const earlier = [dispatch({ id: 'dsp_a', endedAt: NOW, workerState: 'outcome_unknown', startedAt: '2026-11-03T06:00:00.000Z' })]
    expect(watch(lost(1, { workerState: 'outcome_unknown' }, earlier), LOST_STALL_MS, probe).map((d) => d.kind)).toEqual(['retry-lost'])
  })

  it('names every earlier worker of the Task still alive, so it is ended before a new one starts', () => {
    const earlier = [dispatch({ id: 'dsp_reported', outcome: 'succeeded', endedAt: NOW, sessionId: 'ses_alive', startedAt: '2026-11-03T06:00:00.000Z' })]
    const due = watch(lost(1, {}, earlier), LOST_STALL_MS, { ...probe, alive: (id) => id === 'ses_alive' || id === 'ses_dsp_last' })
    expect(due).toEqual([expect.objectContaining({ kind: 'retry-lost', end: ['dsp_reported', 'dsp_last'] })])
  })

  function watchRig(s0: OrchState, answer: (cmd: string, args: Record<string, unknown>) => { status: number; body: unknown } | undefined = () => undefined) {
    let clock = T0
    const cmds: { cmd: string; args: Record<string, unknown> }[] = []
    const lines: string[] = []
    const w = createStallWatch({
      handle: async (cmd, args) => {
        cmds.push({ cmd, args })
        return answer(cmd, args) ?? { status: 200, body: {} }
      },
      getState: () => s0,
      on: () => true,
      cap: () => null,
      busy: () => false,
      alive: (id) => id === 'ses_alive',
      isRegistered: () => false,
      typeInto: () => {},
      tell: async () => true,
      activity: (d) => lines.push(String(d.payload.reason)),
      mayStart: () => true,
      log: () => {},
      nowMs: () => clock,
      wait: async () => {}
    })
    return {
      cmds,
      lines,
      run: async (to: number) => {
        for (let t = 0; t <= to; t += STALL_WATCH_MS) {
          clock = T0 + t
          await w.watch()
        }
      }
    }
  }
  const withAlive = lost(1, {}, [dispatch({ id: 'dsp_reported', outcome: 'succeeded', endedAt: NOW, sessionId: 'ses_alive', startedAt: '2026-11-03T06:00:00.000Z' })])

  it('ends the live earlier worker first, then starts the Task again', async () => {
    const h = watchRig(withAlive)
    await h.run(LOST_STALL_MS)
    expect(h.cmds.map((c) => c.cmd)).toEqual(['worker-release', 'worker-start'])
    expect(h.cmds[0].args).toEqual({ dispatch: 'dsp_reported' })
  })

  it('starts nothing while the live earlier worker could not be ended', async () => {
    const h = watchRig(withAlive, (cmd) => (cmd === 'worker-release' ? { status: 409, body: { error: 'still converging' } } : undefined))
    await h.run(LOST_STALL_MS)
    expect(h.cmds.map((c) => c.cmd)).toEqual(['worker-release'])
    expect(h.lines[0]).toContain('is still alive and could not be ended')
  })

  it('carries out the recovery through task-hands-off-recover, with a feed line', async () => {
    const h = watchRig(lost(4), (cmd) => (cmd === 'task-hands-off-recover' ? { status: 200, body: { step: { kind: 'fresh', model: 'opus', effort: 'high' } } } : undefined))
    await h.run(LOST_STALL_MS)
    expect(h.cmds).toEqual([{ cmd: 'task-hands-off-recover', args: { id: 'tsk_1' } }])
    expect(h.lines[0]).toContain('started a fresh attempt on opus/high')
  })
})
