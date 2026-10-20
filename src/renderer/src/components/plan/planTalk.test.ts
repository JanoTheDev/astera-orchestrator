import { describe, expect, it } from 'vitest'
import type { JobRow } from '../../../../core/types'
import { approveSlot, planTalkView } from './planTalk'

const row = (o: Partial<JobRow>): JobRow => ({ id: 'j', tasks: [{}, {}], ...o }) as unknown as JobRow

describe('planTalkView', () => {
  it('hides for unplanned and archived rows', () => {
    expect(planTalkView(row({})).show).toBe(false)
    expect(planTalkView(row({ planned: true, archivedAt: 'x' })).show).toBe(false)
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
  it('T10: a plan planned with the owner shows Start as soon as it holds, also with auto-approve: the click is their go', () => {
    expect(approveSlot(row({ pendingStart: true, planned: true, awaitsGo: true }))).toBe('approve')
    expect(approveSlot(row({ pendingStart: true, planned: true, awaitsGo: true, autoApprove: true }))).toBe('approve')
    expect(approveSlot(row({ pendingStart: true, planned: true, awaitsGo: true, planProblems: ['no tasks'] }))).toBe('planning')
  })
})
