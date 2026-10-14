// The "+ 소스에서" window (plugin Phase 4 J20, §3): what it shows for each state, and the pure rules under it — a
// source that is not ready is greyed and never asked, the newest search wins, a ticket's body is text, and a Job is
// made once. Static markup and pure functions: the renderer tests run in node, with no DOM.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { CATALOGS, LANGS } from '../../../core/i18n'
import type { Account } from '../../../core/types'

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'en', t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key) })
}))

const { SourceJobView, EMPTY_LIST, canMake, listAfter, madeOutcome, sourceChoice } = await import('./SourceJobModal')
type ViewProps = React.ComponentProps<typeof SourceJobView>

const SOURCES = [
  { id: 'github', displayName: 'GitHub issues', ready: true, needsProject: true },
  { id: 'astera-linear-source', displayName: 'Linear', ready: false, reason: 'astera-linear-source is disabled', needsProject: false }
]
const ACCOUNTS = [{ id: 'acc_1', label: 'one', provider: 'claude' }] as unknown as Account[]
const noop = (): void => {}

const render = (over: Partial<ViewProps> = {}): string =>
  renderToStaticMarkup(
    React.createElement(SourceJobView, {
      sources: SOURCES,
      source: '',
      query: '',
      list: EMPTY_LIST,
      picked: undefined,
      detail: null,
      detailLoading: false,
      accounts: ACCOUNTS,
      account: '',
      convergence: false,
      busy: false,
      locked: false,
      onSource: noop,
      onQuery: noop,
      onRetry: noop,
      onMore: noop,
      onPick: noop,
      onOpenJob: noop,
      onOpenLink: noop,
      onAccount: noop,
      onConvergence: noop,
      onMake: noop,
      onClose: noop,
      ...over
    } as ViewProps)
  )

describe('SourceJobView', () => {
  // Review Focus 4
  it('greys a source that is not ready, with its reason, and shows no list before a source is picked', () => {
    expect(sourceChoice(SOURCES[1])).toEqual({ value: 'astera-linear-source', label: 'Linear (astera-linear-source is disabled)', disabled: true })
    expect(sourceChoice(SOURCES[0])).toEqual({ value: 'github', label: 'GitHub issues', disabled: false })
    const html = render()
    expect(html).toMatch(/<option value="astera-linear-source" disabled="">Linear \(astera-linear-source is disabled\)<\/option>/)
    expect(html).toContain('jobs.source.sourcePick')
    expect(html).not.toContain('source-items')
  })

  it('lists the items: a Job made from one opens it, one that cannot be picked says why, and More when there is more', () => {
    const list = {
      ...EMPTY_LIST,
      items: [
        { id: 'ENG-1', title: 'Fix login', status: 'Todo', selectable: true, jobs: ['job_1'] },
        { id: '13', title: 'Add a thing', status: 'open', selectable: false, reason: 'written by a NONE', jobs: [] }
      ],
      nextCursor: 'c2'
    }
    const html = render({ source: 'github', list })
    expect(html).toContain('Fix login')
    expect(html).toMatch(/<button[^>]*class="source-exists"[^>]*>jobs\.source\.exists<\/button>/)
    expect(html).toMatch(/<li class="source-item disabled"[^>]*>.*written by a NONE/)
    expect(html).toContain('jobs.source.more')
    expect(render({ source: 'github', list: { ...list, nextCursor: undefined } })).not.toContain('jobs.source.more')
    expect(render({ source: 'github', list: { ...EMPTY_LIST, items: [] } })).toContain('jobs.source.empty')
    expect(render({ source: 'github', list: { ...list, cut: true } })).toContain('jobs.source.cut')
  })

  it('shows a source’s error in the list’s place, with Try again', () => {
    const html = render({ source: 'astera-linear-source', list: { ...EMPTY_LIST, error: 'the Linear source could not list items: 401 Unauthorized' } })
    expect(html).toContain('the Linear source could not list items: 401 Unauthorized')
    expect(html).toContain('jobs.source.retry')
    expect(html).not.toContain('jobs.source.empty')
  })

  // Review Focus 2
  it('shows a ticket’s body as the text it is, its fields beside it, and a way to the ticket', () => {
    const detail = { id: 'ENG-1', title: 'Fix login', url: 'https://linear.app/x/ENG-1', body: '<b>x</b> **y** <script>z</script>', fields: { team: 'ENG' }, selectable: true, jobs: [] }
    const html = render({ source: 'github', picked: 'ENG-1', detail })
    expect(html).toContain('<pre class="source-body">&lt;b&gt;x&lt;/b&gt; **y** &lt;script&gt;z&lt;/script&gt;</pre>')
    expect(html).not.toContain('<b>x</b>')
    expect(html).toMatch(/<th>team<\/th><td>ENG<\/td>/)
    expect(html).toContain('jobs.source.openLink')
    expect(html).toContain('jobs.source.dataHint')
  })

  it('makes the Job only with an item that can be picked and an account, and not while busy or locked', () => {
    const item = { id: 'ENG-1', title: 't', selectable: true, jobs: [] }
    expect(canMake({ item, account: 'acc_1', busy: false, locked: false })).toBe(true)
    expect(canMake({ item, account: '', busy: false, locked: false })).toBe(false)
    expect(canMake({ item: { ...item, selectable: false }, account: 'acc_1', busy: false, locked: false })).toBe(false)
    expect(canMake({ item: null, account: 'acc_1', busy: false, locked: false })).toBe(false)
    expect(canMake({ item, account: 'acc_1', busy: true, locked: false })).toBe(false)
    expect(canMake({ item, account: 'acc_1', busy: false, locked: true })).toBe(false)
    const disabledMake = (html: string): boolean => /<button class="primary" disabled="">jobs\.source\.make<\/button>/.test(html)
    expect(disabledMake(render({ source: 'github', picked: 'ENG-1', detail: item, account: '' }))).toBe(true)
    expect(disabledMake(render({ source: 'github', picked: 'ENG-1', detail: item, account: 'acc_1' }))).toBe(false)
  })
})

describe('the rules under the window', () => {
  // Review Focus 1
  it('keeps the newest search: an older answer arriving later is dropped, and More adds a page', () => {
    const asking = { ...EMPTY_LIST, seq: 2, loading: true }
    const older = listAfter(asking, 1, { ok: true, body: { items: [{ id: 'OLD', title: 'old' }] } }, false)
    expect(older).toBe(asking)
    const newer = listAfter(asking, 2, { ok: true, body: { items: [{ id: 'A', title: 'a' }], nextCursor: 'c2' } }, false)
    expect(newer).toEqual({ seq: 2, items: [{ id: 'A', title: 'a' }], nextCursor: 'c2', loading: false })
    const more = listAfter({ ...newer, seq: 3, loading: true }, 3, { ok: true, body: { items: [{ id: 'B', title: 'b' }], cut: true } }, true)
    expect(more).toEqual({ seq: 3, items: [{ id: 'A', title: 'a' }, { id: 'B', title: 'b' }], cut: true, loading: false })
    expect(listAfter(asking, 2, { ok: false, code: 'FAILED', message: 'boom' }, false)).toEqual({ seq: 2, items: [], loading: false, error: 'boom' })
  })

  // Review Focus 3: a create whose answer was lost may have made the Job: the window locks instead of offering a second
  it('says a Job was made, or why not, and locks when the answer was lost', () => {
    expect(madeOutcome({ ok: true, body: { id: 'job_1' } })).toEqual({ made: 'job_1' })
    expect(madeOutcome({ ok: false, code: 'PERMISSION_DENIED', message: '#13 cannot become a Job: closed' })).toEqual({ error: '#13 cannot become a Job: closed', lock: false })
    for (const code of ['HOST_LOST', 'TIMEOUT']) expect(madeOutcome({ ok: false, code, message: 'x' })).toEqual({ error: 'x', lock: true })
  })
})

describe('the window’s words', () => {
  it('are in all four languages', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const keys = new Set<string>()
    for (const f of ['SourceJobModal.tsx', 'JobsView.tsx'])
      for (const m of readFileSync(path.join(here, f), 'utf8').matchAll(/\bt\('(jobs\.source\.[A-Za-z.]+)'/g)) keys.add(m[1])
    expect(keys.size).toBeGreaterThan(10)
    for (const key of keys) for (const lang of LANGS) expect((CATALOGS[lang].messages as Record<string, string>)[key], `${lang} ${key}`).toBeTruthy()
  })
})
