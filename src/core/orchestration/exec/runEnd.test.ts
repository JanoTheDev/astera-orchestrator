// A finished Run closes every session it left behind (item 9): its coordinator, planners, workers tracked, open or lost,
// sessions created for it and orchestration's sessions in its worktrees; never a person's own tab, never a retained
// worker. And the Host's sweep closes them once, after the grace and the settled completion check, with one log line.
import { describe, expect, it, vi } from 'vitest'
import { createRunEndSweep, orchOwnerOfCaller, orchSessionsAdded, runEndSessions, type RunEndSession } from './runEnd'
import { emptyState, type OrchState } from '../state'
import type { Dispatch, Job, JobRun, Task } from '../types'
import { FINISHED_RUN_BUSY_CAP_MS, FINISHED_RUN_GRACE_MS, graceOver } from './dispatchLoop'
import { ORCH_MARK_AGENT } from '../../host/protocol'

const NOW = '2026-10-20T11:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const job = (over: Partial<Job> = {}): Job =>
  ({ id: 'job_1', objective: 'o', cwd: '/repo', replan: 'off', plannerSessionIds: ['ses_planner'], createdAt: NOW, ...over }) as Job
const run = (over: Partial<JobRun> = {}): JobRun =>
  ({ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: NOW, worktree: '/wt/run_1', coordinatorSessionId: 'ses_coord', ...over }) as JobRun
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, runId: 'run_1', title: id, spec: 's', deps: [], status: 'completed', accountIds: ['accA'],
  consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over
})
const dispatch = (id: string, taskId: string, sessionId: string, over: Partial<Dispatch> = {}): Dispatch =>
  ({ id, taskId, provider: 'claude', accountId: 'accA', sessionId, cwd: `/wt/run_1/${taskId}`, specPath: '', startedAt: NOW, workerState: 'ready', retained: false, ...over }) as Dispatch

/** A finished Run with a tracked worker (reported), an open worker of a Task that ended anyway, a retained worker and
 *  a Task whose worker's record was lost. */
const finished = (): OrchState => ({
  ...emptyState(),
  jobs: [job()],
  runs: [run()],
  tasks: [task('tsk_a'), task('tsk_b'), task('tsk_c'), task('tsk_d')],
  dispatches: [
    dispatch('dsp_a', 'tsk_a', 'ses_tracked', { outcome: 'succeeded', endedAt: NOW }),
    dispatch('dsp_b', 'tsk_b', 'ses_open'),
    dispatch('dsp_c', 'tsk_c', 'ses_retained', { outcome: 'succeeded', endedAt: NOW, retained: true })
  ]
})
const live: RunEndSession[] = [
  { id: 'ses_coord', cwd: '/wt/run_1', mark: 'run_1' },
  { id: 'ses_planner', cwd: '/repo', mark: 'job_1' },
  { id: 'ses_tracked', cwd: '/wt/run_1/tsk_a', mark: 'run_1' },
  { id: 'ses_open', cwd: '/wt/run_1/tsk_b', mark: 'run_1' },
  { id: 'ses_lost', cwd: '/wt/run_1/tsk_d', spec: 'Read /p/orch/specs/tsk_d-dsp_gone.md and follow the instructions in it' },
  { id: 'ses_created', cwd: '/repo', mark: 'run_1' },
  { id: 'ses_agent', cwd: '/wt/run_1/sub', mark: ORCH_MARK_AGENT },
  { id: 'ses_owner_tab', cwd: '/wt/run_1' },
  { id: 'ses_retained', cwd: '/wt/run_1/tsk_c', mark: 'run_1' },
  { id: 'ses_elsewhere', cwd: '/other' }
]

describe('runEndSessions', () => {
  it('closes the coordinator, planner, tracked, open and untracked workers, a created session and a marked one in a worktree', () => {
    const [plan] = runEndSessions(finished(), live)
    expect(plan.runId).toBe('run_1')
    expect(plan.close).toEqual([
      { id: 'ses_coord', why: 'coordinator' },
      { id: 'ses_planner', why: 'planner' },
      { id: 'ses_tracked', why: 'worker', dispatchId: 'dsp_a' },
      { id: 'ses_open', why: 'worker', dispatchId: 'dsp_b' },
      { id: 'ses_lost', why: 'untracked worker', dispatchId: 'dsp_gone' },
      { id: 'ses_created', why: 'created' },
      { id: 'ses_agent', why: 'in worktree' }
    ])
  })

  it('keeps an unmarked owner tab in the Run worktree and a retained worker', () => {
    const [plan] = runEndSessions(finished(), live)
    expect(plan.kept).toEqual([
      { id: 'ses_owner_tab', why: 'not started by orchestration' },
      { id: 'ses_retained', why: 'retained', dispatchId: 'dsp_c' }
    ])
    expect(JSON.stringify(plan)).not.toContain('ses_elsewhere')
  })

  it('says nothing of a Run still running, nor of an unmarked tab in its folder', () => {
    const s = finished()
    const running = { ...s, tasks: s.tasks.map((t) => (t.id === 'tsk_b' ? { ...t, status: 'dispatched' as const } : t)) }
    expect(runEndSessions(running, live)).toEqual([])
  })

  it('never takes the project root for a worktree', () => {
    const s = { ...finished(), dispatches: [dispatch('dsp_a', 'tsk_a', 'ses_x', { cwd: '/repo', outcome: 'succeeded', endedAt: NOW })] }
    expect(runEndSessions(s, [{ id: 'ses_agent_root', cwd: '/repo/src', mark: ORCH_MARK_AGENT }])).toEqual([])
  })
})

describe('orchSessionsAdded / orchOwnerOfCaller', () => {
  it('names the sessions a commit gave orchestration with their Run or Job, never a placeholder', () => {
    const prev: OrchState = { ...emptyState(), jobs: [job({ plannerSessionIds: [] })], runs: [run({ coordinatorSessionId: undefined })], tasks: [task('tsk_a')] }
    const next: OrchState = {
      ...prev,
      jobs: [job()],
      runs: [run()],
      dispatches: [dispatch('dsp_a', 'tsk_a', 'ses_w'), dispatch('dsp_p', 'tsk_a', 'pending:abc')]
    }
    expect(orchSessionsAdded(prev, next)).toEqual([
      { sessionId: 'ses_coord', owner: 'run_1' },
      { sessionId: 'ses_w', owner: 'run_1' },
      { sessionId: 'ses_planner', owner: 'job_1' }
    ])
    expect(orchSessionsAdded(next, next)).toEqual([])
  })

  it('reads the Run or Job a caller works for', () => {
    const s = finished()
    expect(orchOwnerOfCaller(s, 'ses_coord')).toBe('run_1')
    expect(orchOwnerOfCaller(s, 'ses_open')).toBe('run_1')
    expect(orchOwnerOfCaller(s, 'ses_planner')).toBe('job_1')
    expect(orchOwnerOfCaller(s, 'ses_person')).toBeNull()
    expect(orchOwnerOfCaller(s, '')).toBeNull()
  })
})

describe('graceOver', () => {
  const base = { scheduled: false, finishedAt: NOW_MS, typedAt: null, busy: false }
  it('is due at once when no person typed after the finish, busy or not', () => {
    expect(graceOver({ ...base, nowMs: NOW_MS })).toBe(true)
    expect(graceOver({ ...base, busy: true, nowMs: NOW_MS })).toBe(true)
    expect(graceOver({ ...base, busy: null, nowMs: NOW_MS })).toBe(true)
    // input before (or at) the finish counts for nothing
    expect(graceOver({ ...base, typedAt: NOW_MS - 5000, busy: true, nowMs: NOW_MS })).toBe(true)
    expect(graceOver({ ...base, typedAt: NOW_MS, busy: true, nowMs: NOW_MS })).toBe(true)
  })
  it('after a person typed post-finish, waits the grace from that input, and a busy session up to the cap', () => {
    const typed = { ...base, typedAt: NOW_MS + 1000 }
    expect(graceOver({ ...typed, nowMs: NOW_MS + 1000 + FINISHED_RUN_GRACE_MS - 1 })).toBe(false)
    expect(graceOver({ ...typed, nowMs: NOW_MS + 1000 + FINISHED_RUN_GRACE_MS })).toBe(true)
    expect(graceOver({ ...typed, busy: true, nowMs: NOW_MS + 1000 + FINISHED_RUN_GRACE_MS })).toBe(false)
    expect(graceOver({ ...typed, busy: true, nowMs: NOW_MS + 1000 + FINISHED_RUN_GRACE_MS + FINISHED_RUN_BUSY_CAP_MS })).toBe(true)
  })
  it('is due at once for a scheduled Run even after a person typed', () => {
    expect(graceOver({ ...base, typedAt: NOW_MS + 1000, scheduled: true, nowMs: NOW_MS })).toBe(true)
  })
})

describe('createRunEndSweep (the driving Host)', () => {
  const rig = (state: () => OrchState) => {
    const clock = { now: NOW_MS }
    const alive = new Set(live.map((x) => x.id))
    const logs: string[] = []
    const stop = vi.fn(async (id: string) => {
      alive.delete(id)
    })
    const activity = vi.fn()
    const sweep = createRunEndSweep({
      getState: state,
      live: () => live.filter((x) => alive.has(x.id)),
      stop,
      lastPersonInputAt: () => null,
      sessionBusy: () => false,
      mayStart: () => true,
      nowMs: () => clock.now,
      log: (m) => logs.push(m),
      activity
    })
    return { clock, alive, logs, stop, activity, sweep }
  }

  it('after the grace and a settled completion check, closes the sessions once and logs them in one line', async () => {
    const s = finished()
    // A plan that replans: its Run was seen running, so it waits for its completion check
    let state: OrchState = { ...s, jobs: [job({ replan: 'waves', plannerAccountId: 'accA' } as Partial<Job>)], tasks: s.tasks.map((t) => (t.id === 'tsk_b' ? { ...t, status: 'dispatched' as const } : t)) }
    const r = rig(() => state)
    await r.sweep.run()
    state = { ...state, tasks: s.tasks }
    r.clock.now = NOW_MS + FINISHED_RUN_GRACE_MS - 1
    await r.sweep.run()
    expect(r.stop).not.toHaveBeenCalled()
    r.clock.now = NOW_MS + FINISHED_RUN_GRACE_MS + 1
    await r.sweep.run()
    expect(r.stop).not.toHaveBeenCalled()
    state = { ...state, jobs: [{ ...state.jobs[0], lastReplan: { runId: 'run_1', mode: 'completion', wave: 1, done: 4, at: NOW, summary: 'ok' } }] }
    await r.sweep.run()
    await r.sweep.run()
    expect(r.stop.mock.calls.map((c) => c[0])).toEqual(['ses_planner', 'ses_open', 'ses_lost', 'ses_created', 'ses_agent'])
    expect(r.logs.filter((m) => m.startsWith('run=run_1 finished'))).toEqual([
      'run=run_1 finished: closed ses_planner (planner), ses_open (worker), ses_lost (untracked worker), ses_created (created), ses_agent (in worktree)' +
        '; left to the coordinator stop and the worker release ses_coord (coordinator), ses_tracked (worker)' +
        '; kept ses_owner_tab (not started by orchestration), ses_retained (retained)'
    ])
    expect(r.alive.has('ses_owner_tab') && r.alive.has('ses_retained')).toBe(true)
  })

  it('resends with backoff and gives up with one feed line', async () => {
    const r = rig(() => finished())
    r.stop.mockImplementation(async () => {})
    r.clock.now = NOW_MS + FINISHED_RUN_GRACE_MS
    for (let i = 0; i < 40; i++) {
      await r.sweep.run()
      r.clock.now += 10 * 60_000
    }
    const sends = r.stop.mock.calls.filter((c) => c[0] === 'ses_created').length
    expect(sends).toBeGreaterThan(1)
    expect(sends).toBeLessThan(40)
    expect(r.activity).toHaveBeenCalledTimes(1)
    expect(r.activity.mock.calls[0][0]).toMatchObject({ type: 'watchdog', runId: 'run_1' })
  })
})
