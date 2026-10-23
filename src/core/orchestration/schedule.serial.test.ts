// T7: same-file Tasks run side by side, each in its own worktree; the merge worker (integrate.ts) settles a conflict
// when their branches meet. A project's `serialFiles` brings back the W6-C file guard and the T9 leases exactly.
import { describe, expect, it } from 'vitest'
import { editingByProject, leasesByProject, serialFilesOf, slotsToFill } from './schedule'
import { taskBoardsOf } from './blocked'
import { emptyState, type OrchState } from './state'
import type { Dispatch, Job, JobRun, Task } from './types'

const T0 = '2026-10-23T00:00:00.000Z'

const job = (id: string, over: Partial<Job> = {}): Job =>
  ({ id, objective: id, cwd: '/repo', projectId: 'prj', createdAt: T0, autoDispatch: true, concurrency: 10, ...over })
const run = (id: string, jobId: string): JobRun => ({ id, jobId, ordinal: 1, createdAt: T0 })
const task = (id: string, runId: string, over: Partial<Task> = {}): Task => ({
  id,
  runId,
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
  ({ id, taskId, provider: 'claude', accountId: 'acc_1', sessionId: `ses_${id}`, cwd: '/repo', specPath: '/spec', startedAt: T0, workerState: 'ready', retained: false })

/** Plans jA and jB of project `prj`; `serialFiles` as given. */
const base = (tasks: Task[], serialFiles?: boolean, dispatches: Dispatch[] = []): OrchState => ({
  ...emptyState(),
  projects: [{ id: 'prj', path: '/repo', name: 'repo', addedAt: T0, ...(serialFiles !== undefined ? { serialFiles } : {}) }],
  jobs: [job('jA'), job('jB', { createdAt: '2026-10-23T01:00:00.000Z' })],
  runs: [run('r1', 'jA'), run('r2', 'jB')],
  tasks,
  dispatches
})
const placed = (s: OrchState): string[] => slotsToFill(s).map((x) => x.taskId).sort()

describe('same-file Tasks run in parallel (T7)', () => {
  it('two ready Tasks of one plan on the same file both start at once', () => {
    const s = base([task('a', 'r1', { affectedPaths: ['src/x.ts'] }), task('b', 'r1', { affectedPaths: ['src/x.ts'] })])
    expect(placed(s)).toEqual(['a', 'b'])
  })

  it('two plans of one project on the same file both start at once', () => {
    const s = base([task('a', 'r1', { affectedPaths: ['src/'] }), task('b', 'r2', { affectedPaths: ['src/x.ts'] })])
    expect(placed(s)).toEqual(['a', 'b'])
  })

  it('a worker at the files holds nothing back, and the board does not call it waiting', () => {
    const s = base([task('a', 'r1', { status: 'dispatched', affectedPaths: ['src/x.ts'] }), task('b', 'r2', { affectedPaths: ['src/x.ts'] })], undefined, [dispatch('d1', 'a')])
    expect(placed(s)).toEqual(['b'])
    expect(editingByProject(s).get('prj')).toBeUndefined()
    expect(taskBoardsOf(s).get('b')?.reason).toEqual({ kind: 'next' })
  })

  it("a finished Task no longer leases its files until its plan delivers", () => {
    const s = base([task('a', 'r1', { status: 'completed', affectedPaths: ['src/x.ts'] }), task('b', 'r2', { affectedPaths: ['src/x.ts'] })])
    expect(leasesByProject(s).size).toBe(0)
    expect(placed(s)).toEqual(['b'])
  })

  it('off is the default; only the workspace (root project) turns it on', () => {
    expect(serialFilesOf(base([]), 'prj')).toBe(false)
    expect(serialFilesOf(base([], true), 'prj')).toBe(true)
    expect(serialFilesOf(base([], true), 'cwd:/repo')).toBe(false)
  })
})

describe('serialFiles brings back the old wait (T7)', () => {
  it('two ready Tasks on the same file: one at a time', () => {
    const s = base([task('a', 'r1', { affectedPaths: ['src/x.ts'] }), task('b', 'r2', { affectedPaths: ['src/x.ts'] })], true)
    expect(placed(s)).toEqual(['a'])
    expect(taskBoardsOf(s).get('b')?.reason).toMatchObject({ kind: 'same-files', waitingOn: { id: 'a' } })
  })

  it('a worker at the files holds the other back', () => {
    const s = base([task('a', 'r1', { status: 'dispatched', affectedPaths: ['src/x.ts'] }), task('b', 'r2', { affectedPaths: ['src/x.ts'] })], true, [dispatch('d1', 'a')])
    expect(placed(s)).toEqual([])
  })

  it("a finished Task leases its files until its plan delivers", () => {
    const s = base([task('a', 'r1', { status: 'completed', affectedPaths: ['src/x.ts'] }), task('b', 'r2', { affectedPaths: ['src/x.ts'] })], true)
    expect(leasesByProject(s).get('prj')?.map((l) => l.id)).toEqual(['a'])
    expect(placed(s)).toEqual([])
    expect(taskBoardsOf(s).get('b')?.reason).toMatchObject({ kind: 'same-files', delivery: true })
  })
})
