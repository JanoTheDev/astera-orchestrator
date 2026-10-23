import { describe, it, expect } from 'vitest'
import { lostWithDriver, lostWithNobody } from './lostGate'
import { emptyState, type OrchState } from './state'
import type { Dispatch } from './types'

const NOW = '2026-09-25T10:00:00.000Z'
const EARLIER = '2026-09-25T09:00:00.000Z'

/** A dispatched Task whose latest Dispatch ended with no outcome and no closedBy, in a Run that has a
 *  coordinator slot or not — the pure-layer shape `candidates` reads. */
const stateWithLostDispatch = (o: { coordinatorSessionId?: string; closedBy?: Dispatch['closedBy']; autoDispatch?: boolean }): OrchState => ({
  ...emptyState(),
  jobs: [{ id: 'job_1', objective: 'o', cwd: 'D:/p', createdAt: EARLIER, ...(o.autoDispatch ? { autoDispatch: true } : {}) }],
  runs: [{ id: 'run_1', jobId: 'job_1', ordinal: 1, createdAt: EARLIER, ...(o.coordinatorSessionId ? { coordinatorSessionId: o.coordinatorSessionId } : {}) }],
  tasks: [
    { id: 'tsk_1', runId: 'run_1', jobId: 'job_1', title: 't', spec: 's', deps: [], status: 'dispatched', accountIds: ['acc_1'], consecutiveFailures: 0, createdAt: EARLIER, updatedAt: EARLIER }
  ],
  dispatches: [
    {
      id: 'dsp_1', taskId: 'tsk_1', provider: 'claude', accountId: 'acc_1', sessionId: 'sess-1', cwd: 'D:/wt', specPath: 'D:/spec.md',
      startedAt: EARLIER, workerState: 'outcome_unknown', endedAt: NOW, retained: false, ...(o.closedBy ? { closedBy: o.closedBy } : {})
    }
  ]
})

describe('lostWithNobody (R16)', () => {
  it('names a lost worker’s Task in a Run with no coordinator, and leaves one with a coordinator to it (R16)', () => {
    const s = stateWithLostDispatch({ coordinatorSessionId: undefined })
    expect(lostWithNobody(s).map((x) => x.taskId)).toEqual([s.tasks[0].id])
    expect(lostWithNobody(stateWithLostDispatch({ coordinatorSessionId: 's-coord' }))).toEqual([])
  })
  it('leaves a lost worker in an app-driven Run to the watchdog, which starts it again (no owner Gate)', () => {
    expect(lostWithNobody(stateWithLostDispatch({ autoDispatch: true }))).toEqual([])
    expect(lostWithDriver(stateWithLostDispatch({ autoDispatch: true })).map((x) => x.taskId)).toEqual(['tsk_1'])
  })
  it('leaves a person-closed Dispatch alone (closedBy), as candidates() does', () => {
    expect(lostWithNobody(stateWithLostDispatch({ closedBy: 'stop' }))).toEqual([])
  })
})

describe('lostWithDriver', () => {
  it('names a lost worker’s Task in a Run with a coordinator: the half lostWithNobody leaves', () => {
    expect(lostWithDriver(stateWithLostDispatch({ coordinatorSessionId: 'coord-1' })).map((x) => x.taskId)).toEqual(['tsk_1'])
    expect(lostWithDriver(stateWithLostDispatch({}))).toEqual([])
    expect(lostWithDriver(stateWithLostDispatch({ coordinatorSessionId: 'coord-1', closedBy: 'stop' }))).toEqual([])
  })
})
