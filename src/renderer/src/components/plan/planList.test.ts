import { describe, expect, it } from 'vitest'
import type { JobRow, JobTask } from '../../../../core/types'
import { ageOf } from './planBoard'
import { clearableOf, finishedAtMs, isOwnerHeld, isUnmergedPlan, isStalledPlan, isStoppedPlan, lastActivityOf, planStatusOf, resumeActionOf, splitPlans } from './planList'

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

  it('names the real hold: final check, re-planning, a replan question, the owner, a hold from an older Host', () => {
    const held = { dispatchHold: true as const }
    expect(planStatusOf(row({ ...held, holdBy: 'final-check', outcome: 'checking' }))).toEqual({ key: 'pages.plans.status.finalCheck', tone: 'info' })
    expect(planStatusOf(row({ outcome: 'checking', replanWave: 2 })).key).toBe('pages.plans.status.finalCheck')
    expect(planStatusOf(row({ ...held, holdBy: 'replanning' }))).toEqual({ key: 'pages.plans.status.replanning', tone: 'info' })
    expect(planStatusOf(row({ ...held, holdBy: 'replan-question' }))).toEqual({ key: 'plan.outcome.needsYou', tone: 'warn' })
    expect(planStatusOf(row({ ...held, holdBy: 'owner' }))).toEqual({ key: 'jobs.hold.held', tone: 'warn' })
    expect(planStatusOf(row(held)).key).toBe('jobs.hold.held')
    for (const holdBy of ['final-check', 'replanning', 'replan-question'] as const)
      expect(planStatusOf(row({ ...held, holdBy })).key).not.toBe('jobs.hold.held')
  })

  it('names a delivery in progress: merging, retrying', () => {
    const delivery = (state: 'delivering' | 'retrying') => ({ runId: 'r', state })
    expect(planStatusOf(row({ outcome: 'checking', delivery: delivery('delivering') }))).toEqual({ key: 'pages.plans.status.delivering', tone: 'info' })
    expect(planStatusOf(row({ outcome: 'failed', delivery: delivery('retrying') }))).toEqual({ key: 'pages.plans.status.deliveryRetrying', tone: 'warn' })
  })

  it('offers Resume/Release only for the owner’s hold', () => {
    expect(isOwnerHeld(row({ dispatchHold: true, holdBy: 'owner' }))).toBe(true)
    expect(isOwnerHeld(row({ dispatchHold: true }))).toBe(true)
    expect(isOwnerHeld(row())).toBe(false)
    for (const holdBy of ['final-check', 'replanning', 'replan-question'] as const) expect(isOwnerHeld(row({ dispatchHold: true, holdBy }))).toBe(false)
  })

  it('reads Delivered, with the plan that delivered it, for a failed plan whose work landed through a later plan', () => {
    const deliveredBy = { jobId: 'later', title: 'Deliver redesign' }
    const status = planStatusOf(row({ outcome: 'failed', deliveryError: 'merge conflict', deliveredBy }))
    expect(status).toEqual({ key: 'pages.plans.status.deliveredBy', tone: 'ok', params: { plan: 'Deliver redesign' }, deliveredBy: 'later' })
    expect(planStatusOf(row({ outcome: 'completed', deliveredBy })).key).toBe('pages.plans.status.deliveredBy')
    // archived still wins; a plan running again is running, not delivered
    expect(planStatusOf(row({ outcome: 'failed', archivedAt: 'x', deliveredBy })).key).toBe('jobs.lifecycle.archived')
    expect(planStatusOf(row({ outcome: 'running', deliveredBy })).key).toBe('pages.plans.status.working')
    expect(isStalledPlan(row({ outcome: 'failed', deliveredBy }))).toBe(false)
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

  it('Resume does what fits the stall: restart the lead, else retry the failed Task, else nothing', () => {
    expect(resumeActionOf(row({ stuck: 'stalled', coordinatorMissing: true }))).toEqual({ kind: 'restart-lead' })
    // no coordinator account (job_2855…): a failed Task with nothing waiting on it
    expect(resumeActionOf(row({ stuck: 'stalled', tasks: [task('a', { status: 'completed' }), task('f', { status: 'failed' })] }))).toEqual({ kind: 'retry', taskId: 'f' })
    expect(resumeActionOf(row({ stuck: 'stalled', stalledOn: { taskId: 'g', title: 'G', waiting: 1 }, tasks: [task('f', { status: 'failed' })] }))).toEqual({ kind: 'retry', taskId: 'g' })
    expect(resumeActionOf(row({ stuck: 'stalled', tasks: [] }))).toBeUndefined()
    expect(resumeActionOf(row())).toBeUndefined()
  })

  it('Resume on a plan stopped with Kill runs runs-resume; schedules, archived, pending and finished plans are not stopped', () => {
    expect(resumeActionOf(row({ paused: true }))).toEqual({ kind: 'resume-run' })
    expect(isStoppedPlan(row({ paused: true }))).toBe(true)
    expect(isStoppedPlan(row({ dispatchHold: true }))).toBe(false)
    expect(isStoppedPlan(row({ paused: true, schedule: { kind: 'daily', at: '09:00' } as never }))).toBe(false)
    expect(isStoppedPlan(row({ paused: true, archivedAt: 'x' }))).toBe(false)
    expect(isStoppedPlan(row({ paused: true, pendingStart: true }))).toBe(false)
    expect(isStoppedPlan(row({ paused: true, outcome: 'completed' }))).toBe(false)
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

describe('splitPlans', () => {
  const day = 86_400_000
  const now = Date.parse('2026-10-24T12:00:00Z')
  const iso = (daysAgo: number): string => new Date(now - daysAgo * day).toISOString()
  const plans = [
    row({ id: 'run', outcome: 'running' }),
    row({ id: 'old', outcome: 'completed', finishedAt: iso(10) }),
    row({ id: 'new', outcome: 'completed', finishedAt: iso(1) }),
    row({ id: 'arch', outcome: 'completed', archivedAt: iso(0), finishedAt: iso(3) }),
    row({ id: 'nodate', outcome: 'completed' }),
    row({ id: 'run2', outcome: 'checking' })
  ]
  it('puts the plans at work on top in the snapshot order and the ended ones newest finished first', () => {
    const { running, finished } = splitPlans(plans, false)
    expect(running.map((r) => r.id)).toEqual(['run', 'run2'])
    expect(finished.map((r) => r.id)).toEqual(['new', 'old', 'nodate'])
  })
  it('keeps archived plans only with showArchived, sorted among the others by when they finished', () => {
    expect(splitPlans(plans, true).finished.map((r) => r.id)).toEqual(['new', 'arch', 'old', 'nodate'])
  })
  it('reads the last activity when finishedAt is absent or unreadable', () => {
    expect(finishedAtMs(row({ finishedAt: iso(2) }))).toBe(now - 2 * day)
    expect(finishedAtMs(row({ createdAt: iso(5) }))).toBe(now - 5 * day)
    expect(finishedAtMs(row({ finishedAt: 'x', createdAt: iso(5) }))).toBe(now - 5 * day)
    expect(finishedAtMs(row())).toBeUndefined()
  })
  it('clearableOf: older than 7 days, or all; never an archived plan, a running plan or one with no finish time (older only)', () => {
    expect(clearableOf(plans, false, now).map((r) => r.id)).toEqual(['old'])
    expect(clearableOf(plans, true, now).map((r) => r.id)).toEqual(['old', 'new', 'nodate'])
  })
})

describe('isUnmergedPlan and the Unmerged pane', () => {
  const done = { outcome: 'completed' as const, finishedAt: '2026-10-20T00:00:00Z' }
  const pr = (extra: object = {}) => ({ at: '2026-10-20T00:00:00Z', url: 'https://github.com/o/r/pull/1', number: 1, ...extra })
  it('is an ended, unarchived plan with a ready un-landed PR, or one awaiting review', () => {
    expect(isUnmergedPlan(row({ ...done, pr: pr() }))).toBe(true)
    expect(isUnmergedPlan(row({ ...done, awaitingReview: true }))).toBe(true)
    expect(isUnmergedPlan(row({ ...done, pr: pr({ draft: true }) }))).toBe(false)
    expect(isUnmergedPlan(row({ ...done, pr: pr({ landed: 'merged' }) }))).toBe(false)
    expect(isUnmergedPlan(row({ ...done, pr: { at: 'x' } }))).toBe(false)
    expect(isUnmergedPlan(row({ ...done, archivedAt: done.finishedAt, pr: pr() }))).toBe(false)
    expect(isUnmergedPlan(row({ outcome: 'running', pr: pr() }))).toBe(false)
  })
  it('splits them out of finished, newest first, and Clear finished leaves them', () => {
    const rows = [
      row({ id: 'a', ...done, pr: pr() }),
      row({ id: 'b', outcome: 'completed', finishedAt: '2026-10-22T00:00:00Z', awaitingReview: true }),
      row({ id: 'c', ...done }),
      row({ id: 'r', outcome: 'running' })
    ]
    const s = splitPlans(rows, false)
    expect(s.running.map((r) => r.id)).toEqual(['r'])
    expect(s.unmerged.map((r) => r.id)).toEqual(['b', 'a'])
    expect(s.finished.map((r) => r.id)).toEqual(['c'])
    expect(clearableOf(rows, true, Date.parse('2026-11-30T00:00:00Z')).map((r) => r.id)).toEqual(['c'])
  })
})
