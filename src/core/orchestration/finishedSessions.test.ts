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
})
