// W2-C: every "why is it waiting" reason and every board bucket (blocked.ts).
import { describe, expect, it } from 'vitest'
import { taskBoardsOf } from './blocked'
import { startPauseOf } from './usageGuard'
import { emptyState, type OrchState } from './state'
import type { Dispatch, Gate, Job, JobRun, Task } from './types'
import { FAILURE_LIMIT } from './types'

const T0 = '2026-10-17T00:00:00.000Z'

const job = (id: string, over: Partial<Job> = {}): Job => ({
  id,
  objective: id,
  cwd: '/p',
  createdAt: T0,
  autoDispatch: true,
  concurrency: 3,
  ...over
})
const run = (id: string, jobId: string, over: Partial<JobRun> = {}): JobRun => ({ id, jobId, ordinal: 1, createdAt: T0, ...over })
const task = (id: string, runId: string | undefined, over: Partial<Task> = {}): Task => ({
  id,
  ...(runId !== undefined ? { runId } : {}),
  title: `title ${id}`,
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['acc_1'],
  consecutiveFailures: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over
})
const dispatch = (id: string, taskId: string, over: Partial<Dispatch> = {}): Dispatch => ({
  id,
  taskId,
  provider: 'claude',
  accountId: 'acc_1',
  sessionId: `ses_${id}`,
  cwd: '/p',
  specPath: '/spec',
  startedAt: T0,
  workerState: 'ready',
  retained: false,
  ...over
})
const gate = (id: string, taskId: string, over: Partial<Gate> = {}): Gate => ({
  id,
  runId: 'r1',
  taskId,
  question: 'Which way?',
  status: 'open',
  createdAt: T0,
  ...over
})

/** One Job `j1`, one Run `r1`, and the given Tasks in it. */
const one = (tasks: Task[], jobOver: Partial<Job> = {}, runOver: Partial<JobRun> = {}): OrchState => ({
  ...emptyState(),
  jobs: [job('j1', jobOver)],
  runs: [run('r1', 'j1', runOver)],
  tasks
})
const boardOf = (s: OrchState, id: string, cap?: number | null) =>
  taskBoardsOf(s, { maxConcurrentWorkers: cap }).get(id)
const reasonOf = (s: OrchState, id: string, cap?: number | null) => boardOf(s, id, cap)?.reason

describe('taskBoardsOf — why a plan is paused', () => {
  const mark = { runId: 'r1', wave: 1, done: 0, startedAt: T0 }
  const why = (jobOver: Partial<Job>, runOver: Partial<JobRun> = {}, over: Partial<Task> = {}) =>
    reasonOf(one([task('a', 'r1', over)], jobOver, runOver), 'a')

  it("the owner's hold (jobs-hold)", () => {
    expect(why({ dispatchHold: true })).toEqual({ kind: 'paused', why: 'held' })
  })

  it('a wave replan and the final check before delivery', () => {
    expect(why({ dispatchHold: true, replanning: { ...mark, mode: 'wave' } })).toEqual({ kind: 'paused', why: 'replanning' })
    expect(why({ dispatchHold: true, replanning: { ...mark, mode: 'completion' } })).toEqual({ kind: 'paused', why: 'final-check' })
  })

  it('a replan handed to the owner keeps the hold until they answer', () => {
    const lastReplan = { ...mark, mode: 'completion' as const, at: T0, summary: 's', escalated: 'the plan does not hold' }
    expect(why({ dispatchHold: true, lastReplan })).toEqual({ kind: 'paused', why: 'replan-question' })
  })

  it('runs-stop, and a paused schedule', () => {
    expect(why({}, { paused: true })).toEqual({ kind: 'paused', why: 'stopped' })
    expect(why({ schedule: { kind: 'interval', minutes: 30 }, paused: true }, { paused: true })).toEqual({ kind: 'paused', why: 'schedule' })
  })

  it('a merging Task is never paused', () => {
    expect(why({ dispatchHold: true, replanning: { ...mark, mode: 'completion' } }, {}, { status: 'merging' })).toBeUndefined()
    expect(why({}, { paused: true }, { status: 'merging' })).toBeUndefined()
  })
})

describe('taskBoardsOf — reasons', () => {
  it('waiting on deps names the unfinished ones only', () => {
    const s = one([
      task('a', 'r1', { status: 'completed' }),
      task('b', 'r1', { status: 'dispatched' }),
      task('c', 'r1', { status: 'pending', deps: ['a', 'b'] })
    ])
    s.dispatches = [dispatch('d_b', 'b')]
    expect(reasonOf(s, 'c')).toEqual({ kind: 'deps', waitingOn: [{ id: 'b', title: 'title b', status: 'dispatched' }] })
  })

  it('a dep of another plan that is completed but not delivered still holds the Task, marked delivery', () => {
    const s = emptyState()
    s.jobs = [job('j1'), job('j2')]
    s.runs = [run('r1', 'j1'), run('r2', 'j2')]
    s.tasks = [task('a', 'r1', { status: 'completed' }), task('c', 'r2', { status: 'pending', deps: ['a'] })]
    expect(reasonOf(s, 'c')).toEqual({ kind: 'deps', waitingOn: [{ id: 'a', title: 'title a', status: 'completed', delivery: true }] })
    // once its plan delivered, nothing holds it
    s.runs[0] = run('r1', 'j1', { delivery: { sha: 'abc' } as JobRun['delivery'] })
    expect(reasonOf(s, 'c')).toEqual({ kind: 'next' })
  })

  it('a ready Task with a slot is next', () => {
    expect(reasonOf(one([task('a', 'r1')]), 'a')).toEqual({ kind: 'next' })
  })

  it('the plan cap full', () => {
    const s = one([task('a', 'r1', { status: 'dispatched' }), task('b', 'r1')], { concurrency: 1 })
    s.dispatches = [dispatch('d_a', 'a')]
    expect(reasonOf(s, 'b')).toEqual({ kind: 'plan-cap', used: 1, limit: 1 })
  })

  it('the plan cap taken by a sibling handed the last slot this pass', () => {
    const s = one([task('a', 'r1'), task('b', 'r1')], { concurrency: 1 })
    expect(reasonOf(s, 'a')).toEqual({ kind: 'next' })
    expect(reasonOf(s, 'b')).toEqual({ kind: 'plan-cap', used: 0, limit: 1 })
  })

  it('the global cap full, with the plan priority', () => {
    const s: OrchState = {
      ...emptyState(),
      jobs: [job('j1', { priority: 2 }), job('j2')],
      runs: [run('r1', 'j1'), run('r2', 'j2')],
      tasks: [task('a', 'r1', { status: 'dispatched' }), task('b', 'r2')],
      dispatches: [dispatch('d_a', 'a')]
    }
    expect(reasonOf(s, 'b', 1)).toEqual({ kind: 'global-cap', used: 1, limit: 1, priority: 0 })
    // No cap: it would be placed
    expect(reasonOf(s, 'b')).toEqual({ kind: 'next' })
  })

  it("the global cap's last slot going to a higher-priority plan", () => {
    const s: OrchState = {
      ...emptyState(),
      jobs: [job('j1', { priority: 5 }), job('j2', { priority: 1 })],
      runs: [run('r1', 'j1'), run('r2', 'j2')],
      tasks: [task('a', 'r1'), task('b', 'r2')]
    }
    expect(reasonOf(s, 'a', 1)).toEqual({ kind: 'next' })
    expect(reasonOf(s, 'b', 1)).toEqual({ kind: 'global-cap', used: 0, limit: 1, priority: 1 })
  })

  it('plan paused, archived, pending start (jobActive / isJobActive)', () => {
    expect(reasonOf(one([task('a', 'r1')], { paused: true }), 'a')).toEqual({ kind: 'paused', why: 'stopped' })
    expect(reasonOf(one([task('a', 'r1')], {}, { paused: true }), 'a')).toEqual({ kind: 'paused', why: 'stopped' })
    expect(reasonOf(one([task('a', 'r1')], { archivedAt: T0 }), 'a')).toEqual({ kind: 'archived' })
    expect(reasonOf(one([task('a', 'r1')], { pendingStart: true }), 'a')).toEqual({ kind: 'pending-start' })
    // Archived wins over paused: unpausing it would still start nothing
    expect(reasonOf(one([task('a', 'r1')], { archivedAt: T0, paused: true }), 'a')).toEqual({ kind: 'archived' })
  })

  it('a definition Task (no Run) of a started Job', () => {
    const s: OrchState = { ...emptyState(), jobs: [job('j1')], tasks: [task('a', undefined, { jobId: 'j1' })] }
    expect(reasonOf(s, 'a')).toEqual({ kind: 'definition' })
  })

  it('no account', () => {
    expect(reasonOf(one([task('a', 'r1', { accountIds: [] })]), 'a')).toEqual({ kind: 'no-account' })
    expect(reasonOf(one([task('a', 'r1', { accountIds: undefined })]), 'a')).toEqual({ kind: 'no-account' })
  })

  it('a coordinator-driven Run', () => {
    expect(reasonOf(one([task('a', 'r1')], { autoDispatch: false }), 'a')).toEqual({ kind: 'coordinator' })
  })

  it('failure limit hit, on a ready and on a failed Task', () => {
    const lim = { kind: 'failure-limit', failures: FAILURE_LIMIT, limit: FAILURE_LIMIT }
    expect(reasonOf(one([task('a', 'r1', { consecutiveFailures: FAILURE_LIMIT })]), 'a')).toEqual(lim)
    expect(reasonOf(one([task('a', 'r1', { status: 'failed', consecutiveFailures: FAILURE_LIMIT })]), 'a')).toEqual(lim)
  })

  it('failed with retries left', () => {
    const failed = [task('a', 'r1', { status: 'failed', consecutiveFailures: 1 })]
    expect(reasonOf(one(failed, { autoDispatch: false }, { coordinatorSessionId: 'coord' }), 'a')).toEqual({
      kind: 'failed-retry',
      failures: 1,
      limit: FAILURE_LIMIT
    })
    // W5-B (#45): no coordinator to decide on the retry, so the board does not name one
    expect(reasonOf(one(failed), 'a')).toEqual({ kind: 'failed-retry', failures: 1, limit: FAILURE_LIMIT, noCoordinator: true })
  })

  it('gate open names the oldest open gate', () => {
    const s = one([task('a', 'r1', { status: 'blocked' })])
    s.gates = [
      gate('g2', 'a', { question: 'later', createdAt: '2026-10-17T01:00:00.000Z' }),
      gate('g1', 'a', { kind: 'convergence-exhausted' }),
      gate('g0', 'a', { status: 'resolved', createdAt: '2026-10-16T00:00:00.000Z' })
    ]
    expect(reasonOf(s, 'a')).toEqual({ kind: 'gate', gateId: 'g1', question: 'Which way?', gateKind: 'convergence-exhausted' })
  })

  it('awaiting review: reviewing with no reviewer open', () => {
    expect(reasonOf(one([task('a', 'r1', { status: 'reviewing' })]), 'a')).toEqual({ kind: 'awaiting-review' })
    // The reviewer is on it: running, no reason
    const s = one([task('a', 'r1', { status: 'reviewing' })])
    s.dispatches = [dispatch('d_r', 'a', { review: true })]
    expect(reasonOf(s, 'a')).toBeUndefined()
  })

  it('rate-limited: the open Dispatch waiting on its roll', () => {
    const s = one([task('a', 'r1', { status: 'dispatched' })])
    s.dispatches = [
      dispatch('d_a', 'a', {
        resumes: [
          { stoppedAt: T0, reason: 'waiting', fromAccountId: 'acc_0', resumedAt: T0 },
          { stoppedAt: T0, reason: 'waiting', fromAccountId: 'acc_1', resetsAt: '2026-10-17T05:00:00.000Z' }
        ]
      })
    ]
    expect(reasonOf(s, 'a')).toEqual({
      kind: 'rate-limited',
      accountId: 'acc_1',
      switching: false,
      resetsAt: '2026-10-17T05:00:00.000Z'
    })
    s.dispatches[0].resumes = [{ stoppedAt: T0, reason: 'switching', fromAccountId: 'acc_1' }]
    expect(reasonOf(s, 'a')).toEqual({ kind: 'rate-limited', accountId: 'acc_1', switching: true })
  })

  it('stopped: dispatched with no worker', () => {
    const s = one([task('a', 'r1', { status: 'dispatched' })])
    s.dispatches = [dispatch('d_a', 'a', { endedAt: T0, workerState: 'stopped', closedBy: 'stop' })]
    expect(reasonOf(s, 'a')).toEqual({ kind: 'stopped' })
  })

  it('no reason for a running, validating or completed Task', () => {
    const s = one([
      task('a', 'r1', { status: 'dispatched' }),
      task('b', 'r1', { status: 'validating' }),
      task('c', 'r1', { status: 'completed' })
    ])
    s.dispatches = [dispatch('d_a', 'a')]
    for (const id of ['a', 'b', 'c']) expect(reasonOf(s, id)).toBeUndefined()
  })
})

describe('taskBoardsOf — categories', () => {
  const cat = (s: OrchState, id: string) => boardOf(s, id)?.category

  it('one bucket per status', () => {
    const s = one([
      task('done', 'r1', { status: 'completed' }),
      task('fail', 'r1', { status: 'failed', consecutiveFailures: 1 }),
      task('rev', 'r1', { status: 'reviewing' }),
      task('val', 'r1', { status: 'validating' }),
      task('run', 'r1', { status: 'dispatched' }),
      task('pend', 'r1', { status: 'pending', deps: ['run'] }),
      task('ready', 'r1'),
      task('blk', 'r1', { status: 'blocked' })
    ])
    s.dispatches = [dispatch('d_run', 'run')]
    expect(Object.fromEntries([...taskBoardsOf(s)].map(([id, b]) => [id, b.category]))).toEqual({
      done: 'done',
      fail: 'failed',
      rev: 'awaiting-review',
      val: 'running',
      run: 'running',
      pend: 'queued',
      ready: 'queued',
      blk: 'queued'
    })
  })

  it('cancelled only when a person closed the worker; a pause or a loss is queued', () => {
    const closed = (closedBy?: Dispatch['closedBy']): OrchState => {
      const s = one([task('a', 'r1', { status: 'dispatched' })])
      s.dispatches = [
        dispatch('d_old', 'a', { endedAt: T0, outcome: 'failed' }),
        dispatch('d_a', 'a', {
          startedAt: '2026-10-17T01:00:00.000Z',
          endedAt: T0,
          workerState: 'stopped',
          ...(closedBy ? { closedBy } : {})
        })
      ]
      return s
    }
    expect(cat(closed('stop'), 'a')).toBe('cancelled')
    expect(cat(closed('abandon'), 'a')).toBe('cancelled')
    expect(cat(closed('pause'), 'a')).toBe('queued')
    expect(cat(closed(), 'a')).toBe('queued')
  })

  it('a rate-limited worker is still running (its session is open)', () => {
    const s = one([task('a', 'r1', { status: 'dispatched' })])
    s.dispatches = [dispatch('d_a', 'a', { resumes: [{ stoppedAt: T0, reason: 'waiting', fromAccountId: 'acc_1' }] })]
    expect(boardOf(s, 'a')).toEqual({ category: 'running', reason: { kind: 'rate-limited', accountId: 'acc_1', switching: false } })
  })
})

// W6-G: a ready Task whose every account is nearly spent says so, with the window and when it resets.
describe('taskBoardsOf — usage pause', () => {
  const pause = { accountId: 'acc_1', window: 'five_hour' as const, percent: 93, resetsAt: '2026-10-17T14:20:00.000Z' }
  const pauseOf = (id: string) => (id === 'acc_1' ? { ...pause, accountId: id } : null)

  it('paused when every account of its chain is at the threshold', () => {
    const s = one([task('a', 'r1')])
    expect(taskBoardsOf(s, {}, pauseOf).get('a')?.reason).toEqual({ kind: 'usage-paused', ...pause })
  })

  // T1: "Pick accounts automatically" on (startPauseOf): a start rolls to the provider's account with room
  it('auto on: usage-paused only when every account of the provider is paused; an auto Task is no no-account', () => {
    const accounts = [{ id: 'acc_1' }, { id: 'acc_2' }]
    const s = one([task('a', 'r1'), task('b', 'r1', { accountIds: [] })])
    const room = startPauseOf(pauseOf, { auto: true, accounts, loggedInIds: new Set(['acc_1', 'acc_2']) })
    expect(taskBoardsOf(s, {}, room).get('a')?.reason).toEqual({ kind: 'next' })
    expect(taskBoardsOf(s, {}, room).get('b')?.reason).toEqual({ kind: 'next' })
    const full = startPauseOf((id) => ({ ...pause, accountId: id }), { auto: true, accounts, loggedInIds: new Set(['acc_1', 'acc_2']) })
    expect(taskBoardsOf(s, {}, full).get('a')?.reason).toEqual({ kind: 'usage-paused', ...pause })
    // auto off keeps both
    const off = startPauseOf(pauseOf, { auto: false, accounts, loggedInIds: new Set(['acc_1', 'acc_2']) })
    expect(taskBoardsOf(s, {}, off).get('a')?.reason).toEqual({ kind: 'usage-paused', ...pause })
    expect(taskBoardsOf(s, {}, off).get('b')?.reason).toEqual({ kind: 'no-account' })
  })

  it('not paused when its chain has an account under the threshold, or with no guard', () => {
    const s = one([task('a', 'r1', { accountIds: ['acc_1', 'acc_2'] })])
    expect(taskBoardsOf(s, {}, pauseOf).get('a')?.reason).toEqual({ kind: 'next' })
    expect(taskBoardsOf(one([task('a', 'r1')])).get('a')?.reason).toEqual({ kind: 'next' })
  })
})

describe('taskBoardsOf — a plan not yet delivered (T9)', () => {
  // T7: leases hold only on a project with serial files on
  const two = (r1: Partial<JobRun> = {}): OrchState => ({
    ...emptyState(),
    projects: [{ id: 'prj', path: '/p', name: 'p', addedAt: T0, serialFiles: true }],
    jobs: [job('j1', { title: 'Plan A', projectId: 'prj' }), job('j2', { title: 'Plan B', projectId: 'prj', createdAt: '2026-10-17T01:00:00.000Z' })],
    runs: [run('r1', 'j1', r1), run('r2', 'j2')],
    tasks: [task('t1', 'r1', { status: 'completed', affectedPaths: ['src/a.ts'] }), task('t2', 'r2', { affectedPaths: ['./src/a.ts'] })]
  })

  it('says the Task waits for that plan to deliver the path', () => {
    expect(taskBoardsOf(two()).get('t2')?.reason).toEqual({
      kind: 'same-files',
      waitingOn: { id: 't1', title: 'title t1' },
      path: './src/a.ts',
      plan: { id: 'j1', title: 'Plan A' },
      delivery: true
    })
  })

  it('says next once it delivered', () => {
    expect(taskBoardsOf(two({ pr: { at: T0, url: 'https://x/pr/2', number: 2 } })).get('t2')?.reason).toEqual({ kind: 'next' })
  })
})
