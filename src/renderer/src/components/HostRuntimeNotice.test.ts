import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HostRuntimeNotice, HostStartingNotice, hostStartingPhase, HOST_RUNTIME_NOTICE_KEYS } from './HostRuntimeNotice'
import { ErrorBoundary } from './ErrorBoundary'
import type { HostStatus } from '../../../core/types'
import { CATALOGS, LANGS } from '../../../core/i18n'

vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({
    lang: 'ko',
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
    tm: (m: unknown) => String(m)
  })
}))

const render = (props: Parameters<typeof HostRuntimeNotice>[0]): string =>
  renderToStaticMarkup(React.createElement(HostRuntimeNotice, props))

// Stage 3 task 2: putting the Host's runtime in place after an update can take many seconds, and it
// used to do that with nothing on screen. The status bar now says so, and keeps saying it is working.
describe('HostRuntimeNotice — the status bar while the Host runtime is being prepared', () => {
  it('shows nothing while nothing is being prepared', () => {
    expect(render({ state: null, nowMs: 0 })).toBe('')
    expect(render({ state: { phase: 'idle' }, nowMs: 0 })).toBe('')
  })

  it('says "Preparing the Astera Host" with the spinner the moment an install starts', () => {
    const html = render({ state: { phase: 'preparing', slow: false, startedAt: 1_000 }, nowMs: 1_200 })
    expect(html).toContain('status.hostPreparing')
    expect(html).not.toContain('status.hostPreparingSlow')
    expect(html).toContain('loading-spinner')
    expect(html).toContain('role="status"')
  })

  it('says it is still working, and for how long, once the install runs past a second', () => {
    const html = render({ state: { phase: 'preparing', slow: true, startedAt: 1_000 }, nowMs: 8_400 })
    expect(html).toContain('status.hostPreparingSlow')
    expect(html).toContain('&quot;seconds&quot;:7')
    expect(html).toContain('loading-spinner')
  })

  it('reports a failed install, with the reason in the title', () => {
    const html = render({ state: { phase: 'failed', reason: 'copy', detail: 'EBUSY node.exe' }, nowMs: 0 })
    expect(html).toContain('status.hostPrepareFailed')
    expect(html).toContain('EBUSY node.exe')
    expect(html).not.toContain('loading-spinner')
  })

  // Review of S3-T2, minor 4: the raw error is English and technical. The pill and the start of the
  // title are a short translated sentence chosen by the reason; the raw text stays as the detail.
  it('says why in a short translated sentence, one per reason, keeping the raw error as the detail', () => {
    for (const reason of ['copy', 'timeout', 'unknown'] as const) {
      const html = render({ state: { phase: 'failed', reason, detail: 'EIO: raw' }, nowMs: 0 })
      expect(html).toContain(`status.hostPrepareReason.${reason}`)
      expect(html).toContain('EIO: raw')
    }
  })

  it('has every one of its strings in all four languages', () => {
    for (const lang of LANGS) {
      for (const key of HOST_RUNTIME_NOTICE_KEYS) {
        expect(CATALOGS[lang].messages[key], `${lang}:${key}`).toBeTruthy()
      }
    }
    expect(LANGS).toEqual(expect.arrayContaining(['en', 'ko', 'ja', 'es']))
  })
})

const hostStatus = (over: Partial<HostStatus>): HostStatus => ({
  connected: false, protocol: null, hostVersion: null, startedAt: null, pid: null, problem: null,
  outdated: false, unresponsive: false, runtimeIncomplete: false, features: [], ...over
})

// Item 13: opened while the previous Host was leaving, the window sat empty for about a minute.
describe('HostStartingNotice — the window while the Host is not there yet', () => {
  it('says "starting" before the status is read and while the first connection is in flight', () => {
    expect(hostStartingPhase(null)).toBe('starting')
    expect(hostStartingPhase(hostStatus({}))).toBe('starting')
    expect(renderToStaticMarkup(React.createElement(HostStartingNotice, { status: null }))).toContain('status.hostStarting')
  })

  it('says it is waiting for the previous Host while one is leaving', () => {
    const s = hostStatus({ waitingForPreviousHost: true, problem: 'the previous Host is still shutting down' })
    expect(hostStartingPhase(s)).toBe('waitingForPrevious')
    expect(renderToStaticMarkup(React.createElement(HostStartingNotice, { status: s }))).toContain('status.hostWaitingForPrevious')
  })

  it('leaves a connected, unresponsive or failed Host to the status bar', () => {
    expect(hostStartingPhase(hostStatus({ connected: true }))).toBeNull()
    expect(hostStartingPhase(hostStatus({ unresponsive: true }))).toBeNull()
    expect(hostStartingPhase(hostStatus({ problem: 'out/main/host.js was not found' }))).toBeNull()
    expect(renderToStaticMarkup(React.createElement(HostStartingNotice, { status: hostStatus({ connected: true }) }))).toBe('')
  })
})

describe('ErrorBoundary — a render error never leaves an empty window', () => {
  // Server rendering does not run error boundaries, so the boundary's two halves are driven directly:
  // React calls getDerivedStateFromError with the throw, then renders with that state.
  it('shows the error and a reload button in place of the tree that threw', () => {
    const boundary = new ErrorBoundary({ children: React.createElement('main', null, 'workbench') })
    expect(renderToStaticMarkup(boundary.render() as React.ReactElement)).toContain('workbench')
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error('no Host yet'))
    const html = renderToStaticMarkup(boundary.render() as React.ReactElement)
    expect(html).toContain('app.renderError')
    expect(html).toContain('no Host yet')
    expect(html).toContain('app.renderErrorReload')
    expect(html).not.toContain('>workbench<') // the tag, not the word: a stack-trace path may contain it
  })
})
