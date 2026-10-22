// T9: the top bar's More menu (TopBar.tsx moreItems): plain names, an icon and one sentence each, opening their page.
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { t as translate } from '../../../../core/i18n'
import { registerNavigation, type NavigationHandlers } from './navigation'
import { moreItems } from './TopBar'

const t = ((k: Parameters<typeof translate>[1], p?: Parameters<typeof translate>[2]) => translate('en', k, p)) as never

describe('More menu', () => {
  it('lists Worktrees, History, Run configs, How it works and Browser, each with an icon and a one-line description', () => {
    const items = moreItems(t)
    expect(items.map((it) => it.id)).toEqual(['worktrees', 'more:history', 'more:runs', 'more:hiw', 'more:browser'])
    for (const it of items) {
      expect(it.icon).toBeTruthy()
      const html = renderToStaticMarkup(React.createElement(React.Fragment, null, it.label))
      expect(html).toMatch(/tb-more-desc">[^<]+\.</)
    }
  })

  it('simple mode lists Worktrees and History only', () => {
    expect(moreItems(t, false).map((it) => it.id)).toEqual(['worktrees', 'more:history'])
  })

  it('a row opens its page', () => {
    const handlers = { openPage: vi.fn() } as unknown as NavigationHandlers
    const off = registerNavigation(handlers)
    moreItems(t)[0]!.onSelect()
    expect(handlers.openPage).toHaveBeenCalledWith('worktrees')
    off()
  })
})
