import { describe, it, expect } from 'vitest'
import type { OpenConsole } from '../../../../core/orchestration/openConsoles'
import { consoleSummaryOf } from './openConsoles'

const c = (over: Partial<OpenConsole>): OpenConsole => ({ sessionId: 's1', role: 'worker', reason: 'working', ...over })
const titles: Record<string, string> = { t1: 'Add chip', t2: 'Wire i18n' }

describe('consoleSummaryOf', () => {
  it('has nothing to show when no console is open', () => {
    expect(consoleSummaryOf(undefined, () => undefined)).toBeUndefined()
    expect(consoleSummaryOf({ count: 0, list: [] }, () => undefined)).toBeUndefined()
  })

  it('counts the consoles and gives one row each with Task title, role and reason', () => {
    const s = consoleSummaryOf(
      { count: 3, list: [c({ taskId: 't1' }), c({ sessionId: 's2', taskId: 't2', role: 'reviewer', reason: 'reviewing' }), c({ sessionId: 's3', role: 'coordinator', reason: 'retained' })] },
      (id) => titles[id]
    )!
    expect(s.count).toBe(3)
    expect(s.labelKey).toBe('plan.consoles.many')
    expect(s.rows).toEqual([
      { sessionId: 's1', taskTitle: 'Add chip', roleKey: 'plan.consoles.role.worker', reasonKey: 'plan.consoles.reason.working', closesSoon: false },
      { sessionId: 's2', taskTitle: 'Wire i18n', roleKey: 'plan.consoles.role.reviewer', reasonKey: 'plan.consoles.reason.reviewing', closesSoon: false },
      { sessionId: 's3', taskTitle: undefined, roleKey: 'plan.consoles.role.coordinator', reasonKey: 'plan.consoles.reason.retained', closesSoon: false }
    ])
  })

  it('uses the singular label for one console and flags a none row as closing soon', () => {
    const s = consoleSummaryOf({ count: 1, list: [c({ taskId: 'gone', reason: 'none' })] }, (id) => titles[id])!
    expect(s.labelKey).toBe('plan.consoles.one')
    expect(s.rows[0]).toMatchObject({ taskTitle: undefined, closesSoon: true })
  })
})
