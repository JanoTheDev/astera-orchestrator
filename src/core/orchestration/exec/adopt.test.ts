// Adopting a live worker whose Dispatch record was lost (run job_0b682db7df32e7b4): recorded under its spec's ids, and
// never onto a Task that has a worker, is past its worker, or for a session that names no spec.
import { describe, expect, it } from 'vitest'
import { adoptLiveWorkers, specIdsOf, type LiveWorker } from './adopt'
import { emptyState, type OrchState } from '../state'
import type { Dispatch, Task } from '../types'

const NOW = '2026-10-20T11:00:00.000Z'
const task = (over: Partial<Task> = {}): Task => ({
  id: 'tsk_1', runId: 'run_1', title: 'T1', spec: 's', deps: [], status: 'dispatched', accountIds: ['accA'],
  consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW, ...over
})
const state = (over: Partial<OrchState> = {}): OrchState => ({ ...emptyState(), tasks: [task()], ...over })
const original: LiveWorker = { id: 'ses_orig', spec: 'Read /p/orch/specs/tsk_1-dsp_abc1.md and follow the instructions in it', cwd: '/wt', accountId: 'accB' }
const open = (over: Partial<Dispatch> = {}): Dispatch =>
  ({ id: 'dsp_dup', taskId: 'tsk_1', provider: 'codex', accountId: 'accA', sessionId: 'ses_dup', cwd: '/wt2', specPath: '', startedAt: NOW, workerState: 'ready', retained: false, ...over }) as Dispatch

describe('specIdsOf', () => {
  it('reads the spec file name, or the ids a roll prompt reports with', () => {
    expect(specIdsOf(original.spec)).toEqual({ taskId: 'tsk_1', dispatchId: 'dsp_abc1' })
    expect(specIdsOf('report with astera send --type worker_done --task-id tsk_9 --dispatch-id dsp_77.')).toEqual({ taskId: 'tsk_9', dispatchId: 'dsp_77' })
    expect(specIdsOf('hello')).toBeNull()
    expect(specIdsOf(undefined)).toBeNull()
  })
})

describe('adoptLiveWorkers', () => {
  it('records a Dispatch bound to the live session, under the id its spec names', () => {
    const r = adoptLiveWorkers(state(), [original], '/p/orch/specs', NOW)
    expect(r.adopted.map((d) => d.id)).toEqual(['dsp_abc1'])
    expect(r.state.dispatches).toEqual([
      expect.objectContaining({ id: 'dsp_abc1', taskId: 'tsk_1', sessionId: 'ses_orig', cwd: '/wt', accountId: 'accB', specPath: '/p/orch/specs/tsk_1-dsp_abc1.md', startedAt: NOW })
    ])
    expect(r.state.dispatches[0].endedAt).toBeUndefined()
  })

  it('moves a Task left ready back to dispatched, and takes the last attempt’s provider when the session gives none', () => {
    const ended = open({ id: 'dsp_old', endedAt: NOW, outcome: 'failed' })
    const r = adoptLiveWorkers(state({ tasks: [task({ status: 'ready' })], dispatches: [ended] }), [original], '/p/orch/specs', NOW)
    expect(r.state.tasks[0].status).toBe('dispatched')
    expect(r.adopted[0].provider).toBe('codex')
  })

  it('refuses while the Task has an open Dispatch for another session', () => {
    const s = state({ dispatches: [open()] })
    const r = adoptLiveWorkers(s, [original], '/p/orch/specs', NOW)
    expect(r.adopted).toEqual([])
    expect(r.state).toBe(s)
  })

  it('ignores a done, failed or validating Task', () => {
    for (const status of ['completed', 'failed', 'validating'] as const)
      expect(adoptLiveWorkers(state({ tasks: [task({ status })] }), [original], '/p/orch/specs', NOW).adopted).toEqual([])
  })

  it('ignores a session with no spec, one a Dispatch already names, and a spec whose Dispatch is recorded', () => {
    expect(adoptLiveWorkers(state(), [{ id: 'ses_x' }, { id: 'ses_y', spec: 'just a shell' }], '/p', NOW).adopted).toEqual([])
    // Stopped or reported: its own record stands
    const closed = open({ id: 'dsp_abc1', sessionId: 'ses_orig', endedAt: NOW, closedBy: 'stop' })
    expect(adoptLiveWorkers(state({ dispatches: [closed] }), [original], '/p', NOW).adopted).toEqual([])
    expect(adoptLiveWorkers(state({ dispatches: [open({ id: 'dsp_abc1', sessionId: 'ses_other', endedAt: NOW })] }), [original], '/p', NOW).adopted).toEqual([])
  })

  it('adopts one session per Task: the second on the same spec finds the first open', () => {
    const twin: LiveWorker = { ...original, id: 'ses_twin', spec: '--task-id tsk_1 --dispatch-id dsp_abc2' }
    const r = adoptLiveWorkers(state(), [original, twin], '/p', NOW)
    expect(r.adopted.map((d) => d.sessionId)).toEqual(['ses_orig'])
  })
})
