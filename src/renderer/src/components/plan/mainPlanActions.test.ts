import { describe, expect, it } from 'vitest'
import type { JobRow } from '../../../../core/types'
import { rowMenuActionsOf } from './mainPlanActions'

const row = (o: Partial<JobRow>): JobRow => ({ id: 'j', objective: 'o', tasks: [], outcome: 'running', ...o }) as unknown as JobRow
const fn = (): void => {}
const all = { onApprove: fn, onPause: fn, onResume: fn, onHold: fn, onRestartCoordinator: fn, onArchive: fn, onUnarchive: fn, onDelete: fn }

describe('rowMenuActionsOf', () => {
  it('offers approve only to a plan waiting to start', () => {
    expect(rowMenuActionsOf(row({ pendingStart: true, planned: true, planReady: true }), all)).toEqual(['approve', 'archive', 'delete'])
    expect(rowMenuActionsOf(row({}), all)).not.toContain('approve')
  })
  it('holds and releases a live plan, pauses and resumes a schedule', () => {
    expect(rowMenuActionsOf(row({}), all)).toEqual(['hold', 'archive', 'delete'])
    expect(rowMenuActionsOf(row({ dispatchHold: true }), all)).toContain('release')
    expect(rowMenuActionsOf(row({ schedule: {} as never }), all)).toContain('pause')
    expect(rowMenuActionsOf(row({ schedule: {} as never, paused: true }), all)).toContain('resume')
  })
  it('offers a restart only to a plan that lost its coordinator', () => {
    expect(rowMenuActionsOf(row({ coordinatorMissing: true }), all)).toContain('restartCoordinator')
    expect(rowMenuActionsOf(row({}), all)).not.toContain('restartCoordinator')
  })
  it('offers unarchive, not archive, to an archived plan, and no pause', () => {
    const ids = rowMenuActionsOf(row({ archivedAt: '2026-01-01' }), all)
    expect(ids).toEqual(['unarchive', 'delete'])
  })
  it('leaves out what the caller did not wire', () => {
    expect(rowMenuActionsOf(row({ coordinatorMissing: true }), { onOpen: undefined } as never)).toEqual([])
  })
})
