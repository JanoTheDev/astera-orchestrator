import { describe, expect, it } from 'vitest'
import type { JobTask, TaskStatus } from '../../../../core/types'
import { taskActionsOf, type TaskActionCtx } from './taskActions'

const task = (status: TaskStatus, extra: Partial<JobTask> = {}): JobTask => ({ id: 'tsk_1', title: 'T', status, openGates: 0, ...extra })
const ctx: TaskActionCtx = { canManualStart: true, consoleOpen: false }
const ids = (t: JobTask, c: TaskActionCtx = ctx): string[] => taskActionsOf(t, c).map((a) => a.id)

describe('taskActionsOf', () => {
  it('pending and ready: Start (with an account, when starting by hand is allowed), Ask, Edit', () => {
    for (const status of ['pending', 'ready'] as const) {
      expect(ids(task(status, { accountIds: ['acc'] }))).toEqual(['start', 'ask', 'edit', 'copyId'])
      expect(ids(task(status, { accountIds: ['acc'] }), { ...ctx, canManualStart: false })).toEqual(['ask', 'edit', 'copyId'])
      expect(ids(task(status))).toEqual(['ask', 'edit', 'copyId'])
    }
  })

  it('dispatched with an open Dispatch: Stop and the one worker pause action that applies; without one: Restart', () => {
    expect(ids(task('dispatched', { provider: 'claude' }))).toEqual(['stop', 'holdWorker', 'edit', 'copyId'])
    expect(ids(task('dispatched', { provider: 'claude', workerHeld: true }))).toEqual(['stop', 'unholdWorker', 'edit', 'copyId'])
    expect(ids(task('dispatched'))).toEqual(['restart', 'edit', 'copyId'])
  })

  it('validating, reviewing, merging: nothing to stop, only Edit and Copy ID', () => {
    for (const status of ['validating', 'reviewing', 'merging'] as const) expect(ids(task(status, { provider: 'claude' }))).toEqual(['edit', 'copyId'])
  })

  it('completed: Ask about it and Copy ID, no Edit', () => {
    expect(ids(task('completed'))).toEqual(['askAbout', 'copyId'])
  })

  it('failed: Retry, Accept, Cancel, Ask about it', () => {
    expect(ids(task('failed'))).toEqual(['retry', 'acceptFailed', 'cancelFailed', 'askAbout', 'edit', 'copyId'])
  })

  it('blocked: Continue when held for the owner, nothing of its own when a Gate is open', () => {
    expect(ids(task('blocked'))).toEqual(['continue', 'edit', 'copyId'])
    expect(ids(task('blocked', { gate: { id: 'g', question: 'q' } }))).toEqual(['edit', 'copyId'])
  })

  it('an auto-fix Task offers Stop auto-fix until it is stopped or finished', () => {
    const convergence = { round: 1, maxRounds: 3 } as unknown as JobTask['convergence']
    expect(ids(task('validating', { convergence }))).toContain('stopAutoFix')
    expect(ids(task('validating', { convergence: { ...convergence!, stopped: true } }))).not.toContain('stopAutoFix')
    expect(ids(task('completed', { convergence }))).not.toContain('stopAutoFix')
  })

  it('a Task with a branch offers its worktree; an open tab offers the console', () => {
    expect(ids(task('completed', { branch: 'b' }))).toEqual(['askAbout', 'openWorktree', 'reveal', 'terminal', 'copyId'])
    expect(ids(task('dispatched', { provider: 'claude', sessionId: 's' }), { ...ctx, consoleOpen: true })).toContain('openConsole')
    expect(ids(task('dispatched', { provider: 'claude', sessionId: 's' }))).not.toContain('openConsole')
  })

  it('marks what changes the plan, so a read-only pairing can turn it off', () => {
    const by = Object.fromEntries(taskActionsOf(task('failed', { branch: 'b' }), ctx).map((a) => [a.id, a.mutates]))
    expect(by).toMatchObject({ retry: true, acceptFailed: true, cancelFailed: true, edit: false, openWorktree: false, copyId: false })
  })
})
