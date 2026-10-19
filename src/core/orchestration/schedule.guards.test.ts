// W6-C: never two workers on the same files (pathsOverlap, slotsToFill, the board's reason) and the hard cap of 10.
import { describe, expect, it } from 'vitest'
import { pathsOverlap, slotsToFill, workerCapOf } from './schedule'
import { taskBoardsOf } from './blocked'
import { emptyState, type OrchState } from './state'
import { MAX_CONCURRENT_WORKERS, type Dispatch, type Job, type JobRun, type Task } from './types'
import { maxConcurrentWorkersOf } from '../settings/maxConcurrentWorkers'

const T0 = '2026-10-18T00:00:00.000Z'

const job = (id: string, over: Partial<Job> = {}): Job => ({ id, objective: id, cwd: '/p', createdAt: T0, autoDispatch: true, concurrency: 10, ...over })
const run = (id: string, jobId: string): JobRun => ({ id, jobId, ordinal: 1, createdAt: T0 })
const task = (id: string, runId: string, over: Partial<Task> = {}): Task => ({
  id,
  runId,
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
const dispatch = (id: string, taskId: string): Dispatch =>
  ({ id, taskId, provider: 'claude', accountId: 'acc_1', sessionId: `ses_${id}`, cwd: '/p', specPath: '/spec', startedAt: T0, workerState: 'ready', retained: false })

/** Job j1 with Run r1 holding `tasks`; a second Job j2 with Run r2 when `other` is given. */
const state = (tasks: Task[], dispatches: Dispatch[] = [], other: Task[] = []): OrchState => ({
  ...emptyState(),
  jobs: [job('j1'), ...(other.length ? [job('j2')] : [])],
  runs: [run('r1', 'j1'), ...(other.length ? [run('r2', 'j2')] : [])],
  tasks: [...tasks, ...other],
  dispatches
})
const placed = (s: OrchState, cap?: number | null): string[] => slotsToFill(s, { maxConcurrentWorkers: cap }).map((x) => x.taskId)

describe('pathsOverlap', () => {
  it('equal paths overlap', () => expect(pathsOverlap('src/a.ts', 'src/a.ts')).toBe(true))
  it('a directory overlaps the files under it, both ways', () => {
    expect(pathsOverlap('src/a', 'src/a/b.ts')).toBe(true)
    expect(pathsOverlap('src/a/b.ts', 'src/a/')).toBe(true)
  })
  it('a shared name prefix is not a directory prefix', () => expect(pathsOverlap('src/a', 'src/ab')).toBe(false))
  it('siblings do not overlap', () => expect(pathsOverlap('src/a/x.ts', 'src/a/y.ts')).toBe(false))
  it('a glob is the directory before its first *', () => {
    expect(pathsOverlap('src/a/**/*.ts', 'src/a/deep/c.ts')).toBe(true)
    expect(pathsOverlap('src/a/*.ts', 'src/b/c.ts')).toBe(false)
    expect(pathsOverlap('*', 'anything/at/all')).toBe(true)
  })
  it('./ and backslashes do not hide an overlap', () => expect(pathsOverlap('./src/a', 'src\\a\\b.ts')).toBe(true))
})

describe('slotsToFill — same files', () => {
  it('skips a ready Task whose paths overlap a running one of the same Job', () => {
    const s = state([
      task('run', 'r1', { status: 'dispatched', affectedPaths: ['src/a'] }),
      task('clash', 'r1', { affectedPaths: ['src/a/b.ts'] }),
      task('free', 'r1', { affectedPaths: ['src/ab'] })
    ], [dispatch('d1', 'run')])
    expect(placed(s)).toEqual(['free'])
  })

  it('validating and reviewing Tasks hold their files too', () => {
    for (const status of ['validating', 'reviewing'] as const) {
      const s = state([task('busy', 'r1', { status, affectedPaths: ['src/a.ts'] }), task('clash', 'r1', { affectedPaths: ['src/a.ts'] })])
      expect(placed(s)).toEqual([])
    }
  })

  it('never places two overlapping ready Tasks in one pass', () => {
    const s = state([task('one', 'r1', { affectedPaths: ['src/a'] }), task('two', 'r1', { affectedPaths: ['src/a/b.ts'] })])
    expect(placed(s)).toEqual(['one'])
  })

  it('a Task with no affected paths overlaps nothing', () => {
    const s = state([task('run', 'r1', { status: 'dispatched', affectedPaths: ['src/a'] }), task('none', 'r1')], [dispatch('d1', 'run')])
    expect(placed(s)).toEqual(['none'])
  })

  // W8-D: another plan of the same repository is held back too (overlap.test.ts); one of another repository is not
  it('another Job of another project on the same paths is not held back', () => {
    const s = state([task('run', 'r1', { status: 'dispatched', affectedPaths: ['src/a'] })], [dispatch('d1', 'run')], [task('elsewhere', 'r2', { affectedPaths: ['src/a'] })])
    const other: OrchState = { ...s, jobs: s.jobs.map((j) => (j.id === 'j2' ? { ...j, cwd: '/q' } : j)) }
    expect(placed(other)).toEqual(['elsewhere'])
    expect(placed(s)).toEqual([])
  })

  it('the board says which Task holds the files, and the first colliding path', () => {
    const s = state([
      task('run', 'r1', { status: 'dispatched', title: 'Edit A', affectedPaths: ['src/a'] }),
      task('clash', 'r1', { affectedPaths: ['docs/x.md', 'src/a/b.ts'] })
    ], [dispatch('d1', 'run')])
    expect(taskBoardsOf(s).get('clash')?.reason).toEqual({ kind: 'same-files', waitingOn: { id: 'run', title: 'Edit A' }, path: 'src/a/b.ts' })
  })

  it('the board names the Task this pass places ahead of it', () => {
    const s = state([task('one', 'r1', { title: 'First', affectedPaths: ['src/a'] }), task('two', 'r1', { affectedPaths: ['src/a'] })])
    const boards = taskBoardsOf(s)
    expect(boards.get('one')?.reason).toEqual({ kind: 'next' })
    expect(boards.get('two')?.reason).toEqual({ kind: 'same-files', waitingOn: { id: 'one', title: 'First' }, path: 'src/a' })
  })
})

describe('the app-wide cap never passes 10', () => {
  const many = (): OrchState => {
    const s = emptyState()
    for (const k of ['A', 'B'] as const) {
      s.jobs.push(job(k))
      s.runs.push(run(`r_${k}`, k))
      for (let i = 1; i <= 8; i++) s.tasks.push(task(`${k}${i}`, `r_${k}`))
    }
    return s
  }

  it('no cap set places at most 10', () => {
    expect(MAX_CONCURRENT_WORKERS).toBe(10)
    expect(placed(many())).toHaveLength(10)
    expect(placed(many(), null)).toHaveLength(10)
  })
  it('a larger cap reads as 10', () => expect(placed(many(), 50)).toHaveLength(10))
  it('a smaller cap still holds', () => expect(placed(many(), 4)).toHaveLength(4))
  it('workerCapOf and the settings read agree', () => {
    expect(workerCapOf(undefined)).toBe(10)
    expect(workerCapOf(12)).toBe(10)
    expect(workerCapOf(3)).toBe(3)
    expect(maxConcurrentWorkersOf(25)).toBe(10)
    expect(maxConcurrentWorkersOf(7)).toBe(7)
    expect(maxConcurrentWorkersOf(undefined)).toBeNull()
  })
  it('the board reports the app-wide cap of 10 when none is set', () => {
    const r = taskBoardsOf(many()).get('B8')?.reason
    expect(r).toMatchObject({ kind: 'global-cap', limit: 10 })
  })
})
