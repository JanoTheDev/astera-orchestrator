import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { consoleSummaryOf } from './openConsoles'
import { OpenConsolesChip } from './PlanHeader'

// the key and its placeholders stand in for the words
vi.mock('../../i18n/I18nProvider', () => ({
  useI18n: () => ({ t: (key: string, v?: Record<string, unknown>) => (v ? `${key}:${JSON.stringify(v)}` : key) })
}))
vi.mock('../shell/navigation', () => ({ openConsole: vi.fn(), openPlan: vi.fn() }))

const summary = consoleSummaryOf(
  {
    count: 2,
    list: [
      { sessionId: 's1', taskId: 't1', role: 'worker', reason: 'working' },
      { sessionId: 's2', taskId: 't1', role: 'reviewer', reason: 'none' }
    ]
  },
  () => 'Add chip'
)!

describe('OpenConsolesChip', () => {
  it('shows the count on the chip and keeps the rows closed', () => {
    const html = renderToStaticMarkup(<OpenConsolesChip summary={summary} onFocus={() => {}} />)
    expect(html).toContain('plan.consoles.many:{&quot;count&quot;:2}')
    expect(html).not.toContain('plan-consoles-row')
  })

  it('lists one row per console with Task, role and reason, a none row flagged', () => {
    const html = renderToStaticMarkup(<OpenConsolesChip summary={summary} onFocus={() => {}} defaultOpen />)
    expect(html.match(/plan-consoles-row /g)).toHaveLength(2)
    expect(html).toContain('Add chip · plan.consoles.role.worker')
    expect(html).toContain('plan.consoles.reason.working')
    expect(html).toContain('plan-consoles-row--idle')
    expect(html).toContain('plan.consoles.reason.none')
  })
})
