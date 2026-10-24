import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { ageOf } from './planBoard'
import { isStalledPlan, lastActivityOf, planStatusOf } from './planList'

const task = (id: string, over: Partial<JobTask> = {}): JobTask => ({ id, title: id, status: 'pending', openGates: 0, ...over })
const row = (over: Partial<JobRow> = {}): JobRow => ({
  id: 'j', objective: 'o', outcome: 'running', done: 0, total: 0, eventCount: 0, sharesProjectFolder: false, tasks: [], ...over
})

describe('planStatusOf', () => {
  it('says a person’s part first, then what holds the plan, then how it runs', () => {
    expect(planStatusOf(row({ archivedAt: 'x', pendingStart: true }))).toEqual({ key: 'jobs.lifecycle.archived', tone: 'neutral' })
    expect(planStatusOf(row({ schedule: { kind: 'daily', at: '09:00' } as never, paused: true })).key).toBe('jobs.run.paused')
    expect(planStatusOf(row({ schedule: { kind: 'daily', at: '09:00' } as never })).key).toBe('jobs.run.scheduled')
    expect(planStatusOf(row({ pendingStart: true }))).toEqual({ key: 'pages.plans.status.approve', tone: 'warn' })
    expect(planStatusOf(row({ pendingStart: true, planned: true })).key).toBe('jobs.run.planning')
    expect(planStatusOf(row({ pendingStart: true, planned: true, autoApprove: true })).key).toBe('jobs.run.startsByItself')
    expect(planStatusOf(row({ tasks: [task('a', { status: 'blocked' })], dispatchHold: true })).key).toBe('pages.plans.status.needsYou')
    expect(planStatusOf(row({ dispatchHold: true })).key).toBe('jobs.hold.held')
    expect(planStatusOf(row()).key).toBe('pages.plans.status.working')
    expect(planStatusOf(row({ outcome: 'failed' })).tone).toBe('danger')
    expect(planStatusOf(row({ outcome: 'completed' }))).toEqual({ key: 'pages.plans.status.done', tone: 'ok' })
  })

  // T8: a running plan with nothing that can move never reads Working
  it('says Needs you or Stalled for a running plan nothing can move', () => {
    expect(planStatusOf(row({ stuck: 'needs-you', tasks: [task('a', { status: 'blocked' })] }))).toEqual({ key: 'plan.outcome.needsYou', tone: 'warn' })
    expect(planStatusOf(row({ stuck: 'stalled', tasks: [task('a', { status: 'failed' })] }))).toEqual({ key: 'pages.plans.status.stalled', tone: 'danger' })
    expect(planStatusOf(row({ stuck: 'stalled', paused: true })).key).toBe('jobs.run.roundStopped')
  })

  it('a plan with no Tasks that nothing works on reads Stalled with its Archive and Resume, never Working', () => {
    const dead = row({ stuck: 'stalled', tasks: [] })
    expect(planStatusOf(dead).key).toBe('pages.plans.status.stalled')
    expect(isStalledPlan(dead)).toBe(true)
    expect(isStalledPlan(row())).toBe(false)
    expect(isStalledPlan(row({ stuck: 'stalled', archivedAt: '2026-10-24T00:00:00.000Z' }))).toBe(false)
  })

  it('says Stalled on a failed Task (T36), never paused or running', () => {
    const stalledOn = { taskId: 't1', title: 'Build API', waiting: 2 }
    expect(planStatusOf(row({ stalledOn, stuck: 'needs-you' }))).toEqual({ key: 'plan.outcome.stalledOnFailed', tone: 'danger', params: { task: 'Build API' } })
    expect(planStatusOf(row({ stalledOn, stuck: 'stalled', tasks: [task('a', { status: 'failed' })] })).key).toBe('plan.outcome.stalledOnFailed')
  })
})

describe('planStatusOf delivery', () => {
  it('carries the delivery error of a failed plan, and none otherwise', () => {
    expect(planStatusOf(row({ outcome: 'failed', deliveryError: 'merge conflict' }))).toEqual({ key: 'pages.plans.status.failed', tone: 'danger', reason: 'merge conflict' })
    expect(planStatusOf(row({ outcome: 'failed' }))).not.toHaveProperty('reason')
  })
  // T34: the Tasks are done but the owner gave up the delivery: never "Done"
  it('reads a dismissed delivery as its own status, not Done', () => {
    const dismissed = row({ outcome: 'completed', deliveryDismissed: true })
    expect(planStatusOf(dismissed)).toEqual({ key: 'pages.plans.status.deliveryDismissed', tone: 'warn' })
  })
})

describe('lastActivityOf', () => {
  it('is the latest time the row knows, undefined with none', () => {
    expect(lastActivityOf(row())).toBeUndefined()
    const at = lastActivityOf(row({ createdAt: '2026-01-01T00:00:00Z', tasks: [task('a', { startedAt: '2026-01-02T00:00:00Z' }), task('b')] }))
    expect(at).toBe(Date.parse('2026-01-02T00:00:00Z'))
  })
  it('counts the last delivery attempt, so a failed plan reads from when it failed', () => {
    const failed = row({ createdAt: '2026-01-01T00:00:00Z', delivery: { runId: 'r', state: 'failed', lastAttemptAt: '2026-01-01T09:00:00Z' } })
    expect(lastActivityOf(failed)).toBe(Date.parse('2026-01-01T09:00:00Z'))
    expect(ageOf(new Date(lastActivityOf(failed) as number).toISOString(), Date.parse('2026-01-01T12:00:00Z'))).toBe('3h')
  })
})

describe('planStatusOf for the final check and a plan finished with blocked Tasks', () => {
  it('reads checking, never done, until the final check settles; and finished-with-blocked, never working or done', () => {
    expect(planStatusOf(row({ outcome: 'checking' }))).toEqual({ key: 'pages.plans.status.checking', tone: 'info' })
    expect(planStatusOf(row({ outcome: 'blocked', tasks: [task('a', { status: 'blocked' })] }))).toEqual({ key: 'pages.plans.status.blocked', tone: 'warn' })
  })
})
