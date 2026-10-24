import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { finishedAgeOf, finishedDateOf, mainPlanViewOf, shownPlans } from './mainPlanView'

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: id, status: 'pending', openGates: 0, ...over })
const done = (id: string): JobTask => task(id, { status: 'completed', board: { category: 'done' } })
const row = (id: string, over: Partial<JobRow> = {}): JobRow => ({
  id, objective: id, title: id, outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: [], ...over
})

describe('mainPlanViewOf', () => {
  it('lists running plans oldest first, a queued plan right behind its predecessor, and leaves out archived ones', () => {
    const v = mainPlanViewOf([
      row('c', { createdAt: '2026-01-03' }),
      row('b', { createdAt: '2026-01-02', after: 'c' }),
      row('a', { createdAt: '2026-01-01' }),
      row('old', { createdAt: '2025-01-01', archivedAt: '2025-02-01' })
    ])
    expect(v.plans.map((p) => p.row.id)).toEqual(['a', 'c', 'b'])
  })

  it('orders needs-you, running, waiting, then done plans by finishedAt newest first, a queued plan behind its predecessor', () => {
    const fin = (id: string, finishedAt?: string): JobRow => row(id, { outcome: 'completed', done: 1, total: 1, createdAt: '2026-01-01', ...(finishedAt ? { finishedAt } : {}) })
    const v = mainPlanViewOf([
      fin('old', '2026-02-01T00:00:00Z'),
      fin('new', '2026-03-01T00:00:00Z'),
      row('q', { createdAt: '2026-01-03', after: 'w', paused: true }),
      row('w', { createdAt: '2026-01-02', paused: true }),
      row('run', { createdAt: '2026-01-04' }),
      row('need', { createdAt: '2026-01-05', tasks: [task('b', { status: 'blocked' })] })
    ])
    expect(v.plans.map((p) => p.row.id)).toEqual(['need', 'run', 'w', 'q', 'new', 'old'])
  })

  it('counts done Tasks over all Tasks of all plans', () => {
    const v = mainPlanViewOf([row('a', { tasks: [done('a1'), task('a2')] }), row('b', { tasks: [done('b1')] })])
    expect([v.done, v.total]).toEqual([2, 3])
  })

  it('says what a Task waits for on another plan', () => {
    const auth = row('auth', { title: 'Auth rework', createdAt: '1', tasks: [done('t1')] })
    const ui = row('ui', {
      title: 'UI redesign',
      createdAt: '2',
      tasks: [
        task('w', { title: 'Add login', board: { category: 'queued', reason: { kind: 'deps', waitingOn: [{ id: 't1', title: 'Login API', status: 'completed' }] } } }),
        task('s', { board: { category: 'queued', reason: { kind: 'same-files', path: 'x', waitingOn: { id: 't1', title: 'Top bar' }, plan: { id: 'auth', title: 'Auth rework' } } } }),
        task('l', { board: { category: 'queued', reason: { kind: 'same-files', path: 'x', waitingOn: { id: 't1', title: 'Top bar' }, plan: { id: 'auth', title: 'Auth rework' }, delivery: true } } }),
        task('v', { board: { category: 'queued', reason: { kind: 'deps', waitingOn: [{ id: 't1', title: 'Login API', status: 'completed', delivery: true }] } } }),
        task('d', {
          status: 'blocked',
          gate: { id: 'g', options: ['cancel as duplicate', 'keep both'], question: 'Duplicate? "Menu" (plan UI redesign) repeats "Nav" of plan Auth rework (same files). Cancel?' }
        }),
        task('own', { board: { category: 'queued', reason: { kind: 'deps', waitingOn: [{ id: 'own2', title: 'Mine', status: 'pending' }] } } })
      ]
    })
    const lines = mainPlanViewOf([auth, ui]).plans.find((p) => p.row.id === 'ui')!.tasks.map((m) => m.wait)
    expect(lines).toEqual([
      { key: 'pages.plans.main.waits', params: { plan: 'Auth rework', task: 'Login API' } },
      { key: 'pages.plans.main.sameFiles', params: { plan: 'Auth rework', task: 'Top bar' } },
      { key: 'pages.plans.main.sameFilesDeliver', params: { plan: 'Auth rework', task: 'Top bar' } },
      { key: 'pages.plans.main.waitsDeliver', params: { plan: 'Auth rework', task: 'Login API' } },
      { key: 'pages.plans.main.duplicate', params: { plan: 'Auth rework', task: 'Nav' } },
      undefined
    ])
  })

  it('says how a plan delivery check stands', () => {
    const v = mainPlanViewOf([
      row('a', { title: 'Auth rework', createdAt: '1' }),
      row('b', { createdAt: '2', delivery: { runId: 'b', state: 'delivering', waitingFor: { jobId: 'a', escalated: 'x' } } }),
      row('f', { createdAt: '6', delivery: { runId: 'f', state: 'pending', waitingFor: { jobId: 'a' } } }),
      row('c', { createdAt: '3', delivery: { runId: 'c', state: 'failed' } }),
      row('c2', { createdAt: '3.5', delivery: { runId: 'c2', state: 'failed', reason: 'main moved on' } }),
      row('d', { createdAt: '4', outcome: 'checking' }),
      row('e', { createdAt: '5' })
    ])
    expect(v.plans.map((p) => p.checks)).toEqual([
      undefined,
      { key: 'pages.plans.main.checksWaitTold', params: { plan: 'Auth rework' } },
      { key: 'pages.plans.main.checksFailed', failed: true },
      { key: 'pages.plans.main.checksFailedWhy', params: { reason: 'main moved on' }, failed: true },
      { key: 'pages.plans.main.checksRunning' },
      undefined,
      { key: 'pages.plans.main.checksWait', params: { plan: 'Auth rework' } }
    ])
  })

  it('names an untitled plan by a short summary of its objective, never a mid-word cut', () => {
    const v = mainPlanViewOf([row('a', { title: undefined, objective: 'aslo what i realize is that in the tasks there is alot of repetition of the same affected Tasks' })])
    expect(v.plans[0].name).toBe('aslo what i realize is that in the tasks there is alot of…')
  })

  it('sorts each plan into needs you, running, waiting or done, and counts the plans of each for the header', () => {
    const v = mainPlanViewOf([
      row('run', { createdAt: '1', tasks: [task('r1', { status: 'dispatched', board: { category: 'running' } })] }),
      row('ask', { createdAt: '2', tasks: [task('q1', { status: 'blocked', gate: { id: 'g', question: 'Which?' } })] }),
      // paused, yet a Task waits on the owner: needs you wins
      row('pausedAsk', { createdAt: '3', paused: true, tasks: [task('q2', { status: 'blocked', gate: { id: 'g2', question: 'Which?' } })] }),
      row('paused', { createdAt: '4', paused: true, tasks: [task('w1')] }),
      row('fin', { createdAt: '5', outcome: 'completed', done: 1, total: 1, tasks: [done('f1')] }),
      row('failed', { createdAt: '6', outcome: 'failed', tasks: [done('x1')] })
    ])
    expect(Object.fromEntries(v.plans.map((p) => [p.row.id, p.phase]))).toEqual({
      run: 'running',
      ask: 'needs',
      pausedAsk: 'needs',
      paused: 'waiting',
      fin: 'done',
      failed: 'needs'
    })
    expect(v.counts).toEqual({ needs: 3, running: 1, waiting: 1, done: 1 })
  })

  it('opens the plans at work or waiting and folds the finished ones to one row', () => {
    const v = mainPlanViewOf([
      row('run', { createdAt: '1', tasks: [task('r1', { status: 'dispatched', board: { category: 'running' } })] }),
      row('paused', { createdAt: '2', paused: true, tasks: [task('w1')] }),
      row('fin', { createdAt: '3', outcome: 'completed', tasks: [done('f1')] })
    ])
    expect(v.plans.map((p) => p.open)).toEqual([true, true, false])
  })

  it('sums up a finished plan: its Task count, the delivered commit short and when', () => {
    const v = mainPlanViewOf([
      row('fin', {
        createdAt: '2026-10-01T08:00:00.000Z',
        outcome: 'completed',
        done: 2,
        total: 2,
        pr: { at: '2026-10-02T09:00:00.000Z', attributed: 'caaea2cc1234567890', attributedAt: '2026-10-03T10:00:00.000Z' },
        tasks: [done('f1'), done('f2')]
      }),
      // no merge commit: the last commit a Task added, and the plan's last activity
      row('push', {
        createdAt: '2026-10-04T08:00:00.000Z',
        outcome: 'completed',
        done: 1,
        total: 1,
        tasks: [{ ...done('p1'), links: { commits: ['aaaaaaa111', 'bbbbbbb222'] } }]
      }),
      row('run', { createdAt: '2026-10-05T08:00:00.000Z', tasks: [task('r1')] })
    ])
    expect(v.plans.map((p) => p.finished)).toEqual([
      undefined,
      { tasks: 1, commit: 'bbbbbbb', at: Date.parse('2026-10-04T08:00:00.000Z') },
      { tasks: 2, commit: 'caaea2c', at: Date.parse('2026-10-03T10:00:00.000Z') }
    ])
    // the row's own finishedAt wins over the PR proxy
    const w = mainPlanViewOf([row('x', { outcome: 'completed', finishedAt: '2026-10-09T00:00:00.000Z', pr: { at: '1', attributed: 'abc1234', attributedAt: '2026-10-03T10:00:00.000Z' }, tasks: [done('x1')] })])
    expect(w.plans[0].finished?.at).toBe(Date.parse('2026-10-09T00:00:00.000Z'))
  })

  it('hides the done plans when asked, keeping the order', () => {
    const v = mainPlanViewOf([
      row('a', { createdAt: '1', outcome: 'completed', tasks: [done('a1')] }),
      row('b', { createdAt: '2', tasks: [task('b1')] }),
      row('c', { createdAt: '3', outcome: 'completed', tasks: [done('c1')] })
    ])
    expect(shownPlans(v, false).map((p) => p.row.id)).toEqual(['b', 'c', 'a'])
    expect(shownPlans(v, true).map((p) => p.row.id)).toEqual(['b'])
  })
})

describe('finishedDateOf', () => {
  // local-time constructors, so the date does not shift with the machine's zone
  const now = new Date(2026, 9, 24).getTime()

  it('shows month and day for a finish in the current year', () => {
    expect(finishedDateOf(new Date(2026, 9, 3, 10).getTime(), now, 'en-US')).toBe('Oct 3')
  })

  it('adds the year for a finish in another year', () => {
    expect(finishedDateOf(new Date(2025, 2, 4, 9).getTime(), now, 'en-US')).toBe('Mar 4, 2025')
  })
})


describe('finishedAgeOf', () => {
  it('is short: minutes, hours, days', () => {
    const now = Date.parse('2026-10-24T12:00:00Z')
    expect(['2026-10-24T11:59:50Z', '2026-10-24T11:55:00Z', '2026-10-24T09:00:00Z', '2026-10-21T12:00:00Z'].map((t) => finishedAgeOf(Date.parse(t), now))).toEqual(['<1m', '5m', '3h', '3d'])
  })
})
