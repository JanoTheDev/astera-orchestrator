import { describe, expect, it } from 'vitest'
import type { JobRow } from '../../../../core/types'
import { planTalkView } from './planTalk'

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
