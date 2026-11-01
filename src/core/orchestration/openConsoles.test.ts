import { describe, it, expect } from 'vitest'
import { openConsolesOf, AWAITING_RETRY_MS, PERSON_INPUT_KEEPS_MS, type ConsoleReason } from './openConsoles'
import type { OrchState } from './state'
import type { Dispatch, Gate, Task } from './types'

const NOW = '2026-10-31T00:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const task = (id: string, status: Task['status'], over: Partial<Task> = {}): Task =>
  ({ id, runId: 'r1', title: id, spec: '', deps: [], status, consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over }) as Task
const dsp = (id: string, taskId: string, sessionId: string, over: Partial<Dispatch> = {}): Dispatch =>
  ({ id, taskId, sessionId, cwd: '/wt', provider: 'claude', accountId: 'a', specPath: '', startedAt: NOW, endedAt: NOW, outcome: 'succeeded', workerState: 'stopped', retained: false, ...over }) as Dispatch
const open = { endedAt: undefined, outcome: undefined, workerState: 'ready' } as const
const gate = (taskId: string): Gate => ({ id: `g_${taskId}`, runId: 'r1', taskId, question: 'q', status: 'open', createdAt: NOW }) as Gate

const state = (tasks: Task[], dispatches: Dispatch[], gates: Gate[] = [], run: object = {}, job: object = {}): Parameters<typeof openConsolesOf>[0] =>
  ({
    jobs: [{ id: 'j1', cwd: '/p', ...job }],
    runs: [{ id: 'r1', jobId: 'j1', ordinal: 1, ...run }],
    tasks,
    dispatches,
    gates
  }) as unknown as Parameters<typeof openConsolesOf>[0]
const alive = () => true
const reasons = (s: ReturnType<typeof state>, facts = {}): Record<string, ConsoleReason> =>
  Object.fromEntries(openConsolesOf(s, 'r1', alive, { nowMs: NOW_MS, ...facts }).map((c) => [c.sessionId, c.reason]))

describe('openConsolesOf', () => {
  it('working: a worker whose attempt is open, or whose Task is still dispatched', () => {
    const s = state([task('t1', 'dispatched'), task('t2', 'dispatched')], [dsp('d1', 't1', 'w1', open), dsp('d2', 't2', 'w2')])
    expect(reasons(s)).toEqual({ w1: 'working', w2: 'working' })
  })

  it('reviewing: a reviewer at work, and a worker kept for repair while its Task validates or reviews', () => {
    const s = state(
      [task('t1', 'reviewing'), task('t2', 'validating')],
      [dsp('d1', 't1', 'rev', { ...open, review: true }), dsp('d2', 't2', 'w2')]
    )
    expect(reasons(s)).toEqual({ rev: 'reviewing', w2: 'reviewing' })
  })

  it('waiting-for-answer: a Task with an open Gate', () => {
    expect(reasons(state([task('t1', 'blocked')], [dsp('d1', 't1', 'w1')], [gate('t1')]))).toEqual({ w1: 'waiting-for-answer' })
  })

  it('retained: a worker a person asked to keep', () => {
    expect(reasons(state([task('t1', 'completed')], [dsp('d1', 't1', 'w1', { retained: true })]))).toEqual({ w1: 'retained' })
  })

  it('person-typed: typed into within 10 minutes, not after', () => {
    const s = state([task('t1', 'completed')], [dsp('d1', 't1', 'w1')])
    expect(reasons(s, { typedAt: () => NOW_MS - PERSON_INPUT_KEEPS_MS + 1 })).toEqual({ w1: 'person-typed' })
    expect(reasons(s, { typedAt: () => NOW_MS - PERSON_INPUT_KEEPS_MS })).toEqual({ w1: 'none' })
  })

  it('awaiting-retry: a failed Task, until the window runs out', () => {
    const s = state([task('t1', 'failed')], [dsp('d1', 't1', 'w1', { outcome: 'failed', endedAt: NOW })])
    expect(reasons(s)).toEqual({ w1: 'awaiting-retry' })
    expect(reasons(s, { nowMs: NOW_MS + AWAITING_RETRY_MS })).toEqual({ w1: 'none' })
  })

  it('closing: a release is under way, before every other reason', () => {
    const s = state([task('t1', 'completed')], [dsp('d1', 't1', 'w1', { retained: true })])
    expect(reasons(s, { closing: (id: string) => id === 'w1' })).toEqual({ w1: 'closing' })
  })

  it('none: a completed worker, a reviewer with its verdict, an old attempt of a retried Task', () => {
    const s = state(
      [task('t1', 'completed'), task('t2', 'reviewing'), task('t3', 'dispatched')],
      [dsp('d1', 't1', 'w1'), dsp('d2', 't2', 'rev', { review: true }), dsp('d3', 't3', 'old', { outcome: 'failed' }), dsp('d4', 't3', 'new', open)]
    )
    expect(reasons(s)).toEqual({ w1: 'none', rev: 'none', old: 'none', new: 'working' })
  })

  it('skips a session that is not alive, a pending start and one a later Dispatch took over', () => {
    const s = state([task('t1', 'dispatched')], [dsp('d1', 't1', 'gone'), dsp('d2', 't1', 'w2'), dsp('d3', 't1', 'w2', open), dsp('d4', 't1', 'pending:ab', open)])
    const got = openConsolesOf(s, 'r1', (id) => id !== 'gone', { nowMs: NOW_MS })
    expect(got.map((c) => [c.sessionId, c.dispatchId])).toEqual([['w2', 'd3']])
  })

  it('names the role: worker, reviewer, merge (a Task with a parent), coordinator and planner', () => {
    const s = state(
      [task('t1', 'dispatched'), task('t2', 'dispatched'), task('tm', 'dispatched', { parentId: 't1' })],
      [dsp('d1', 't1', 'w1', open), dsp('d2', 't2', 'rev', { ...open, review: true }), dsp('d3', 'tm', 'mrg', open)],
      [],
      { coordinatorSessionId: 'coord' },
      { plannerSessionIds: ['old-planner', 'planner'], pendingStart: true }
    )
    expect(openConsolesOf(s, 'r1', alive, { nowMs: NOW_MS }).map((c) => [c.sessionId, c.role, c.reason])).toEqual([
      ['w1', 'worker', 'working'],
      ['rev', 'reviewer', 'reviewing'],
      ['mrg', 'merge', 'working'],
      ['coord', 'coordinator', 'working'],
      ['planner', 'planner', 'working']
    ])
  })
})
