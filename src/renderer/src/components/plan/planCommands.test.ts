import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOOR_DEADLINE_MS, integrateAllOutcomeOf, planCommands, taskActionOf } from './planCommands'

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

const toasts: string[] = []
vi.mock('../../lib/toast', () => ({ toast: { error: (m: string) => void toasts.push(m), info: () => {}, success: () => {} } }))

const commands = (command: () => Promise<unknown>) =>
  planCommands({
    t: ((k: string, p?: { detail?: string }) => (p?.detail ? `${k}:${p.detail}` : k)) as never,
    ui: {} as never,
    door: { command } as never,
    run: undefined,
    runId: 'run_1',
    tasks: [],
    accounts: null,
    asking: null,
    question: '',
    answering: null,
    busy: null,
    setBusy: () => {},
    setGateError: () => {},
    setAsking: () => {},
    setQuestion: () => {},
    setAnswering: () => {},
    setAnswer: () => {}
  })

afterEach(() => {
  toasts.length = 0
  vi.useRealTimers()
})

describe('Start again (restartTask) with the Host out of reach', () => {
  it('toasts why when the app has no Host link', async () => {
    const c = commands(() => Promise.reject(new Error("Error invoking remote method 'orch.command': Error: there is no connection to the Host")))
    await c.restartTask('tsk_1')
    expect(toasts).toEqual(['jobs.node.failedWhy:there is no connection to the Host'])
  })

  it('toasts when the call never answers', async () => {
    vi.useFakeTimers()
    const c = commands(() => new Promise(() => {}))
    const done = c.restartTask('tsk_1')
    await vi.advanceTimersByTimeAsync(DOOR_DEADLINE_MS)
    await done
    expect(toasts).toEqual(['jobs.node.noAnswer'])
  })

  it('toasts a refusal and stays quiet on success', async () => {
    await commands(async () => ({ status: 409, body: { error: 'nope' } })).restartTask('tsk_1')
    expect(toasts).toHaveLength(1)
    toasts.length = 0
    await commands(async () => ({ status: 200, body: {} })).restartTask('tsk_1')
    expect(toasts).toEqual([])
  })
})
