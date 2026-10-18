// W2-B acceptance: switching plans never closes a process, loses scrollback, changes cwd or routes input elsewhere.
//
// Scrollback lives in the mounted xterm; a remounted pane only gets the Host's replay ring plus a repaint
// (LINUX.md "Closing the window"). So the proof is that a plan switch changes no TerminalView's mount: every
// session keeps its slot, under the same key, in the same order, with the same props but `active`, and only the
// selected plan's terminals are shown or can take input. React keeps an instance whose element type, key and
// position are unchanged, so equal slot lists before and after mean no unmount.
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionInfo } from '../../../core/types'
import { addTab, createGroup, type PaneNode } from '../../../core/panes/tree'
import { sessionTab } from '../../../core/panes/tabId'

vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))
// The real TerminalView needs a DOM (xterm). The stand-in prints what a mount depends on.
vi.mock('../components/TerminalView', () => ({
  TerminalView: ({ session, active }: { session: SessionInfo; active: boolean }) =>
    React.createElement('div', { 'data-term': session.id, 'data-cwd': session.cwd, 'data-active': String(active) })
}))

const { PaneGrid } = await import('../components/PaneGrid')
const { scopeLayout, scopeIds, workspaceSessionIds } = await import('./workspaceTree')

const session = (id: string, cwd: string): SessionInfo => ({ id, accountId: 'acc1', cwd, status: 'running', title: id }) as SessionInfo
// Two plans' sessions: Trading's a1, a2 and Redis's b1.
const sessions = [session('a1', '/wt/a1'), session('b1', '/wt/b1'), session('a2', '/wt/a2')]

const render = (layout: PaneNode | null, activePaneId: string | null): string =>
  renderToStaticMarkup(
    React.createElement(PaneGrid, {
      layout, activePaneId, sessions, accounts: [], fileTabs: [], dirtyFileIds: new Set(), recordTabs: [], recordStatuses: {},
      browserTabs: [], browserLoading: {}, agentBusy: {}, rollStates: {}, schedStates: {}, busy: {}, draggingTabId: null,
      newDisabled: false, onFocusPane: () => {}, onSetRatio: () => {}, onDropTabIntoPane: () => {}, onRestart: () => {},
      onOpenUrl: () => {}, onOpenPath: () => {}, onOpenFolder: () => {}, mediaNonces: {}, onSelectTab: () => {},
      onCloseTab: () => {}, onNewInGroup: () => {}, onTabContextMenu: () => {}, onDragTabChange: () => {}, onDropTabInBar: () => {},
      renamingTabId: null, onRenameStart: () => {}, onRenameEnd: () => {}, renderEditor: () => null, renderRecord: () => null,
      renderBrowser: () => null, appTabInfo: () => null, renderApp: () => null
    } as never)
  )

/** Each terminal slot in mount order: [session, cwd, shown, active]. */
const slots = (html: string): Array<[string, string, boolean, boolean]> =>
  [...html.matchAll(/<div class="terminal-slot" style="([^"]*)">.*?data-term="([^"]+)" data-cwd="([^"]+)" data-active="(true|false)"/g)].map(
    (m) => [m[2], m[3], !m[1].includes('display:none'), m[4] === 'true']
  )

describe('switching plans', () => {
  // One pane holding every session, a2 (the last added) active: the user's own layout.
  let root: PaneNode = createGroup(sessionTab('a1'))
  root = addTab(root, root.id, sessionTab('b1'))
  root = addTab(root, root.id, sessionTab('a2'))
  const paneId = root.id

  it('keeps every terminal mounted, in order and with its cwd, and shows only the selected plan’s', () => {
    const all = slots(render(root, paneId))
    const trading = slots(render(scopeLayout(root, new Set(['a1', 'a2'])), paneId))
    const redis = slots(render(scopeLayout(root, new Set(['b1'])), paneId))
    const mounts = (s: typeof all): string[] => s.map(([id, cwd]) => `${id}@${cwd}`)
    expect(mounts(all)).toEqual(['a1@/wt/a1', 'b1@/wt/b1', 'a2@/wt/a2'])
    expect(mounts(trading)).toEqual(mounts(all))
    expect(mounts(redis)).toEqual(mounts(all))
    // Redis's workspace: b1 is the one shown and the one typing reaches; Trading's terminals are hidden, not gone.
    expect(redis.map(([id, , shown, active]) => [id, shown, active])).toEqual([
      ['a1', false, false],
      ['b1', true, true],
      ['a2', false, false]
    ])
    // Back to Trading: a2 is shown again in the same slot it never left.
    expect(trading.filter(([, , shown]) => shown).map(([id]) => id)).toEqual(['a2'])
  })

  it('a plan with no open session shows no terminal and gives none input, still mounting them all', () => {
    const none = slots(render(scopeLayout(root, new Set(['gone'])), paneId))
    expect(none.map(([id]) => id)).toEqual(['a1', 'b1', 'a2'])
    expect(none.some(([, , shown, active]) => shown || active)).toBe(false)
  })
})

// W6-F: a project workspace is the same kind of view, so switching projects leaves every tab running in the background.
describe('switching project workspaces', () => {
  const tree = [
    { id: 'g', name: 'gameful', path: '/repos/gameful', plans: [{ jobId: 'j', projectId: 'g', name: 'Trading', archived: false, paused: false, planner: [], coordinator: [],
      workers: [{ sessionId: 'a1', role: 'worker' as const, label: 'w', projectName: 'gameful', planName: 'Trading' }] }] },
    { id: 'x', name: 'Astera', path: '/wt/b1', plans: [] }
  ]
  // a2's tab is a plain one in Gameful's worktree; b1 is in Astera's folder
  const byWorkspace = workspaceSessionIds(tree, sessions, [{ path: '/wt/a2', repoPath: '/repos/gameful' }])
  let root: PaneNode = createGroup(sessionTab('a1'))
  root = addTab(root, root.id, sessionTab('b1'))
  root = addTab(root, root.id, sessionTab('a2'))

  it('keeps every terminal mounted with its cwd and shows only the open project’s, there and back', () => {
    const view = (projectId: string) => slots(render(scopeLayout(root, scopeIds(tree, byWorkspace, projectId, null)!), root.id))
    const gameful = view('g')
    const astera = view('x')
    const back = view('g')
    for (const v of [gameful, astera, back]) expect(v.map(([id, cwd]) => `${id}@${cwd}`)).toEqual(['a1@/wt/a1', 'b1@/wt/b1', 'a2@/wt/a2'])
    expect(astera.map(([id, , shown, active]) => [id, shown, active])).toEqual([['a1', false, false], ['b1', true, true], ['a2', false, false]])
    expect(back).toEqual(gameful)
    expect(gameful.filter(([, , shown]) => shown).map(([id]) => id)).toEqual(['a2'])
  })
})
