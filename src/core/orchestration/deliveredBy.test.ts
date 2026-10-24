import { describe, expect, it } from 'vitest'
import { deliveredByLaterPlan, deliveredJobIds, newlyDelivered } from './deliveredBy'
import { emptyState, type OrchState } from './state'
import { FAILURE_LIMIT, type Job, type JobRun, type Task } from './types'

const NOW = '2026-10-24T12:00:00.000Z'
const day = (n: number): string => new Date(Date.parse(NOW) - n * 86_400_000).toISOString()

const job = (id: string, over: Partial<Job> = {}): Job => ({ id, objective: id, cwd: '/repo', projectId: 'p1', createdAt: day(5), ...over })
const run = (id: string, jobId: string, over: Partial<JobRun> = {}): JobRun => ({
  id,
  jobId,
  ordinal: 1,
  createdAt: day(5),
  worktree: `/wt/${id}`,
  ...over
})
const task = (id: string, runId: string, status: Task['status']): Task => ({
  id,
  runId,
  title: id,
  spec: '',
  deps: [],
  status,
  consecutiveFailures: status === 'failed' ? FAILURE_LIMIT : 0,
  createdAt: day(5),
  updatedAt: day(5)
})

/** `early` failed (a Task failed), `late` was delivered with a push at sha `abc`. */
const state = (over: Partial<OrchState> = {}): OrchState => ({
  ...emptyState(),
  projects: [{ id: 'p1', path: '/repo', name: 'r', addedAt: day(30) }],
  jobs: [job('early', { createdAt: day(5) }), job('late', { createdAt: day(2) })],
  runs: [
    run('r-early', 'early'),
    run('r-late', 'late', { delivery: { at: day(1), branch: 'main', sha: 'abc' }, deliveryState: { state: 'delivered', attempts: 1 } })
  ],
  tasks: [task('e1', 'r-early', 'completed'), task('e2', 'r-early', 'failed'), task('l1', 'r-late', 'completed')],
  ...over
})

describe('deliveredByLaterPlan', () => {
  it('marks an earlier failed plan whose run branch is in the delivered commit, and records who delivered it', async () => {
    const seen: string[] = []
    const marks = await deliveredByLaterPlan(state(), 'late', async (earlier, later) => {
      seen.push(`${earlier.id}<${later.id}`)
      return true
    }, NOW)
    expect(seen).toEqual(['r-early<r-late'])
    expect(marks).toEqual([{ jobId: 'early', deliveredBy: { jobId: 'late', at: NOW, commit: 'abc' } }])
  })

  it('leaves a plan whose branch is not in the delivered commit', async () => {
    expect(await deliveredByLaterPlan(state(), 'late', async () => false, NOW)).toEqual([])
  })

  it('does not ask git when nothing is a candidate', async () => {
    const s = state({ runs: [run('r-early', 'early', { deliveryState: { state: 'delivered', attempts: 1 } }), state().runs[1]] })
    let asked = 0
    const never = async (): Promise<boolean> => (asked++, true)
    expect(await deliveredByLaterPlan(s, 'late', never, NOW)).toEqual([])
    // a delivery that is not delivered yet marks nothing
    const undone = state({ runs: [state().runs[0], run('r-late', 'late', { deliveryState: { state: 'retrying', attempts: 1 } })] })
    expect(await deliveredByLaterPlan(undone, 'late', never, NOW)).toEqual([])
    expect(asked).toBe(0)
  })

  it('skips a plan of another project, an archived, running, older-than-30-days or already marked one', async () => {
    const s = state({
      projects: [...state().projects, { id: 'p2', path: '/other', name: 'o', addedAt: day(30) }],
      jobs: [
        job('late', { createdAt: day(2) }),
        job('other', { projectId: 'p2', cwd: '/other' }),
        job('archived', { archivedAt: day(1) }),
        job('running'),
        job('old', { createdAt: day(40) }),
        job('marked', { deliveredBy: { jobId: 'x', at: day(3) } }),
        job('newer', { createdAt: day(1) })
      ],
      runs: [
        state().runs[1],
        ...['other', 'archived', 'running', 'old', 'marked', 'newer'].map((j) => run(`r-${j}`, j))
      ],
      tasks: [
        task('l1', 'r-late', 'completed'),
        task('o1', 'r-other', 'failed'),
        task('a1', 'r-archived', 'failed'),
        task('n1', 'r-running', 'dispatched'),
        task('d1', 'r-old', 'failed'),
        task('m1', 'r-marked', 'failed'),
        task('w1', 'r-newer', 'failed')
      ]
    })
    expect(await deliveredByLaterPlan(s, 'late', async () => true, NOW)).toEqual([])
  })

  it('also marks a plan that finished but was never delivered, and one whose delivery was dismissed', async () => {
    const s = state({
      jobs: [job('early'), job('dismissed'), job('late', { createdAt: day(2) })],
      runs: [
        run('r-early', 'early'),
        run('r-dismissed', 'dismissed', { deliveryState: { state: 'dismissed', attempts: 2 } }),
        state().runs[1]
      ],
      tasks: [task('e1', 'r-early', 'completed'), task('x1', 'r-dismissed', 'completed'), task('l1', 'r-late', 'completed')]
    })
    const marks = await deliveredByLaterPlan(s, 'late', async () => true, NOW)
    expect(marks.map((m) => m.jobId).sort()).toEqual(['dismissed', 'early'])
  })

  it('skips a plan that made no work (no completed Task) and a plan with no worktree', async () => {
    const s = state({
      jobs: [job('empty'), job('bare'), job('late', { createdAt: day(2) })],
      runs: [run('r-empty', 'empty'), run('r-bare', 'bare', { worktree: undefined }), state().runs[1]],
      tasks: [task('x1', 'r-empty', 'failed'), task('b1', 'r-bare', 'completed'), task('l1', 'r-late', 'completed')]
    })
    expect(await deliveredByLaterPlan(s, 'late', async () => true, NOW)).toEqual([])
  })

  it('treats a git failure as not delivered and still checks the others', async () => {
    const s = state({
      jobs: [job('a'), job('b'), job('late', { createdAt: day(2) })],
      runs: [run('r-a', 'a'), run('r-b', 'b'), state().runs[1]],
      tasks: [task('a1', 'r-a', 'failed'), task('a2', 'r-a', 'completed'), task('b1', 'r-b', 'failed'), task('b2', 'r-b', 'completed'), task('l1', 'r-late', 'completed')]
    })
    const marks = await deliveredByLaterPlan(s, 'late', async (earlier) => {
      if (earlier.id === 'r-a') throw new Error('git is gone')
      return true
    }, NOW)
    expect(marks.map((m) => m.jobId)).toEqual(['b'])
  })
})

describe('newlyDelivered', () => {
  it('names the plans whose delivery landed in this commit', () => {
    const before = state({ runs: [state().runs[0], run('r-late', 'late', { deliveryState: { state: 'delivering', attempts: 1 } })] })
    expect(newlyDelivered(before, state())).toEqual(['late'])
    expect(newlyDelivered(state(), state())).toEqual([])
  })
})

describe('deliveredJobIds', () => {
  it('lists the plans delivered in the last 30 days (the Host-start sweep)', () => {
    expect(deliveredJobIds(state(), NOW)).toEqual(['late'])
    expect(deliveredJobIds(state({ jobs: [job('early'), job('late', { createdAt: day(40) })] }), NOW)).toEqual([])
  })
})
