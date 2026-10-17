// W1-B: the app-wide worker cap, Job priority and fairness in slotsToFill, and the dep rule in openDispatch.
import { describe, expect, it } from 'vitest'
import { jobActive, slotsToFill, workersAgainstCap } from './schedule'
import { emptyState, openDispatch, type OrchState } from './state'
import type { Dispatch, Job, JobRun, Task } from './types'

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
const run = (id: string, jobId: string, over: Partial<JobRun> = {}): JobRun => ({
  id,
  jobId,
  ordinal: 1,
  createdAt: T0,
  ...over
})
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
const dispatch = (id: string, taskId: string, over: Partial<Dispatch> = {}): Dispatch =>
  ({
    id,
    taskId,
    provider: 'claude',
    accountId: 'acc_1',
    sessionId: `ses_${id}`,
    cwd: '/p',
    specPath: '/spec',
    startedAt: T0,
    workerState: 'working',
    retained: false,
    ...over
  }) as Dispatch

/** Jobs A, B, C, one run each (r_A …), `n` ready Tasks each (A1, A2 …). */
const three = (n: number, jobs: Partial<Record<'A' | 'B' | 'C', Partial<Job>>> = {}): OrchState => {
  const s = emptyState()
  for (const k of ['A', 'B', 'C'] as const) {
    s.jobs.push(job(k, jobs[k]))
    s.runs.push(run(`r_${k}`, k))
    for (let i = 1; i <= n; i++) s.tasks.push(task(`${k}${i}`, `r_${k}`))
  }
  return s
}
const ids = (s: OrchState, cap?: number | null): string[] =>
  slotsToFill(s, { maxConcurrentWorkers: cap }).map((x) => x.taskId)

describe('slotsToFill — app-wide cap', () => {
  it('no cap keeps the per-Job limits only (the behaviour before the setting)', () => {
    expect(ids(three(5))).toHaveLength(9)
    expect(ids(three(5), null)).toHaveLength(9)
  })

  it('caps the total across three Jobs, spread one per Job', () => {
    const got = ids(three(5), 4)
    expect(got).toHaveLength(4)
    expect(got.slice(0, 3).sort()).toEqual(['A1', 'B1', 'C1'])
  })

  it('never exceeds a Job’s own concurrency under a larger cap', () => {
    const s = three(5, { A: { concurrency: 1 }, B: { concurrency: 1 }, C: { concurrency: 1 } })
    expect(ids(s, 10).sort()).toEqual(['A1', 'B1', 'C1'])
  })

  it('counts open Dispatches, reviews and repairs and coordinator workers included, against the cap', () => {
    const s = three(5)
    // a coordinator-driven Job with one working worker and one open review
    s.jobs.push(job('D', { autoDispatch: undefined }))
    s.runs.push(run('r_D', 'D'))
    s.tasks.push(task('D1', 'r_D', { status: 'dispatched' }), task('D2', 'r_D', { status: 'reviewing' }))
    s.dispatches.push(dispatch('d1', 'D1'), dispatch('d2', 'D2', { repair: undefined }))
    expect(workersAgainstCap(s)).toBe(2)
    expect(ids(s, 3)).toHaveLength(1)
    expect(ids(s, 2)).toEqual([])
  })

  it('does not count paused, pendingStart or archived Jobs, nor a paused run', () => {
    const s = three(1)
    s.tasks.forEach((t) => (t.status = 'dispatched'))
    s.dispatches.push(dispatch('dA', 'A1'), dispatch('dB', 'B1'), dispatch('dC', 'C1'))
    s.jobs.push(job('E'), job('F'), job('G'), job('H'))
    for (const k of ['E', 'F', 'G', 'H']) {
      s.runs.push(run(`r_${k}`, k))
      s.tasks.push(task(`${k}1`, `r_${k}`, { status: 'dispatched' }), task(`${k}2`, `r_${k}`))
      s.dispatches.push(dispatch(`d${k}`, `${k}1`))
    }
    s.jobs.find((j) => j.id === 'E')!.paused = true
    s.jobs.find((j) => j.id === 'F')!.pendingStart = true
    ;(s.jobs.find((j) => j.id === 'G') as Job & { archivedAt?: string }).archivedAt = T0
    s.runs.find((r) => r.id === 'r_H')!.paused = true
    expect(workersAgainstCap(s)).toBe(3)
    // and they get no slots either
    expect(ids(s, 10)).toEqual([])
  })

  it('a closed Dispatch frees its slot', () => {
    const s = three(2)
    s.dispatches.push(dispatch('old', 'A1', { outcome: 'succeeded', endedAt: T0 }))
    expect(workersAgainstCap(s)).toBe(0)
  })
})

describe('slotsToFill — priority and fairness', () => {
  it('a higher priority Job fills first', () => {
    const s = three(5, { C: { priority: 5 }, B: { priority: 1 } })
    expect(ids(s, 4)).toEqual(['C1', 'C2', 'C3', 'B1'])
  })

  it('negative priority goes last', () => {
    const s = three(1, { A: { priority: -1 } })
    expect(ids(s, 2).sort()).toEqual(['B1', 'C1'])
  })

  it('equal priority: the Job with fewer open workers first', () => {
    const s = three(3)
    s.tasks.find((t) => t.id === 'A1')!.status = 'dispatched'
    s.tasks.find((t) => t.id === 'B1')!.status = 'dispatched'
    s.dispatches.push(dispatch('dA', 'A1'), dispatch('dB', 'B1'))
    expect(ids(s, 3)).toEqual(['C1'])
  })

  it('equal priority, cap 1: the Job served longest ago takes the freed slot, so plans take turns', () => {
    const s = three(3)
    // A ran last, B before it, C never
    s.dispatches.push(
      dispatch('a', 'A9', { startedAt: '2026-10-17T02:00:00.000Z', outcome: 'succeeded', endedAt: T0 }),
      dispatch('b', 'B9', { startedAt: '2026-10-17T01:00:00.000Z', outcome: 'succeeded', endedAt: T0 })
    )
    s.tasks.push(task('A9', 'r_A', { status: 'completed' }), task('B9', 'r_B', { status: 'completed' }))
    expect(ids(s, 1)).toEqual(['C1'])
    // C served now: next turn goes to B, not back to A or C
    s.dispatches.push(dispatch('c', 'C9', { startedAt: '2026-10-17T03:00:00.000Z', outcome: 'succeeded', endedAt: T0 }))
    s.tasks.push(task('C9', 'r_C', { status: 'completed' }))
    expect(ids(s, 1)).toEqual(['B1'])
  })
})

describe('slotsToFill — isolation and no double dispatch', () => {
  it('pausing one Job leaves the others dispatching', () => {
    const s = three(2)
    s.jobs.find((j) => j.id === 'B')!.paused = true
    expect(ids(s, 10).sort()).toEqual(['A1', 'A2', 'C1', 'C2'])
    const r = three(2)
    r.runs.find((x) => x.id === 'r_A')!.paused = true
    expect(ids(r, 10).sort()).toEqual(['B1', 'B2', 'C1', 'C2'])
  })

  it('a paused Job’s room goes to the others under the cap', () => {
    const s = three(5, { A: { priority: 9 } })
    s.jobs.find((j) => j.id === 'A')!.paused = true
    expect(ids(s, 2).sort()).toEqual(['B1', 'C1'])
  })

  it('never hands out the same Task twice, and never a Task that already has an open Dispatch', () => {
    const s = three(5)
    s.dispatches.push(dispatch('stray', 'A1')) // a ready Task with an open Dispatch: a broken invariant
    const got = ids(s, null)
    expect(new Set(got).size).toBe(got.length)
    expect(got).not.toContain('A1')
  })

  it('jobActive reads archivedAt (W1-C) as inactive', () => {
    expect(jobActive(job('x'))).toBe(true)
    expect(jobActive({ ...job('x'), archivedAt: T0 } as Job)).toBe(false)
  })
})

describe('deps — only completed releases a dependent', () => {
  const chain = (depStatus: Task['status']): OrchState => {
    const s = emptyState()
    s.jobs.push(job('A'))
    s.runs.push(run('r_A', 'A'))
    s.tasks.push(task('up', 'r_A', { status: depStatus }), task('down', 'r_A', { status: 'pending', deps: ['up'] }))
    return s
  }
  const open = (s: OrchState) =>
    openDispatch(s, { taskId: 'down', provider: 'claude', accountId: 'acc_1', sessionId: 'ses', cwd: '/p', specPath: '/s' }, T0)

  for (const st of ['pending', 'ready', 'dispatched', 'validating', 'reviewing', 'failed', 'blocked'] as const) {
    it(`a dep that is ${st} keeps the dependent from being scheduled or started`, () => {
      const s = chain(st)
      expect(ids(s, null)).not.toContain('down')
      const r = open(s)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('unfinished')
    })
  }

  it('a completed dep lets it start', () => {
    expect(open(chain('completed')).ok).toBe(true)
  })
})
