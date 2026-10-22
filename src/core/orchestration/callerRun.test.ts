import { describe, expect, it } from 'vitest'
import { callerRun } from './state'
import type { OrchState } from './state'

// Two plans at once: the newest Run is not every caller's Run
const s = {
  runs: [
    { id: 'run_old', coordinatorSessionId: 'coordA' },
    { id: 'run_new', externalCoordinatorSessionId: 'coordB' }
  ],
  tasks: [{ id: 't1', runId: 'run_old' }],
  dispatches: [
    { id: 'd1', taskId: 't1', sessionId: 'workerA' },
    { id: 'd2', taskId: 't1', sessionId: 'gone', endedAt: '2026-10-20T00:00:00Z' }
  ]
} as unknown as OrchState

describe('callerRun', () => {
  it('answers the Run the calling coordinator leads, not the newest', () => {
    expect(callerRun(s, 'coordA')?.id).toBe('run_old')
    expect(callerRun(s, 'coordB')?.id).toBe('run_new')
  })
  it("answers an open worker's Run", () => {
    expect(callerRun(s, 'workerA')?.id).toBe('run_old')
  })
  it('falls back to the newest Run for a shell or an ended session', () => {
    expect(callerRun(s, '')?.id).toBe('run_new')
    expect(callerRun(s, 'gone')?.id).toBe('run_new')
  })
})

it('a session leading two Runs means its newest', () => {
  const both = { ...s, runs: [...s.runs, { id: 'run_third', coordinatorSessionId: 'coordA' }] } as unknown as OrchState
  expect(callerRun(both, 'coordA')?.id).toBe('run_third')
})
