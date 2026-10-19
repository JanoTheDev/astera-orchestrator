import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { lastActivityOf, planStatusOf } from './planList'

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
})

describe('lastActivityOf', () => {
  it('is the latest time the row knows, undefined with none', () => {
    expect(lastActivityOf(row())).toBeUndefined()
    const at = lastActivityOf(row({ createdAt: '2026-01-01T00:00:00Z', tasks: [task('a', { startedAt: '2026-01-02T00:00:00Z' }), task('b')] }))
    expect(at).toBe(Date.parse('2026-01-02T00:00:00Z'))
  })
})
