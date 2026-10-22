// T3: the app places the ready Tasks of a coordinator-run plan the moment they are ready (placedByApp), under the same
// rules as a Run it drives alone: the plan's concurrency, the app-wide cap, the file guard, the waves, the accounts.
import { describe, expect, it } from 'vitest'
import { slotsToFill } from './schedule'
import { drivenByAppAlone, emptyState, placedByApp, type OrchState } from './state'
import type { Dispatch, Job, JobRun, Task } from './types'

const T0 = '2026-10-22T00:00:00.000Z'

/** An approved plan handed to a coordinator: no `autoDispatch` (the hand-over drops it), a coordinator account. */
const job = (over: Partial<Job> = {}): Job => ({ id: 'j1', objective: 'o', cwd: '/p', createdAt: T0, coordinatorAccountId: 'acc_c', concurrency: 2, ...over })
const run = (over: Partial<JobRun> = {}): JobRun => ({ id: 'r1', jobId: 'j1', ordinal: 1, createdAt: T0, coordinatorSessionId: 'coord_1', ...over })
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  runId: 'r1',
  title: id,
  spec: 's',
  deps: [],
  status: 'ready',
  accountIds: ['acc_1'],
  consecutiveFailures: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over
})
const dispatch = (id: string, taskId: string): Dispatch =>
  ({ id, taskId, provider: 'claude', accountId: 'acc_1', sessionId: `ses_${id}`, cwd: '/p', specPath: '/spec', startedAt: T0, workerState: 'ready', retained: false })

const state = (tasks: Task[], o: { job?: Partial<Job>; run?: Partial<JobRun>; dispatches?: Dispatch[] } = {}): OrchState => ({
  ...emptyState(),
  jobs: [job(o.job)],
  runs: [run(o.run)],
  tasks,
  dispatches: o.dispatches ?? []
})
const placed = (s: OrchState, cap?: number | null): string[] => slotsToFill(s, { maxConcurrentWorkers: cap }).map((x) => x.taskId)

describe('slotsToFill — a coordinator-run plan', () => {
  it('places its ready Tasks, with the account of each', () => {
    expect(slotsToFill(state([task('a'), task('b')]))).toEqual([
      { runId: 'r1', taskId: 'a', accountIds: ['acc_1'] },
      { runId: 'r1', taskId: 'b', accountIds: ['acc_1'] }
    ])
  })

  it('once its coordinator is attached, not on the coordinator account alone (a start in flight or failed)', () => {
    expect(placed(state([task('a')], { job: { coordinatorAccountId: undefined } }))).toEqual(['a'])
    expect(placed(state([task('a')], { run: { coordinatorSessionId: undefined } }))).toEqual([])
    expect(placed(state([task('a')], { run: { coordinatorSessionId: undefined, coordinatorStartingAt: T0 } }))).toEqual([])
  })

  it("keeps the plan's concurrency and the app-wide cap", () => {
    const busy = task('busy', { status: 'dispatched' })
    expect(placed(state([busy, task('a'), task('b')], { dispatches: [dispatch('d1', 'busy')] }))).toEqual(['a'])
    expect(placed(state([task('a'), task('b')]), 1)).toEqual(['a'])
  })

  it('keeps the file guard and the waves, the circuit break and an open Dispatch', () => {
    const editing = task('busy', { status: 'dispatched', affectedPaths: ['src/a'] })
    expect(placed(state([editing, task('clash', { affectedPaths: ['src/a/b.ts'] })], { dispatches: [dispatch('d1', 'busy')] }))).toEqual([])
    // a planned plan while its replan between waves is under way
    const replanning = { runId: 'r1', wave: 0, startedAt: T0 } as unknown as Job['replanning']
    expect(placed(state([task('a')], { job: { plannerSessionIds: ['pl_1'], replanning } }))).toEqual([])
    // and a Task a deviation it can affect holds for its replan (per-Task waves)
    const later = [task('w0', { status: 'completed', completionOverride: { reason: 'r', at: T0 } }), task('w1', { deps: ['w0'] })]
    expect(placed(state(later, { job: { plannerSessionIds: ['pl_1'] } }))).toEqual([])
    expect(placed(state(later))).toEqual(['w1'])
    expect(placed(state([task('broken', { consecutiveFailures: 3 })]))).toEqual([])
    expect(placed(state([task('open')], { dispatches: [dispatch('d1', 'open')] }))).toEqual([])
  })

  it('places its accountless ready Task on auto (T5b), as for any Run the app places', () => {
    expect(slotsToFill(state([task('none', { accountIds: [] })]))).toEqual([{ runId: 'r1', taskId: 'none', accountIds: [] }])
  })

  it('places nothing while paused, held, not yet started or archived', () => {
    const ready = [task('a')]
    expect(placed(state(ready, { run: { paused: true } }))).toEqual([])
    expect(placed(state(ready, { job: { paused: true } }))).toEqual([])
    expect(placed(state(ready, { job: { dispatchHold: true } }))).toEqual([])
    expect(placed(state(ready, { job: { pendingStart: true } }))).toEqual([])
    expect(placed(state(ready, { job: { archivedAt: T0 } }))).toEqual([])
  })

  it("leaves a scheduled Job's coordinator Run to its coordinator (JobRun.autoDispatch's rule holds)", () => {
    const schedule = { kind: 'daily', at: '09:00' } as unknown as Job['schedule']
    expect(placed(state([task('a')], { job: { schedule } }))).toEqual([])
    expect(placed(state([task('a')], { job: { schedule, coordinatorAccountId: undefined }, run: { coordinatorSessionId: undefined, autoDispatch: true } }))).toEqual(['a'])
  })

  it('a Run with neither a coordinator nor autoDispatch is still placed by nobody', () => {
    expect(placed(state([task('a')], { job: { coordinatorAccountId: undefined }, run: { coordinatorSessionId: undefined } }))).toEqual([])
  })
})

describe('placedByApp and drivenByAppAlone', () => {
  it('a coordinator Run is placed by the app, but not driven by it alone (recovery leaves its retries to the coordinator)', () => {
    expect(placedByApp(job(), run())).toBe(true)
    expect(drivenByAppAlone(job(), run())).toBe(false)
    expect(drivenByAppAlone(job({ autoDispatch: true, coordinatorAccountId: undefined }), run({ coordinatorSessionId: undefined }))).toBe(true)
  })
})
