import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScanStatus } from './HistoryBrowser'

// UnderstandingView.test.ts 와 같은 이유 — I18nProvider 의 효과는 renderToStaticMarkup 에서 돌지
// 않고 실제 window.api 도 없다. 훅을 갈아 끼우면 jsdom 없이 진짜 렌더를 볼 수 있다.
vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'ko', t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key), tm: (m: unknown) => String(m) })
}))

// The "not loaded is not empty" rule for a project's sessions moved into historyTree.test.ts (the tree's rows).

describe('ScanStatus — Codex 기록을 처음 훑는 동안', () => {
  it('훑는 중이면 진행 문구를 done/total 과 함께 세운다', () => {
    const html = renderToStaticMarkup(React.createElement(ScanStatus, { scan: { active: true, done: 12, total: 340 } }))
    expect(html).toContain('history.scan.codex')
    expect(html).toContain('12')
    expect(html).toContain('340')
    expect(html).toContain('role="status"')
  })

  it('끝났거나 소식이 없으면 아무것도 그리지 않는다', () => {
    expect(renderToStaticMarkup(React.createElement(ScanStatus, { scan: { active: false, done: 340, total: 340 } }))).toBe('')
    expect(renderToStaticMarkup(React.createElement(ScanStatus, { scan: null }))).toBe('')
  })
})
