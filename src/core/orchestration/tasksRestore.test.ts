import { describe, it, expect } from 'vitest'
import { planTasksRestore } from './tasksRestore'
import { emptyState, type OrchState } from './state'
import type { Dispatch, Task, TaskStatus } from './types'

const AT = '2026-10-22T10:00:00.000Z'
const task = (id: string, runId: string, status: TaskStatus = 'ready'): Task =>
  ({ id, runId, title: `title ${id}`, spec: 's', deps: [], accountIds: [], status, consecutiveFailures: 0, createdAt: AT, updatedAt: AT }) as Task
const dispatch = (id: string, taskId: string, endedAt?: string): Dispatch =>
  ({ id, taskId, provider: 'claude', accountId: 'a', sessionId: `s_${id}`, cwd: '/x', startedAt: AT, ...(endedAt ? { endedAt, outcome: 'failed' } : {}) }) as unknown as Dispatch
const run = (id: string, jobId: string) => ({ id, jobId, ordinal: 1, createdAt: AT }) as OrchState['runs'][number]
const job = (id: string) => ({ id }) as OrchState['jobs'][number]

const backup: OrchState = {
  ...emptyState(),
  jobs: [job('job_a'), job('job_b')],
  runs: [run('run_a', 'job_a'), run('run_b', 'job_b')],
  tasks: [
    task('t1', 'run_a'),
    task('t2', 'run_a', 'pending'),
    task('t3', 'run_a', 'dispatched'),
    task('t4', 'run_a', 'completed'),
    task('tb', 'run_b'),
    { ...task('da', 'x'), runId: undefined, jobId: 'job_a' } as Task,
    { ...task('db2', 'x'), runId: undefined, jobId: 'job_b' } as Task
  ],
  dispatches: [dispatch('d3', 't3'), dispatch('d4', 't4', AT), dispatch('db', 'tb', AT)]
}
const live: OrchState = {
  ...emptyState(),
  jobs: [job('job_a'), job('job_b')],
  runs: [run('run_a', 'job_a'), run('run_b', 'job_b')],
  tasks: [{ ...task('t1', 'run_a'), title: 'live edit' }]
}

describe('planTasksRestore', () => {
  it('lists only the missing Tasks of the chosen Job', () => {
    const p = planTasksRestore(live, backup, { job: 'job_a' })
    expect(p.tasks.map((t) => t.id)).toEqual(['t2', 't3', 't4', 'da'])
    expect(p.state.tasks).toHaveLength(5)
  })

  it('restores them, skips existing ids and leaves other Jobs alone', () => {
    const p = planTasksRestore(live, backup, { run: 'run_a' })
    expect(p.state.tasks.find((t) => t.id === 't1')?.title).toBe('live edit')
    expect(p.state.tasks.some((t) => t.id === 'tb')).toBe(false)
    expect(p.state.tasks.some((t) => t.id === 'da')).toBe(false) // a run scope is run Tasks only
    expect(planTasksRestore(live, backup, { job: 'job_a' }).state.tasks.some((t) => t.id === 'db2')).toBe(false)
    expect(p.state.dispatches.some((d) => d.id === 'db')).toBe(false)
  })

  it('brings a dispatched Task back as ready, and not its open Dispatch; ended Dispatches return', () => {
    const p = planTasksRestore(live, backup, { job: 'job_a' })
    expect(p.state.tasks.find((t) => t.id === 't3')?.status).toBe('ready')
    expect(p.tasks.find((t) => t.id === 't3')).toMatchObject({ status: 'dispatched', restoredAs: 'ready' })
    expect(p.state.dispatches.map((d) => d.id)).toEqual(['d4'])
  })

  it('does nothing when everything is there, and takes exactly one scope', () => {
    const p = planTasksRestore(planTasksRestore(live, backup, { job: 'job_a' }).state, backup, { job: 'job_a' })
    expect(p.tasks).toEqual([])
    expect(planTasksRestore(live, backup, { job: 'job_x' }).tasks).toEqual([])
    expect(() => planTasksRestore(live, backup, {})).toThrow()
  })

  it('leaves out definition Tasks whose Job is gone from the live store', () => {
    const p = planTasksRestore({ ...live, jobs: [job('job_b')] }, backup, { job: 'job_a' })
    expect(p.tasks.map((t) => t.id)).toEqual(['t2', 't3', 't4'])
  })

  it('leaves out Tasks whose Run is gone from the live store', () => {
    const p = planTasksRestore({ ...live, runs: [] }, backup, { job: 'job_a' })
    expect(p.tasks.map((t) => t.id)).toEqual(['da']) // only the definition Task: no Run to hang run Tasks on
  })
})
