import { describe, expect, it } from 'vitest'
import { OTHER_WORKSPACE } from './workspaceTree'
import { initialScope, ownerOf, scopeFor, scopeProjectIds, switcherName } from './projectScope'

const byWorkspace = new Map<string, ReadonlySet<string>>([
  ['a', new Set(['s1'])],
  ['b', new Set(['s2'])],
  [OTHER_WORKSPACE, new Set(['s3'])]
])

describe('project scope', () => {
  it('opening a console of the selected project keeps it', () => {
    expect(scopeFor('a', ownerOf(byWorkspace, 's1'))).toBe('a')
  })

  it('opening one of another project switches to that project', () => {
    expect(scopeFor('a', ownerOf(byWorkspace, 's2'))).toBe('b')
    expect(scopeFor(null, ownerOf(byWorkspace, 's2'))).toBe('b')
  })

  it('a session not yet in the tree, or one of Other, keeps the selection', () => {
    expect(scopeFor('a', ownerOf(byWorkspace, 'new-planner'))).toBe('a')
    expect(scopeFor('a', ownerOf(byWorkspace, 's3'))).toBe('a')
  })

  it('never resets a selected project to All', () => {
    for (const s of ['s1', 's2', 's3', 'unknown']) expect(scopeFor('a', ownerOf(byWorkspace, s))).not.toBeNull()
  })

  it('names the project before the tree loads from the remembered name, never All', () => {
    expect(switcherName('a', [], 'Astera')).toEqual({ kind: 'name', name: 'Astera' })
    expect(switcherName('a', [], null)).toEqual({ kind: 'pending' })
    expect(switcherName('a', [{ id: 'a', name: 'Fresh', path: '/a', plans: [] }], 'Old')).toEqual({ kind: 'name', name: 'Fresh' })
    expect(switcherName(null, [], null)).toEqual({ kind: 'all' })
    expect(switcherName(OTHER_WORKSPACE, [], null)).toEqual({ kind: 'other' })
  })
})

describe('T6 workspace scope', () => {
  const tree = [
    { id: 'a', name: 'Astera', path: '/a', plans: [] },
    { id: 'd', name: 'design', path: '/a', plans: [], parentId: 'a' },
    { id: 'c', name: 'core', path: '/a', plans: [], parentId: 'a' }
  ]
  it('a root scopes to itself and its children, a child to itself, All to every project', () => {
    expect(scopeProjectIds(tree, 'a')).toEqual(['a', 'd', 'c'])
    expect(scopeProjectIds(tree, 'd')).toEqual(['d'])
    expect(scopeProjectIds(tree, null)).toBeNull()
  })

  it('the initial scope is the window’s stored one, never a null first frame', () => {
    expect(initialScope('a')).toEqual({ projectId: 'a', known: true })
    expect(initialScope(null)).toEqual({ projectId: null, known: true }) // All, chosen
    expect(initialScope(undefined)).toEqual({ projectId: null, known: false }) // tabs wait for main’s answer
  })
})
