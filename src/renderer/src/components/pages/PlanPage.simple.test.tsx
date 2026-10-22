// T19: the plan page in simple mode shows progress, the board and the delivery/approve row, and hides the graph, journal and
// changes; Advanced mode brings them back. The children are stubs: this is the page's wiring.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resetAdvancedMode, setAdvancedMode } from '../../state/useAdvancedMode'

const stub = (name: string) => () => React.createElement('i', { 'data-part': name })
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
vi.mock('../plan/usePlanPage', () => ({ usePlanPage: () => ({ lockedReason: undefined, eventsShown: true }) }))
vi.mock('../plan/PlanHeader', () => ({ PlanHeader: (p: { simple?: boolean }) => React.createElement('i', { 'data-part': 'header', 'data-simple': String(p.simple) }) }))
vi.mock('../plan/PlanOverviewSection', () => ({
  PlanOverviewSection: (p: { simple?: boolean; board?: React.ReactNode }) =>
    React.createElement('i', { 'data-part': p.simple ? 'overview-simple' : 'overview-full' }, p.board)
}))
vi.mock('../plan/PlanWaves', () => ({ PlanWaves: stub('waves-graph'), PlanTaskBoard: stub('board') }))
vi.mock('../plan/PlanJournal', () => ({ PlanJournal: stub('journal') }))
vi.mock('../plan/PlanChanges', () => ({ PlanChanges: stub('changes') }))
vi.mock('../plan/PlanFiles', () => ({ PlanFiles: stub('files') }))

import { PlanPage } from './PlanPage'

const render = (section: 'overview' | 'waves' | 'changes' | 'journal'): string =>
  renderToStaticMarkup(
    React.createElement(PlanPage, {
      run: undefined, detail: null, projectPath: '', runId: 'r', canOpenSession: () => false, onOpenSession: () => {}, onShowOlderJournal: () => {},
      onClose: () => {}, door: {} as never, section, onSection: () => {}, plans: [], snapshot: null, onOpenConsoles: () => {}
    })
  )

describe('plan page modes', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    resetAdvancedMode()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetAdvancedMode()
  })

  it('simple mode: progress and board in the overview, no graph, journal or changes, whatever section was stored', () => {
    for (const section of ['overview', 'waves', 'changes', 'journal'] as const) {
      const html = render(section)
      expect(html, section).toContain('data-simple="true"')
      expect(html, section).toContain('overview-simple')
      expect(html, section).toContain('data-part="board"')
      expect(html, section).toContain('plan.simple.showDetails')
      for (const hidden of ['waves-graph', 'journal', 'changes', 'files', 'overview-full']) expect(html, `${section}/${hidden}`).not.toContain(`data-part="${hidden}"`)
    }
  })

  it('advanced mode: the sections come back', () => {
    setAdvancedMode(true)
    const html = render('waves')
    expect(html).toContain('data-simple="false"')
    expect(html).toContain('waves-graph')
    expect(html).toContain('data-part="journal"')
    expect(html).not.toContain('overview-simple')
  })
})
