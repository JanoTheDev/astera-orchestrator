import { describe, it, expect } from 'vitest'
import { sessionsDoneWith } from './finishedSessions'
import type { OrchState } from './state'
import type { Dispatch, Gate, Task } from './types'

const NOW = '2026-10-19T00:00:00.000Z'
const task = (id: string, status: Task['status']): Task =>
  ({ id, runId: 'r1', title: id, spec: '', deps: [], status, consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW }) as Task
const dsp = (id: string, taskId: string, sessionId: string, over: Partial<Dispatch> = {}): Dispatch =>
  ({ id, taskId, sessionId, cwd: '/wt-own', provider: 'claude', accountId: 'a', specPath: '', startedAt: NOW, endedAt: NOW, outcome: 'succeeded', workerState: 'stopped', ...over }) as Dispatch
const state = (tasks: Task[], dispatches: Dispatch[], gates: Gate[] = []): Parameters<typeof sessionsDoneWith>[0] =>
  ({
    jobs: [{ id: 'j1', cwd: '/p' }],
    runs: [{ id: 'r1', jobId: 'j1', ordinal: 1, worktree: '/run-wt' }],
    tasks,
    dispatches,
    gates
  }) as unknown as Pick<OrchState, 'runs' | 'jobs' | 'tasks' | 'dispatches' | 'gates'>
const ids = (s: ReturnType<typeof state>): string[] => sessionsDoneWith(s).map((d) => d.id)

describe('sessionsDoneWith', () => {
  it('includes a completed worker that is not merged yet', () => {
    expect(ids(state([task('t1', 'completed')], [dsp('d1', 't1', 'w1')]))).toEqual(['d1'])
  })

  it('includes a finished worker whose Task is merging into the plan branch, but not one a merge Gate stopped', () => {
    expect(ids(state([task('t1', 'merging')], [dsp('d1', 't1', 'w1')]))).toEqual(['d1'])
    const gate = { id: 'g1', runId: 'r1', taskId: 't1', question: 'q', status: 'open', createdAt: NOW } as Gate
    expect(ids(state([task('t1', 'merging')], [dsp('d1', 't1', 'w1')], [gate]))).toEqual([])
  })

  it('keeps a retained worker, a failed Task, an open Gate, a live dispatch and a Task still running', () => {
    const s = state(
      [task('t1', 'completed'), task('t2', 'failed'), task('t3', 'completed'), task('t4', 'completed'), task('t5', 'dispatched')],
      [
        dsp('d1', 't1', 'w1', { retained: true }),
        dsp('d2', 't2', 'w2', { outcome: 'failed' }),
        dsp('d3', 't3', 'w3'),
        dsp('d4', 't4', 'w4', { endedAt: undefined, outcome: undefined }),
        dsp('d5', 't5', 'w5')
      ],
      [{ id: 'g1', runId: 'r1', taskId: 't3', question: 'q', status: 'open', createdAt: NOW } as Gate]
    )
    expect(ids(s)).toEqual([])
  })

  it('includes a reviewer with a recorded verdict while the Task is still reviewing', () => {
    expect(ids(state([task('t1', 'reviewing')], [dsp('d1', 't1', 'rev', { review: true })]))).toEqual(['d1'])
  })

  it('keeps a session a later attempt reuses', () => {
    expect(ids(state([task('t1', 'completed')], [dsp('d1', 't1', 'w1'), dsp('d2', 't1', 'w1', { endedAt: undefined, outcome: undefined })]))).toEqual([])
  })

  describe('an earlier attempt of a retried Task (T13)', () => {
    const retried = (over: Partial<Dispatch> = {}, status: Task['status'] = 'dispatched') =>
      state([task('t1', status)], [dsp('d1', 't1', 'w1', { outcome: 'failed', ...over }), dsp('d2', 't1', 'w2', { endedAt: undefined, outcome: undefined })])

    it('is done with once the new attempt has opened, even while the Task runs again', () => {
      expect(ids(retried())).toEqual(['d1'])
    })

    it('is done with when the new attempt is a pending start, and when the Task failed again', () => {
      const s = state([task('t1', 'failed')], [dsp('d1', 't1', 'w1', { outcome: 'failed' }), dsp('d2', 't1', 'pending:ab12', { endedAt: undefined, outcome: undefined })])
      expect(ids(s)).toEqual(['d1'])
      const again = state([task('t1', 'failed')], [dsp('d1', 't1', 'w1', { outcome: 'failed' }), dsp('d2', 't1', 'w2', { outcome: 'failed' })])
      expect(ids(again)).toEqual(['d1'])
    })

    it('keeps a retained old attempt, and one a new attempt took the session of (a same-session repair)', () => {
      expect(ids(retried({ retained: true }))).toEqual([])
      const reused = state([task('t1', 'dispatched')], [dsp('d1', 't1', 'w1', { outcome: 'failed' }), dsp('d2', 't1', 'w1', { endedAt: undefined, outcome: undefined })])
      expect(ids(reused)).toEqual([])
    })

    it('does not count a reviewer as an attempt', () => {
      expect(ids(state([task('t1', 'failed')], [dsp('d1', 't1', 'w1', { outcome: 'failed' }), dsp('d2', 't1', 'rev', { review: true })]))).toEqual([])
    })

    it('leaves an old attempt of a converging Task to the repair, which worker-release refuses to end', () => {
      const s = retried()
      ;(s.jobs[0] as { convergence?: object }).convergence = {}
      s.tasks[0].status = 'validating'
      expect(ids(s)).toEqual([])
    })
  })
})
