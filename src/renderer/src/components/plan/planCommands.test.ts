import { describe, expect, it } from 'vitest'
import { integrateAllOutcomeOf, taskActionOf } from './planCommands'

describe('integrateAllOutcomeOf (T4)', () => {
  it('reads the four answers of run-integrate-all', () => {
    expect(integrateAllOutcomeOf({ status: 200, body: { state: 'delivered' } })).toEqual({ state: 'delivered' })
    expect(integrateAllOutcomeOf({ status: 200, body: { state: 'fixing-conflicts', taskId: 'tsk_1', reason: 'x' } })).toEqual({ state: 'fixing-conflicts', taskId: 'tsk_1' })
    expect(integrateAllOutcomeOf({ status: 409, body: { state: 'stopped', error: 'push refused' } })).toEqual({ state: 'stopped', error: 'push refused' })
    expect(integrateAllOutcomeOf({ status: 409, body: { error: 'these worktrees hold work that was not merged: /w/a' } })).toEqual({ state: 'refused', error: 'these worktrees hold work that was not merged: /w/a' })
    expect(integrateAllOutcomeOf({ status: 403, body: null })).toEqual({ state: 'refused' })
  })
})

describe('taskActionOf', () => {
  it('continues a blocked Task with no Gate, retries a failed one, offers nothing else', () => {
    expect(taskActionOf({ status: 'blocked' })).toBe('continue')
    expect(taskActionOf({ status: 'blocked', gate: { id: 'g', question: 'q' } })).toBeUndefined()
    expect(taskActionOf({ status: 'failed' })).toBe('retry')
    for (const status of ['pending', 'ready', 'completed'] as const) expect(taskActionOf({ status })).toBeUndefined()
  })

  it('restarts a dispatched Task with no running Dispatch, leaves one with a running Dispatch alone', () => {
    expect(taskActionOf({ status: 'dispatched' })).toBe('restart')
    expect(taskActionOf({ status: 'dispatched', provider: 'claude' })).toBeUndefined()
  })
})
