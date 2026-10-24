// T8: the plan tab is one document under its header. T3: two columns, Needs you, Steps and Plan settings on the left, the
// summary card, Goal and Activity in the rail on the right; a narrow tab stacks them by CSS `order` (planPage.css), so the
// markup keeps the two columns' order. Plan settings shows in simple mode too; Advanced mode adds the graph switch
// (PlanWaves' `simple`) and "So far". The children are stubs: this is the page's wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resetAdvancedMode, setAdvancedMode } from '../../state/useAdvancedMode'

// hoisted: the vi.mock factories below run before the module body
const { stub } = vi.hoisted(() => ({ stub: (name: string) => () => React.createElement('i', { 'data-part': name }) }))
const gated = { id: 'g', title: 'G', status: 'blocked', openGates: 1, gate: { id: 'gat_1', question: 'Go?' } }
let tasks: unknown[] = []
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock('../plan/usePlanPage', () => ({
  usePlanPage: () => ({ lockedReason: undefined, tasks, live: { questions: [] }, asking: null, answering: null, ui: { confirm: async () => true }, setSelected: () => {} })
}))
vi.mock('../plan/PlanHeader', () => ({ PlanHeader: (p: { simple?: boolean }) => React.createElement('i', { 'data-part': 'header', 'data-simple': String(p.simple) }) }))
vi.mock('../plan/PlanOverviewSection', () => ({ PlanGoal: stub('goal'), PlanSoFar: stub('sofar'), PlanSummaryCard: stub('summary') }))
vi.mock('../plan/PlanWaves', () => ({
  PlanWaves: (p: { simple?: boolean }) => React.createElement('i', { 'data-part': 'steps', 'data-simple': String(p.simple) }),
  answerVia: () => async () => null
}))
vi.mock('../plan/PlanSettings', () => ({ PlanSettings: stub('settings') }))
vi.mock('../plan/TaskBoard', () => ({ NeedsYou: stub('needs') }))
vi.mock('../plan/PlanJournal', () => ({ PlanJournal: stub('journal') }))
vi.mock('../plan/PlanChanges', () => ({ PlanChanges: stub('changes') }))
vi.mock('../plan/PlanFiles', () => ({ PlanFiles: stub('files') }))
vi.mock('../plan/PlanTalk', () => ({ PlanTalk: stub('talk') }))

import { PlanPage } from './PlanPage'

const run = { id: 'j', objective: 'o', tasks: [], outcome: 'running' }
const render = (section: 'overview' | 'waves' | 'changes' | 'journal' = 'overview'): string =>
  renderToStaticMarkup(
    React.createElement(PlanPage, {
      run: run as never, detail: null, projectPath: '', runId: 'j', canOpenSession: () => false, onOpenSession: () => {}, onShowOlderJournal: () => {},
      onClose: () => {}, door: {} as never, section, onSection: () => {}, plans: [], snapshot: null, onOpenConsoles: () => {}
    })
  )
const order = (html: string, ids: string[]): number[] => ids.map((id) => html.indexOf(id))

describe('plan tab', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    resetAdvancedMode()
    tasks = []
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetAdvancedMode()
  })

  it('simple mode: the columns in order, Plan settings among them, the steps simple, the log open', () => {
    for (const section of ['overview', 'waves', 'journal'] as const) {
      const html = render(section)
      expect(html, section).toContain('data-part="header" data-simple="true"')
      expect(html, section).toContain('data-part="steps" data-simple="true"')
      expect(html, section).toContain('data-part="settings"')
      expect(html, section).toContain('data-part="journal"')
      expect(html, section).not.toContain('plan.doc.tab.sofar')
      const at = order(html, [
        'data-part="header"',
        'class="plan-doc-main"',
        'id="plan-steps"',
        'id="plan-settings"',
        'class="plan-doc-rail"',
        'data-part="summary"',
        'id="plan-goal"',
        'id="plan-activity"'
      ])
      expect(at.every((n, i) => n >= 0 && (i === 0 || n > at[i - 1]))).toBe(true)
    }
  })

  it('Needs you is hidden when nothing is open, and heads the left column when something is', () => {
    expect(render()).not.toContain('id="plan-needs"')
    tasks = [gated]
    const html = render()
    expect(html).toContain('data-part="needs"')
    expect(html.indexOf('class="plan-doc-main"')).toBeLessThan(html.indexOf('id="plan-needs"'))
    expect(html.indexOf('id="plan-needs"')).toBeLessThan(html.indexOf('id="plan-steps"'))
  })

  it('advanced mode: the steps get their graph switch, Activity gets So far; settings stay', () => {
    setAdvancedMode(true)
    const html = render()
    expect(html).toContain('data-part="steps" data-simple="false"')
    expect(html).toContain('data-part="settings"')
    expect(html).toContain('plan.doc.tab.sofar')
  })

  it("opens the Activity on the stored section's tab", () => {
    expect(render('changes')).toContain('data-part="changes"')
  })
})
