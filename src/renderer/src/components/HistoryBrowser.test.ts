import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionKind } from '../../../core/types'
import { HistoryBrowser, ScanStatus } from './HistoryBrowser'

// UnderstandingView.test.ts 와 같은 이유 — I18nProvider 의 효과는 renderToStaticMarkup 에서 돌지
// 않고 실제 window.api 도 없다. 훅을 갈아 끼우면 jsdom 없이 진짜 렌더를 볼 수 있다.
vi.mock('../i18n/I18nProvider', () => ({
  useI18n: () => ({ lang: 'ko', t: (key: string, p?: Record<string, unknown>) => (p ? `${key} ${JSON.stringify(p)}` : key), tm: (m: unknown) => String(m) })
}))

const render = (): string =>
  renderToStaticMarkup(
    React.createElement(HistoryBrowser, { accounts: [], ghostAccounts: [], defaultSessionKind: 'claude' as SessionKind, onResume: () => {} })
  )

describe('HistoryBrowser — 첫 프로젝트 페이지를 기다리는 동안', () => {
  // 보고된 결함: 목록이 오기 전에 '기록 없음'이 잠깐 보였다가 목록으로 바뀐다. 빈 projects 가
  // "아직 오지 않았다"와 "정말 없다" 둘 다를 뜻해서 생긴 일이다. 효과가 돌지 않는 첫 프레임이 바로 그 자리다.
  it("첫 페이지가 오기 전에는 '기록 없음'을 쓰지 않는다", () => {
    expect(render()).not.toContain('history.panel.empty')
  })

  it('그 자리에 불러오는 중 표시를 세운다', () => {
    const html = render()
    expect(html).toContain('history-loading')
    expect(html).toContain('ui-skeleton')
    expect(html).toContain('history.loading') // 글자가 없으므로 읽히는 이름은 aria-label 이 맡는다
  })
})

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
