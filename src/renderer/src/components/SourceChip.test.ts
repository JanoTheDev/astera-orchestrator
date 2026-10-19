// The chip of a Job made from a ticket (plugin Phase 4 J18): its label, opening the ticket when there is a link, on
// the Job's card in the Jobs view and in its detail's header.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import type { JobRow, OrchSnapshot } from '../../../core/types'

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'en', t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key) })
}))

const { SourceChip } = await import('./SourceChip')
const { JobsView } = await import('./JobsView')

const SOURCE = { id: 'astera-linear-source', itemId: 'ENG-1', label: 'Linear ENG-1', url: 'https://linear.app/x/ENG-1' }

describe('SourceChip', () => {
  it('is a button that names the ticket and opens its link, or the label alone with no link, or nothing', () => {
    expect(renderToStaticMarkup(React.createElement(SourceChip, { source: SOURCE }))).toBe(
      '<button type="button" class="source-chip" title="jobs.source.chipOpen {&quot;label&quot;:&quot;Linear ENG-1&quot;}">Linear ENG-1</button>'
    )
    const { url: _url, ...noLink } = SOURCE
    expect(renderToStaticMarkup(React.createElement(SourceChip, { source: noLink }))).toBe('<span class="source-chip" title="Linear ENG-1">Linear ENG-1</span>')
    expect(renderToStaticMarkup(React.createElement(SourceChip, { source: undefined }))).toBe('')
  })

  it('stands on the card of a Job made from a ticket, and on no other', () => {
    const row = (over: Partial<JobRow>): JobRow =>
      ({ id: 'job_1', objective: 'Resolve Linear ENG-1', outcome: 'running', done: 0, total: 1, eventCount: 1, sharesProjectFolder: false, tasks: [], ...over }) as JobRow
    const snapshot: OrchSnapshot = { runs: [row({ source: SOURCE }), row({ id: 'job_2', objective: 'other' })], projectFolderBusy: false }
    const html = renderToStaticMarkup(
      React.createElement(JobsView, {
        snapshot,
        hostGate: null,
        stall: null,
        hasProject: true,
        canOpenSession: () => false,
        onOpenSession: () => {},
        onOpenRun: () => {},
        onNewRun: () => {},
        onPauseRun: () => {},
        onResumeRun: () => {},
        onDeleteRun: () => {},
        onRestartCoordinator: () => {}
      })
    )
    expect(html.match(/class="source-chip"/g)).toHaveLength(1)
    expect(html.indexOf('Resolve Linear ENG-1')).toBeLessThan(html.indexOf('source-chip'))
    expect(html.indexOf('source-chip')).toBeLessThan(html.indexOf('>other<'))
  })

  // The 4c review's M12: a Job run more than once is drawn as a card with its runs under it; the chip stands on its head
  it('stands on the head of a Job’s card that holds its runs', () => {
    const run = (over: Partial<JobRow>): JobRow =>
      ({ id: 'job_1', objective: 'Resolve Linear ENG-1', outcome: 'running', done: 0, total: 1, eventCount: 1, sharesProjectFolder: false, tasks: [], ...over }) as JobRow
    const card = run({ source: SOURCE, children: [run({ id: 'run_1' }), run({ id: 'run_2' })] })
    const html = renderToStaticMarkup(
      React.createElement(JobsView, {
        snapshot: { runs: [card], projectFolderBusy: false },
        hostGate: null,
        stall: null,
        hasProject: true,
        canOpenSession: () => false,
        onOpenSession: () => {},
        onOpenRun: () => {},
        onNewRun: () => {},
        onPauseRun: () => {},
        onResumeRun: () => {},
        onDeleteRun: () => {},
        onRestartCoordinator: () => {}
      })
    )
    const head = html.slice(html.indexOf('jobs-run-head'), html.indexOf('</div>', html.indexOf('jobs-run-head')))
    expect(head).toContain('source-chip')
  })

  it('stands in the header of the Job’s detail', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'plan/PlanHeader.tsx'), 'utf8')
    const head = src.slice(src.indexOf('<div className="detail-head">'), src.indexOf('</div>', src.indexOf('<div className="detail-head">')))
    expect(head).toContain('<SourceChip source={run?.source} />')
  })

  it('has its words in all four languages', async () => {
    const { CATALOGS, LANGS } = await import('../../../core/i18n')
    for (const lang of LANGS) expect((CATALOGS[lang].messages as Record<string, string>)['jobs.source.chipOpen'], lang).toContain('{label}')
  })
})
