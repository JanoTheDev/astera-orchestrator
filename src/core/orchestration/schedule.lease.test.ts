// T2: a completed Task of an undelivered plan leases the files it really changed (Task.changedFiles, recorded when its
// validation starts), not its declared affectedPaths; its declared paths stand in only when nothing was recorded.
import { describe, expect, it } from 'vitest'
import { leasesByProject, slotsToFill } from './schedule'
import { emptyState, type OrchState } from './state'
import type { Dispatch, Job, JobRun, Task } from './types'

const T0 = '2026-10-22T00:00:00.000Z'

const job = (id: string, createdAt = T0): Job => ({ id, objective: id, cwd: '/repo', projectId: 'prj', createdAt, autoDispatch: true, concurrency: 3 })
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

/** Plan A (undelivered) has the merge Task `ta` (declared `src/`) in `over`'s state; plan B has a ready Task at `bPaths`. */
const plans = (over: Partial<Task>, bPaths: string[]): OrchState => ({
  ...emptyState(),
  projects: [{ id: 'prj', path: '/repo', name: 'repo', addedAt: T0 }],
  jobs: [job('jA'), job('jB')],
  runs: [run('r1', 'jA'), run('r2', 'jB')],
  tasks: [task('ta', 'r1', { status: 'completed', affectedPaths: ['src/'], ...over }), task('tb', 'r2', { affectedPaths: bPaths })]
})
const placed = (s: OrchState): string[] => slotsToFill(s).map((x) => x.taskId).sort()

describe('leasesByProject — the files a Task really changed (T2)', () => {
  it('a merge Task declared on src/ that changed tsconfig.web.json holds back only that file', () => {
    const changed = { changedFiles: ['tsconfig.web.json'] }
    expect(leasesByProject(plans(changed, [])).get('prj')?.map((l) => l.affectedPaths)).toEqual([['tsconfig.web.json']])
    expect(placed(plans(changed, ['src/core/foo.ts']))).toEqual(['tb'])
    expect(placed(plans(changed, ['tsconfig.web.json']))).toEqual([])
  })

  it('nothing recorded: the declared paths stay leased, as before', () => {
    expect(placed(plans({}, ['src/core/foo.ts']))).toEqual([])
  })

  it('a recorded empty list leases nothing', () => {
    expect(leasesByProject(plans({ changedFiles: [] }, ['src/core/foo.ts'])).get('prj')).toBeUndefined()
    expect(placed(plans({ changedFiles: [] }, ['src/core/foo.ts']))).toEqual(['tb'])
  })

  it('a Task still at work keeps its declared paths, whatever an earlier round recorded', () => {
    const s = plans({ status: 'dispatched', changedFiles: ['tsconfig.web.json'] }, ['src/core/foo.ts'])
    expect(placed({ ...s, dispatches: [dispatch('d1', 'ta')] })).toEqual([])
  })

  it('a cycle on the recorded files lets the older plan proceed', () => {
    const s: OrchState = {
      ...emptyState(),
      projects: [{ id: 'prj', path: '/repo', name: 'repo', addedAt: T0 }],
      jobs: [job('jA'), job('jB', '2026-10-22T01:00:00.000Z')],
      runs: [run('r1', 'jA'), run('r2', 'jB')],
      tasks: [
        task('ta', 'r1', { status: 'completed', affectedPaths: ['src/'], changedFiles: ['a.ts'] }),
        task('ta2', 'r1', { affectedPaths: ['b.ts'] }),
        task('tb', 'r2', { status: 'completed', affectedPaths: ['src/'], changedFiles: ['b.ts'] }),
        task('tb2', 'r2', { affectedPaths: ['a.ts'] })
      ]
    }
    expect(placed(s)).toEqual(['ta2'])
  })
})
