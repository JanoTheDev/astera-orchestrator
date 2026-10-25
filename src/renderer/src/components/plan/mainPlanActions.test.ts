import { describe, expect, it } from 'vitest'
import type { JobRow } from '../../../../core/types'
import { planActionsOf } from './mainPlanActions'

const row = (o: Partial<JobRow>): JobRow => ({ id: 'j', objective: 'o', tasks: [], outcome: 'running', ...o }) as unknown as JobRow
const fn = (): void => {}
const all = { onApprove: fn, onPause: fn, onResume: fn, onHold: fn, onRestartCoordinator: fn, onArchive: fn, onUnarchive: fn, onDelete: fn }

describe('planActionsOf', () => {
  it('offers approve only to a plan waiting to start', () => {
    expect(planActionsOf(row({ pendingStart: true, planned: true, planReady: true }), all)).toEqual(['approve', 'archive', 'delete'])
    expect(planActionsOf(row({}), all)).not.toContain('approve')
  })
  it('holds and releases a live plan, pauses and resumes a schedule', () => {
    expect(planActionsOf(row({}), all)).toEqual(['hold', 'archive', 'delete'])
    expect(planActionsOf(row({ dispatchHold: true }), all)).toContain('release')
    expect(planActionsOf(row({ schedule: {} as never }), all)).toContain('pause')
    expect(planActionsOf(row({ schedule: {} as never, paused: true }), all)).toContain('resume')
  })
  it('offers a restart only to a plan that lost its coordinator', () => {
    expect(planActionsOf(row({ coordinatorMissing: true }), all)).toContain('restartCoordinator')
    expect(planActionsOf(row({}), all)).not.toContain('restartCoordinator')
  })
  it('offers unarchive, not archive, to an archived plan, and no pause', () => {
    const ids = planActionsOf(row({ archivedAt: '2026-01-01' }), all)
    expect(ids).toEqual(['unarchive', 'delete'])
  })
  it('leaves out what the caller did not wire', () => {
    expect(planActionsOf(row({ coordinatorMissing: true }), { onOpen: undefined } as never)).toEqual([])
  })
})
