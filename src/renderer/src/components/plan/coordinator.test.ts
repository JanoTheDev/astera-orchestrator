import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { coordinatorOf } from './coordinator'

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: id, status: 'pending', openGates: 0, ...over })
const row = (id: string, over: Partial<JobRow> = {}): JobRow => ({
  id, objective: `plan ${id}`, outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: [], ...over
})

describe('coordinatorOf', () => {
  it('lists only live plans: not archived, not finished, not a schedule template', () => {
    const cards = coordinatorOf([
      row('a'),
      row('b', { archivedAt: 'x' }),
      row('c', { outcome: 'completed' }),
      row('d', { schedule: { kind: 'daily', at: '09:00' } as never })
    ])
    expect(cards.map((c) => c.id)).toEqual(['a'])
  })

  it('gives each card its state, wave, running workers and what it waits on', () => {
    const lease = { kind: 'same-files' as const, waitingOn: { id: 't9', title: 'T9' }, path: 'src/api.ts', plan: { id: 'b', title: 'old name' } }
    const [a, b, q] = coordinatorOf([
      row('a', {
        wave: { at: 2, of: 3 },
        tasks: [
          task('w', { status: 'dispatched', startedAt: '2026-01-01T00:00:00Z' }),
          task('x', { board: { category: 'queued', reason: lease } }),
          task('y', { board: { category: 'queued', reason: lease } })
        ]
      }),
      row('b', { overlapPlans: ['a'], overlaps: ['src/api.ts: T9 and T3'] }),
      row('q', { pendingStart: true, after: 'b', tasks: [task('p', { board: { category: 'queued', reason: { kind: 'pending-start', after: { id: 'b', title: 'plan b' } } } })] })
    ])
    expect(a).toMatchObject({ name: 'plan a', wave: { at: 2, of: 3 }, workers: 1, status: { key: 'pages.plans.status.working' } })
    // a lease is named once, by the plan's current name
    expect(a.waits).toEqual([{ kind: 'lease', plan: 'plan b', path: 'src/api.ts' }])
    expect(b.waits).toEqual([{ kind: 'overlap', plan: 'plan a', lines: ['src/api.ts: T9 and T3'] }])
    // queued after b: once, from the reason and the row alike
    expect(q.waits).toEqual([{ kind: 'after', plan: 'plan b' }])
  })

  it('counts a delivery lease without a plan, a stopped queue, and overlap lines with no plan named', () => {
    const [a] = coordinatorOf([
      row('a', {
        overlaps: ['one line'],
        tasks: [
          task('x', { board: { category: 'queued', reason: { kind: 'same-files', waitingOn: { id: 't1', title: 'T1' }, path: 'p', delivery: true } } }),
          task('y', { board: { category: 'queued', reason: { kind: 'pending-start', after: { id: 'z', title: 'Gone', stopped: true } } } })
        ]
      })
    ])
    expect(a.waits).toEqual([
      { kind: 'lease', plan: 'T1', path: 'p' },
      { kind: 'after', plan: 'Gone', stopped: true },
      { kind: 'overlap', lines: ['one line'] }
    ])
  })

  it('is empty with no live plan (the strip hides)', () => {
    expect(coordinatorOf([row('a', { outcome: 'failed' })])).toEqual([])
  })
})
