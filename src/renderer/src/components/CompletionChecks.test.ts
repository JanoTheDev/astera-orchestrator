// The completion block's check list (plugin Phase 5 C13): a plugin check's summary, its findings as file:line message and
// a link to its report; a check that could not be made apart, with its reason; a skipped one in this app's words.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CATALOGS, LANGS } from '../../../core/i18n'
import type { CompletionCheckDetail } from '../../../core/types'

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'en', t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key) })
}))
const { CompletionChecks } = await import('./CompletionChecks')

const render = (checks: CompletionCheckDetail[], tails: string[] = []): string =>
  renderToStaticMarkup(React.createElement(CompletionChecks, { checks, tails: new Set(tails), onToggleTail: () => {}, onOpenLink: () => {} }))

describe('CompletionChecks', () => {
  it('a failed plugin check: its summary, each finding at its place, a warning said as one, and its report link', () => {
    const html = render([
      {
        configId: 'plugin:astera-debug-leftovers',
        name: 'Debug leftovers',
        status: 'failed',
        summary: '2 debug leftovers in 1 file',
        diagnostics: [
          { file: 'src/a.js', line: 3, message: 'adds console.log', severity: 'error' },
          { file: 'src/b.js', message: 'adds <b>TODO</b>', severity: 'warning' },
          { message: 'no file to name' }
        ],
        externalUrl: 'https://ci.example/report/1'
      }
    ])
    expect(html).toContain('jobs.convergence.check.failedNoCode')
    expect(html).toContain('2 debug leftovers in 1 file')
    expect(html).toMatch(/<span class="detail-completion-where">src\/a\.js:3<\/span><span>adds console\.log<\/span>/)
    expect(html).toContain('<span class="detail-completion-where">src/b.js</span>')
    expect(html).toContain('jobs.completion.warning: adds &lt;b&gt;TODO&lt;/b&gt;')
    expect(html).toMatch(/<li><span>no file to name<\/span><\/li>/)
    expect(html).toContain('jobs.completion.openReport')
    expect(html).toContain('title="https://ci.example/report/1"')
    expect(html).toContain('class="detail-completion-diags"')
  })

  it('a check that could not be made is drawn apart with its reason, and a skipped one says so in this app’s words', () => {
    const html = render([
      { configId: 'plugin:a', name: 'A', status: 'error', summary: 'astera-a is stopped' },
      { configId: 'plugin:b', name: 'B', status: 'not-run', skipped: true, summary: 'Skipped by a person: astera-b is stopped' }
    ])
    expect(html).toContain('detail-completion-name--error')
    expect(html).toMatch(/<p class="detail-completion-summary detail-completion-summary--error">astera-a is stopped<\/p>/)
    expect(html).toContain('jobs.convergence.check.skipped')
    expect(html).toContain('<p class="detail-completion-summary">astera-b is stopped</p>')
    expect(html).not.toContain('Skipped by a person')
  })

  it('a command check keeps its exit code and its output toggle, and an empty list draws nothing', () => {
    const html = render([{ configId: 'cfg_t', name: 'Tests', status: 'failed', exitCode: 1, outputTail: '2 failed' }], ['cfg_t'])
    expect(html).toContain('jobs.convergence.check.failed {&quot;code&quot;:1}')
    expect(html).toContain('jobs.completion.hideTail')
    expect(html).toContain('<pre class="detail-completion-tail">2 failed</pre>')
    expect(html).not.toContain('detail-completion-summary')
    expect(render([])).toBe('')
  })

  it('its words are in all four languages', () => {
    for (const key of ['jobs.completion.openReport', 'jobs.completion.warning'])
      for (const lang of LANGS) expect((CATALOGS[lang].messages as Record<string, string>)[key], `${lang} ${key}`).toBeTruthy()
  })
})
