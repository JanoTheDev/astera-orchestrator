import { describe, expect, it } from 'vitest'
import { activateTab, addTab, createGroup, leafOf, leaves, removeTab, type PaneNode } from '../../../core/panes/tree'
import { fileTab, parseTab, sessionTab, viewTab } from '../../../core/panes/tabId'
import { scopeLayout } from './workspaceTree'
import { adoptSessions, boundEntry, cycledTab, focusInScope, followTarget, selectionAfterBound, type OwnerPick } from './selection'

// Project A has the sessions a1 and a2 and an open file; project B has b1, or nothing.
const a1 = sessionTab('a1')
const a2 = sessionTab('a2')
const b1 = sessionTab('b1')
const fileOfA = fileTab('/A/x.ts')
const noSessions = new Set<string>()
const keepA = new Set(['a1', 'a2'])
const keepB = new Set(['b1'])

/** One group holding `tabs` in order, with `active` its active tab. */
function group(tabs: string[], active: string): { root: PaneNode; paneId: string } {
  const g = createGroup(tabs[0])
  let root: PaneNode = g
  for (const t of tabs.slice(1)) root = addTab(root, g.id, t)
  return activateTab(root, active)!
}
const activeOf = (root: PaneNode, paneId: string | null): string | null => (paneId ? leafOf(root, paneId)?.activeTabId ?? null : null)

describe('(a) a hidden tab of the old project never carries the project back', () => {
  it('after a pick of B with no sessions, no tab stays active: the pane tree has none shown', () => {
    const { root, paneId } = group([a1, a2], a1)
    expect(focusInScope(root, paneId, noSessions)).toEqual({ root, paneId: null })
  })
  it('a visible tab of the pane takes the focus from its hidden active tab, so clicking that pane stays in B', () => {
    const { root, paneId } = group([a1, fileOfA, a2], a1)
    const fixed = focusInScope(root, paneId, noSessions)!
    expect(fixed.paneId).toBe(paneId)
    expect(activeOf(fixed.root, fixed.paneId)).toBe(fileOfA)
    // that file is A's, but it took the focus without a pick: the selection stays B
    expect(followTarget({ picked: false, tab: parseTab(fileOfA), keep: noSessions, selected: 'pB', owner: 'pA' })).toBeNull()
    // it closes, and the tree promotes a2, a hidden session of A: still B, and the focus leaves a2 again
    const closed = removeTab(fixed.root, fileOfA)!
    expect(activeOf(closed, paneId)).toBe(a2)
    expect(followTarget({ picked: false, tab: parseTab(a2), keep: noSessions, selected: 'pB', owner: 'pA' })).toBeNull()
    expect(focusInScope(closed, paneId, noSessions)).toEqual({ root: closed, paneId: null })
  })
  it('a hidden pane gives the focus to the remembered tab of the scope, else its first', () => {
    const left = group([a1], a1)
    const right = createGroup(b1)
    const root: PaneNode = { kind: 'split', id: 's', dir: 'row', ratio: 0.5, a: left.root, b: right }
    expect(focusInScope(root, left.paneId, keepB)).toEqual({ root, paneId: right.id })
  })
  it('changes nothing once the active tab is shown, or for All projects', () => {
    const { root, paneId } = group([a1, b1], b1)
    expect(focusInScope(root, paneId, keepB)).toBeNull()
    expect(focusInScope(root, paneId, null)).toBeNull()
    expect(focusInScope(root, null, noSessions)).toBeNull()
  })
  it('Ctrl+PageDown walks the tabs B shows, never a hidden one', () => {
    const { root, paneId } = group([b1, a1, fileOfA, a2], b1)
    expect(cycledTab(scopeLayout(root, keepB), paneId, 1)).toBe(fileOfA)
    expect(cycledTab(scopeLayout(root, keepB), paneId, -1)).toBe(fileOfA)
    expect(cycledTab(scopeLayout(group([b1, a1], b1).root, keepB), paneId, 1)).toBeUndefined()
  })
})

describe('(b) the bound-project reply yields to a pick', () => {
  it('applies only while the owner has picked nothing', () => {
    expect(selectionAfterBound(null, 'pStored', 'pA')).toBe('pA')
    expect(selectionAfterBound({ tabId: null }, 'pB', 'pA')).toBe('pB')
    expect(selectionAfterBound({ tabId: b1 }, 'pB', 'pA')).toBe('pB')
    expect(selectionAfterBound(null, 'pStored', null)).toBe('pStored')
  })
})

describe('(c) the first poll\'s entry yields to a pick', () => {
  const { root } = group([a1, b1], b1)
  it('enters the bound project and focuses its own tab', () => {
    expect(boundEntry(null, 'pA', root, keepA)).toEqual({ projectId: 'pA', tab: a1 })
  })
  it('after a pick it keeps the picked project and its tab', () => {
    expect(boundEntry({ tabId: null }, 'pA', root, keepA)).toBeNull()
    expect(boundEntry({ tabId: b1 }, 'pA', root, keepA)).toBeNull()
  })
})

describe('(d) the startup sessions.list merges into the tabs already there', () => {
  it('builds the first group with the running session active when the tree is empty', () => {
    const out = adoptSessions(null, null, ['a1', 'b1'], 'b1', null)!
    expect(leaves(out.root).map((l) => l.tabIds)).toEqual([[a1, b1]])
    expect(activeOf(out.root, out.paneId)).toBe(b1)
  })
  it('keeps a tab the owner clicked before it answered, and the tabs already open', () => {
    const start = viewTab('start')
    const { root, paneId } = group([start, fileOfA], fileOfA)
    const pick: OwnerPick = { tabId: fileOfA }
    const out = adoptSessions(root, paneId, ['a1', 'b1'], 'b1', pick)!
    expect(leaves(out.root).flatMap((l) => l.tabIds)).toEqual([start, fileOfA, a1, b1])
    expect(out.paneId).toBe(paneId)
    expect(activeOf(out.root, out.paneId)).toBe(fileOfA)
  })
  it('without a pick the running session takes the focus, and a tab already in the tree is not placed twice', () => {
    const { root, paneId } = group([a1], a1)
    const out = adoptSessions(root, paneId, ['a1', 'b1'], 'b1', null)!
    expect(leaves(out.root).flatMap((l) => l.tabIds)).toEqual([a1, b1])
    expect(activeOf(out.root, out.paneId)).toBe(b1)
  })
})

describe('(e) a pick of a tab of another project still moves the project', () => {
  it('a clicked file tab of A, visible in B, moves the selection to A', () => {
    expect(followTarget({ picked: true, tab: parseTab(fileOfA), keep: keepB, selected: 'pB', owner: 'pA' })).toEqual({ projectId: 'pA' })
  })
  it('an "open this session" of a hidden A session moves the selection to A', () => {
    expect(followTarget({ picked: true, tab: parseTab(a1), keep: keepB, selected: 'pB', owner: 'pA' })).toEqual({ projectId: 'pA' })
  })
  it('a picked session the tree does not place yet waits, rather than moving or losing the focus', () => {
    expect(followTarget({ picked: true, tab: parseTab(a1), keep: keepB, selected: 'pB', owner: undefined })).toBe('wait')
  })
  it('never moves for a tab of the open project, or away from All projects', () => {
    expect(followTarget({ picked: true, tab: parseTab(b1), keep: keepB, selected: 'pB', owner: 'pB' })).toBeNull()
    expect(followTarget({ picked: true, tab: parseTab(fileOfA), keep: null, selected: null, owner: 'pA' })).toBeNull()
    expect(followTarget({ picked: true, tab: parseTab(a1), keep: null, selected: null, owner: 'pA' })).toBeNull()
  })
})
