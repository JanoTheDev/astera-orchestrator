// W6-F: the project switcher, now the top bar's menu (W9-B). Moved from components/workspace/ProjectSwitcher.test.ts.
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionInfo } from '../../../../core/types'
import { OTHER_WORKSPACE, type WorkspaceProject } from '../../state/workspaceTree'
import { ProjectSwitcher, matchesProject, switcherItems, type SwitcherProps } from './ProjectSwitcher'
import { t } from '../../../../core/i18n'

const tree: WorkspaceProject[] = [
  { id: 'g', name: 'gameful', path: '/repos/gameful', plans: [] },
  { id: 'a', name: 'Astera', path: '/repos/astera', plans: [] }
]
const props = (over: Partial<SwitcherProps> = {}): SwitcherProps => ({
  tree,
  byWorkspace: new Map([['g', new Set(['w', 'x'])], ['a', new Set<string>()], [OTHER_WORKSPACE, new Set(['o'])]]),
  sessions: ['w', 'x', 'o'].map((id) => ({ id, status: 'running' }) as SessionInfo),
  attention: { w: 'waiting' },
  selectedId: 'g',
  onSelect: () => {},
  onNew: () => {},
  onAdd: () => {},
  onSettings: () => {},
  t: (k, p) => t('en', k, p),
  ...over
})
const html = (node: React.ReactNode): string => renderToStaticMarkup(React.createElement(React.Fragment, null, node))

describe('ProjectSwitcher label', () => {
  it('never reads All projects while a project is selected, even before the tree loads', () => {
    const out = renderToStaticMarkup(React.createElement(ProjectSwitcher, props({ tree: [], selectedId: 'g' })))
    expect(out).not.toContain('All projects')
    expect(out).toContain('Switch project')
  })
})

describe('ProjectSwitcher', () => {
  it('is a text button naming the open project, with ⇅ and a dot while a project waits', () => {
    const out = renderToStaticMarkup(React.createElement(ProjectSwitcher, props()))
    expect(out).toContain('gameful')
    expect(out).toContain('tb-sw-waiting')
    expect(renderToStaticMarkup(React.createElement(ProjectSwitcher, props({ selectedId: null, attention: {} })))).toContain('All projects')
  })

  it('lists All tabs, each project with its running tabs and its key, a dot on the one waiting, then Other', () => {
    const items = switcherItems(props())
    expect(items.map((i) => i.id).slice(0, 4)).toEqual(['all', 'g', 'a', OTHER_WORKSPACE])
    expect(html(items[1].label)).toMatch(/tb-sw-waiting[^>]*><\/span><span class="tb-sw-name">gameful<\/span><span class="tb-sw-count"[^>]*>2<\/span><kbd class="tb-sw-key">Ctrl\+Alt\+1</)
    expect(html(items[2].label)).toMatch(/<span class="tb-sw-dot"><\/span><span class="tb-sw-name">Astera<\/span><span class="tb-sw-count"[^>]*>0</)
    expect(html(items[3].label)).toMatch(/Other<\/span><span class="tb-sw-count"[^>]*>1<\/span><kbd class="tb-sw-key">Ctrl\+Alt\+3</)
  })

  it('offers each real project’s settings and the project tools, off with their reason when nothing anchors them', () => {
    const ids = switcherItems(props()).map((i) => i.id)
    expect(ids).toContain('settings:g')
    expect(ids).not.toContain(`settings:${OTHER_WORKSPACE}`)
    expect(switcherItems(props({ toolsDisabledReason: 'Open a tab first' })).filter((i) => i.disabled).map((i) => i.id)).toEqual(['settings:g', 'settings:a', 'new', 'add'])
  })
})

// W9-K: each project opens in a window of its own; "Other" is no project and gets none.
describe('ProjectSwitcher: Open in new window', () => {
  it('offers the item on every project row but Other', () => {
    const items = switcherItems(props({ onOpenWindow: () => {} }))
    expect(items.find((i) => i.id === 'window:g')?.label).toBe('Open gameful in new window')
    expect(items.find((i) => i.id === 'window:a')?.label).toBe('Open Astera in new window')
    expect(items.map((i) => i.id)).not.toContain(`window:${OTHER_WORKSPACE}`)
  })
})

describe('ProjectSwitcher search', () => {
  it('keeps a project whose name holds the query, ignoring case and outer spaces', () => {
    expect(matchesProject('Astera Web', '  web ')).toBe(true)
    expect(matchesProject('Astera Web', '')).toBe(true)
    expect(matchesProject('Astera Web', 'gameful')).toBe(false)
  })
})
