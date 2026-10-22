import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { mainPlanViewOf } from './mainPlanView'

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: id, status: 'pending', openGates: 0, ...over })
const done = (id: string): JobTask => task(id, { status: 'completed', board: { category: 'done' } })
const row = (id: string, over: Partial<JobRow> = {}): JobRow => ({
  id, objective: id, title: id, outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: [], ...over
})

describe('mainPlanViewOf', () => {
  it('lists plans oldest first, a queued plan right behind its predecessor, and leaves out archived ones', () => {
    const v = mainPlanViewOf([
      row('c', { createdAt: '2026-01-03' }),
      row('b', { createdAt: '2026-01-02', after: 'c' }),
      row('a', { createdAt: '2026-01-01' }),
      row('old', { createdAt: '2025-01-01', archivedAt: '2025-02-01' })
    ])
    expect(v.plans.map((p) => p.row.id)).toEqual(['a', 'c', 'b'])
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
        task('d', {
          status: 'blocked',
          gate: { id: 'g', options: ['cancel as duplicate', 'keep both'], question: 'Duplicate? "Menu" (plan UI redesign) repeats "Nav" of plan Auth rework (same files). Cancel?' }
        }),
        task('own', { board: { category: 'queued', reason: { kind: 'deps', waitingOn: [{ id: 'own2', title: 'Mine', status: 'pending' }] } } })
      ]
    })
    const lines = mainPlanViewOf([auth, ui]).plans[1].tasks.map((m) => m.wait)
    expect(lines).toEqual([
      { key: 'pages.plans.main.waits', params: { plan: 'Auth rework', task: 'Login API' } },
      { key: 'pages.plans.main.sameFiles', params: { plan: 'Auth rework', task: 'Top bar' } },
      { key: 'pages.plans.main.sameFilesDeliver', params: { plan: 'Auth rework', task: 'Top bar' } },
      { key: 'pages.plans.main.duplicate', params: { plan: 'Auth rework', task: 'Nav' } },
      undefined
    ])
  })

  it('says how a plan delivery check stands', () => {
    const v = mainPlanViewOf([
      row('a', { title: 'Auth rework', createdAt: '1' }),
      row('b', { createdAt: '2', delivery: { runId: 'b', state: 'delivering', waitingFor: { jobId: 'a', escalated: 'x' } } as JobRow['delivery'] }),
      row('c', { createdAt: '3', delivery: { runId: 'c', state: 'failed' } }),
      row('d', { createdAt: '4', outcome: 'checking' }),
      row('e', { createdAt: '5' })
    ])
    expect(v.plans.map((p) => p.checks)).toEqual([
      undefined,
      { key: 'pages.plans.main.checksWaitTold', params: { plan: 'Auth rework' } },
      { key: 'pages.plans.main.checksFailed' },
      { key: 'pages.plans.main.checksRunning' },
      undefined
    ])
  })
})
