import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { coordinatorOf, stateOf, waveOfPlan } from './coordinator'

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: id, status: 'pending', openGates: 0, ...over })
const row = (id: string, over: Partial<JobRow> = {}): JobRow => ({
  id, objective: `plan ${id}`, outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: [], ...over
})

describe('coordinatorOf', () => {
  it('keeps live plans only: not archived, not a schedule or rounds card, not completed', () => {
    const cards = coordinatorOf([
      row('run'),
      row('done', { outcome: 'completed' }),
      row('arch', { archivedAt: 'x' }),
      row('sched', { schedule: { kind: 'interval', everyMs: 60_000 } as never }),
      row('rounds', { children: [row('kid')] }),
      row('fail', { outcome: 'failed' }),
      row('pend', { pendingStart: true, outcome: 'completed' })
    ])
    expect(cards.map((c) => c.id)).toEqual(['run', 'fail', 'pend'])
  })

  it('says what a plan waits on: a lease or files of another plan, once per plan, its queue and its overlaps', () => {
    const same = (id: string, delivery: boolean): JobTask['board'] => ({
      category: 'queued',
      reason: { kind: 'same-files', waitingOn: { id: 't', title: 't' }, path: 'src/a.ts', plan: { id, title: `plan ${id}` }, ...(delivery ? { delivery: true as const } : {}) }
    })
    const [c] = coordinatorOf([
      row('a', {
        tasks: [task('1', { board: same('b', true) }), task('2', { board: same('b', false) }), task('3', { board: same('c', false) })]
      }),
      row('b'),
      row('c')
    ])
    expect(c.waits).toEqual([
      { kind: 'lease', planId: 'b', plan: 'plan b', path: 'src/a.ts' },
      { kind: 'files', planId: 'c', plan: 'plan c', path: 'src/a.ts' }
    ])
    const [q] = coordinatorOf([row('q', { pendingStart: true, after: 'b', overlapPlans: ['b'] }), row('b')])
    expect(q.after).toEqual({ id: 'b', plan: 'plan b' })
    expect(q.overlaps).toEqual([{ id: 'b', plan: 'plan b' }])
    expect(q.decide).toBe(true)
  })

  it('counts workers working now', () => {
    const [c] = coordinatorOf([row('a', { tasks: [task('1', { status: 'dispatched', startedAt: 'x' }), task('2', { status: 'reviewing' }), task('3', { status: 'dispatched' })] })])
    expect(c.working).toBe(2)
  })
})

describe('waveOfPlan', () => {
  it('is the first wave with work left, over the wave count; the last when all is done; null with no Tasks', () => {
    expect(waveOfPlan([])).toBeNull()
    expect(waveOfPlan([task('a', { status: 'completed' }), task('b', { wave: 1 }), task('c', { wave: 2 })])).toEqual({ n: 2, m: 3 })
    expect(waveOfPlan([task('a', { status: 'completed' }), task('b', { wave: 1, status: 'completed' })])).toEqual({ n: 2, m: 2 })
  })
})

describe('stateOf', () => {
  it('words the plan: queued, approval, planning, paused, failed, needs you, running', () => {
    expect(stateOf(row('a', { pendingStart: true, after: 'b' }))).toBe('queued')
    expect(stateOf(row('a', { pendingStart: true }))).toBe('approval')
    expect(stateOf(row('a', { pendingStart: true, planned: true }))).toBe('planning')
    expect(stateOf(row('a', { dispatchHold: true }))).toBe('paused')
    expect(stateOf(row('a', { outcome: 'failed' }))).toBe('failed')
    expect(stateOf(row('a', { tasks: [task('g', { status: 'blocked', gate: { id: 'g', question: 'q' } })] }))).toBe('needs-you')
    expect(stateOf(row('a', { tasks: [task('w', { status: 'dispatched', startedAt: 'x' })] }))).toBe('running')
  })
})
