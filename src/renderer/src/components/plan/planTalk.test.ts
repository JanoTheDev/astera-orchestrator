import { describe, expect, it } from 'vitest'
import type { JobRow } from '../../../../core/types'
import { approveSlot, canAskPlanMore, feedbackMark, feedbackOutcomeOf, planTalkView, plannerWaitingIn } from './planTalk'

const row = (o: Partial<JobRow>): JobRow => ({ id: 'j', tasks: [{}, {}], ...o }) as unknown as JobRow

describe('planTalkView', () => {
  it('hides for unplanned and archived rows', () => {
    expect(planTalkView(row({})).show).toBe(false)
    expect(planTalkView(row({ planned: true, archivedAt: 'x' })).show).toBe(false)
  })
  it('shows on a finished, not archived plan, so the talk box can reopen it', () => {
    expect(planTalkView(row({ planned: true, outcome: 'completed' })).show).toBe(true)
    expect(planTalkView(row({ planned: true, outcome: 'failed', archivedAt: 'x' })).show).toBe(false)
  })
  it('reject only while pending; auto notice counts tasks', () => {
    expect(planTalkView(row({ planned: true, pendingStart: true }))).toMatchObject({ show: true, canReject: true, autoStarted: null })
    expect(planTalkView(row({ planned: true, autoStartedAt: 't' }))).toMatchObject({ canReject: false, autoStarted: 2 })
  })
})

describe('approveSlot (#116)', () => {
  it('Approve only once the planner is done; Planning… or Starts by itself before', () => {
    expect(approveSlot(row({}))).toBeNull()
    expect(approveSlot(row({ pendingStart: true, archivedAt: 'x' }))).toBeNull()
    // A Run built by hand keeps its Start
    expect(approveSlot(row({ pendingStart: true }))).toBe('approve')
    expect(approveSlot(row({ pendingStart: true, planned: true }))).toBe('planning')
    expect(approveSlot(row({ pendingStart: true, planned: true, autoApprove: true }))).toBe('auto')
    expect(approveSlot(row({ pendingStart: true, planned: true, planReady: true }))).toBe('approve')
    // Ready on an auto-approve plan: its own start did not go through
    expect(approveSlot(row({ pendingStart: true, planned: true, planReady: true, autoApprove: true }))).toBe('approve')
    // #117: hands-off counts as auto-approve; a plan with problems will not start by itself
    expect(approveSlot(row({ pendingStart: true, planned: true, handsOff: true }))).toBe('auto')
    expect(approveSlot(row({ pendingStart: true, planned: true, autoApprove: true, planProblems: ['no tasks'] }))).toBe('planning')
    expect(approveSlot(row({ pendingStart: true, planned: true, handsOff: true, planProblems: [] }))).toBe('auto')
  })
})

describe('feedbackOutcomeOf (T4)', () => {
  it('typed or handed to a planner is sent; a message kept for the running replan is queued', () => {
    expect(feedbackOutcomeOf({ via: 'typed' }, row({ outcome: 'running' }))).toBe('sent')
    expect(feedbackOutcomeOf({ via: 'resumed' }, row({}))).toBe('sent')
    expect(feedbackOutcomeOf({ via: 'queued' }, row({ outcome: 'running' }))).toBe('queued')
    expect(feedbackOutcomeOf(null, row({}))).toBe('sent')
  })
  it('a completion replan on a finished plan reopened it; on a running plan it is only sent', () => {
    expect(feedbackOutcomeOf({ mode: 'completion', sessionId: 's' }, row({ outcome: 'completed' }))).toBe('reopened')
    expect(feedbackOutcomeOf({ mode: 'completion', sessionId: 's' }, row({ outcome: 'failed' }))).toBe('reopened')
    expect(feedbackOutcomeOf({ mode: 'completion', sessionId: 's' }, row({ outcome: 'running' }))).toBe('sent')
    expect(feedbackOutcomeOf({ mode: 'wave' }, row({ outcome: 'completed' }))).toBe('sent')
  })
})

describe('plannerWaitingIn (T4)', () => {
  it('only the 409 that says the planner waits on a question or a prompt', () => {
    expect(plannerWaitingIn({ status: 409, body: { error: 'the planner waits on a question: answer it in its tab first' } })).toBe(true)
    expect(plannerWaitingIn({ status: 409, body: { error: 'job j is archived: unarchive it first' } })).toBe(false)
    expect(plannerWaitingIn({ status: 200, body: {} })).toBe(false)
  })
})

describe('feedbackMark (T4)', () => {
  it('a queued entry is marked until the planner answers it', () => {
    expect(feedbackMark({ phase: 'run', queued: true })).toBe('queued')
    expect(feedbackMark({ phase: 'run', queued: true, changes: [] })).toBe('duringRun')
    expect(feedbackMark({ phase: 'run' })).toBe('duringRun')
    expect(feedbackMark({ phase: 'plan' })).toBeNull()
  })
})

describe('canAskPlanMore', () => {
  it('is true for a planned, unarchived plan whose Run is over', () => {
    expect(canAskPlanMore(row({ planned: true, outcome: 'completed' }))).toBe(true)
    expect(canAskPlanMore(row({ planned: true, outcome: 'failed' }))).toBe(true)
  })
  it('is false while running, archived, unplanned, waiting to start or a schedule', () => {
    expect(canAskPlanMore(row({ planned: true, outcome: 'running' }))).toBe(false)
    expect(canAskPlanMore(row({ planned: true, outcome: 'completed', archivedAt: 'x' }))).toBe(false)
    expect(canAskPlanMore(row({ outcome: 'completed' }))).toBe(false)
    expect(canAskPlanMore(row({ planned: true, outcome: 'completed', pendingStart: true }))).toBe(false)
    expect(canAskPlanMore(row({ planned: true, outcome: 'completed', schedule: {} as never }))).toBe(false)
  })
})
