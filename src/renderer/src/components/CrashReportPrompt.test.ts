import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CrashReportPrompt, errorShapeOf } from './CrashReportPrompt'
import { ErrorBoundary } from './ErrorBoundary'
import { CATALOGS, LANGS } from '../../../core/i18n'

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'en', t: (key: string) => key, tm: (m: unknown) => String(m) })
}))

// T27: the prompt shows the report exactly as it would be sent, before anything is sent
describe('CrashReportPrompt', () => {
  const offer = { id: 'a.json', title: 'Crash: TypeError in main', body: '**TypeError**\n- Version: 1.4.14', ask: true }

  it('shows the title and body that Send would put in the issue, and the three choices', () => {
    const html = renderToStaticMarkup(React.createElement(CrashReportPrompt, { offer, onClose: () => {} }))
    expect(html).toContain('Crash: TypeError in main')
    expect(html).toContain('- Version: 1.4.14')
    for (const k of ['crash.prompt.send', 'crash.prompt.dontSend', 'crash.prompt.never', 'crash.prompt.intro']) expect(html).toContain(k)
  })

  it('has every string in en, es, ja and ko', () => {
    for (const lang of LANGS)
      for (const k of ['crash.prompt.title', 'crash.prompt.intro', 'crash.prompt.kept', 'crash.prompt.send', 'crash.prompt.dontSend', 'crash.prompt.never', 'crash.prompt.reportLabel'])
        expect((CATALOGS[lang].messages as Record<string, string | undefined>)[k], `${lang} ${k}`).toBeTruthy()
  })
})

describe('errorShapeOf', () => {
  it('keeps the name and stack, never the message', () => {
    const e = new TypeError('sk-secret')
    expect(errorShapeOf('error', e)).toEqual({ kind: 'error', name: 'TypeError', stack: e.stack })
    expect(errorShapeOf('unhandledrejection', 'sk-secret')).toEqual({ kind: 'unhandledrejection', name: 'string', stack: '' })
  })
})

describe('ErrorBoundary Report', () => {
  it('is disabled until the report is written, then opens the prompt', () => {
    const boundary = new ErrorBoundary({ children: React.createElement('main') })
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error('x'))
    const before = renderToStaticMarkup(boundary.render() as React.ReactElement)
    expect(before).toMatch(/<button[^>]*disabled=""[^>]*>(<[^>]+>)*app\.renderErrorReport/)
    expect(before).not.toContain('crash.prompt.title')
    boundary.state = { ...boundary.state, offer: { id: 'a.json', title: 'T', body: 'B', ask: false }, reporting: true }
    expect(renderToStaticMarkup(boundary.render() as React.ReactElement)).toContain('crash.prompt.title')
  })
})
