// W6-F: the project switcher, now the top bar's menu (W9-B). Moved from components/workspace/ProjectSwitcher.test.ts.
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionInfo } from '../../../../core/types'
import { OTHER_WORKSPACE, type WorkspaceProject } from '../../state/workspaceTree'
import { ProjectSwitcher, countsText, matchesProject, switcherItems, type SwitcherProps } from './ProjectSwitcher'
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

  it('lists All projects, each project with its dot, counts and key, then Other, then the actions', () => {
    const items = switcherItems(props())
    expect(items.map((i) => i.id)).toEqual(['all', 'g', 'a', OTHER_WORKSPACE, 'new', 'add', 'settings'])
    expect(html(items[1].label)).toMatch(/tb-psw-dot--needsYou" role="img" aria-label="needs you"><\/span><span class="tb-psw-text"><span class="tb-psw-name">gameful<\/span><\/span><span class="ui-kbd tb-sw-key"><kbd>Ctrl<\/kbd><kbd>Alt<\/kbd><kbd>1<\/kbd>/)
    expect(html(items[2].label)).toContain('tb-psw-dot--idle')
    // Ctrl+Alt+N counts the tree only: "Other" has no key
    expect(html(items[3].label)).not.toContain('ui-kbd')
  })

  it('shows the branch, plan and question counts, and a changes badge that opens Source Control (T11)', () => {
    const plan = { jobId: 'j', projectId: 'g', name: 'j', archived: false, paused: false, planner: [], coordinator: [], workers: [] }
    const busy: WorkspaceProject[] = [{ ...tree[0], plans: [{ ...plan, live: true, questions: 1 }, { ...plan, jobId: 'k', live: true }] }, tree[1]]
    const items = switcherItems(props({ tree: busy }), { git: { '/repos/gameful': { branch: 'main', dirty: 2, unpushed: 0, behind: 3 } } })
    const out = html(items[1].label)
    expect(out).toContain('main')
    expect(out).toContain('2 plans · 1 question')
    expect(out).toContain('title="3 commits behind upstream"')
    expect(items.map((i) => i.id)).toContain('changes:g')
    expect(items.map((i) => i.id)).not.toContain('changes:a')
    expect(countsText({ plans: 1, questions: 0 }, (k, p) => t('en', k, p))).toBe('1 plan')
    expect(countsText({ plans: 0, questions: 0 }, (k, p) => t('en', k, p))).toBe('')
  })

  it('nests a sub-project under its workspace; picking it opens that workspace (T11)', () => {
    const picked: (string | null)[] = []
    const items = switcherItems(props({ onSelect: (id) => picked.push(id) }), { subProjects: [{ id: 'gs', name: 'values', parentId: 'g' }] })
    expect(items.map((i) => i.id).slice(0, 4)).toEqual(['all', 'g', 'gs', 'a'])
    expect(html(items[2].label)).not.toContain('ui-kbd')
    items[2].onSelect()
    expect(picked).toEqual(['g'])
  })

  it('offers the open project’s settings and the project tools, off with their reason when nothing anchors them', () => {
    expect(switcherItems(props({ selectedId: null })).map((i) => i.id)).not.toContain('settings')
    expect(switcherItems(props({ selectedId: OTHER_WORKSPACE })).map((i) => i.id)).not.toContain('settings')
    expect(switcherItems(props({ toolsDisabledReason: 'Open a tab first' })).filter((i) => i.disabled).map((i) => i.id)).toEqual(['new', 'add', 'settings'])
  })
})

// W9-K / T5: every project opens in a window of its own; "Other" is no project and gets none.
describe('ProjectSwitcher: Open in new window', () => {
  it('gives each project row its own window action, calling onOpenWindow with its id', () => {
    const opened: (string | null)[] = []
    const items = switcherItems(props({ onOpenWindow: (id) => opened.push(id) }), { subProjects: [{ id: 'gs', name: 'values', parentId: 'g' }] })
    const ids = items.map((i) => i.id ?? '')
    expect(ids.filter((id) => id.startsWith('window:'))).toEqual(['window:g', 'window:gs', 'window:a'])
    expect(ids).not.toContain('window:' + OTHER_WORKSPACE)
    expect(items.find((i) => i.id === 'window:a')?.label).toBe('Open Astera in new window')
    items.filter((i) => i.id?.startsWith('window:')).forEach((i) => i.onSelect())
    expect(opened).toEqual(['g', 'g', 'a'])
  })

  it('has a New window action that opens an All window', () => {
    const opened: (string | null)[] = []
    const items = switcherItems(props({ onOpenWindow: (id) => opened.push(id) }))
    items.find((i) => i.id === 'newWindow')?.onSelect()
    expect(opened).toEqual([null])
  })

  it('shows none of it without onOpenWindow', () => {
    expect(switcherItems(props()).filter((i) => i.id?.startsWith('window:') || i.id === 'newWindow')).toEqual([])
  })
})

describe('ProjectSwitcher search', () => {
  it('keeps a project whose name holds the query, ignoring case and outer spaces', () => {
    expect(matchesProject('Astera Web', '  web ')).toBe(true)
    expect(matchesProject('Astera Web', '')).toBe(true)
    expect(matchesProject('Astera Web', 'gameful')).toBe(false)
  })

  it('shows a chip with a word and an icon on a project whose folder is missing or is no git repository', () => {
    const items = switcherItems(props(), { states: { '/repos/gameful': 'missing', '/repos/astera': 'notGit' } })
    expect(html(items[1].label)).toContain('Folder missing')
    expect(html(items[1].label)).toContain('<svg')
    expect(html(items[2].label)).toContain('Not a git repository')
    expect(html(switcherItems(props())[1].label)).not.toContain('ui-chip')
  })
})
