import { describe, it, expect } from 'vitest'
import { PAGE_IDS, MORE_PAGE_IDS, DEFAULT_PAGE, isPageId, pageOf, pageOfSidebarPane } from './pages'

describe('pages', () => {
  it('the contract ids (PLAN.md "Wave 9 contracts")', () => {
    expect(PAGE_IDS).toEqual(['agents', 'tasks', 'plans', 'inbox', 'worktrees', 'files', 'settings'])
    expect(MORE_PAGE_IDS).toEqual(['more:history', 'more:hiw', 'more:browser', 'more:runs'])
    expect(DEFAULT_PAGE).toBe('agents')
  })

  it('isPageId accepts every page and nothing else', () => {
    for (const id of [...PAGE_IDS, ...MORE_PAGE_IDS]) expect(isPageId(id)).toBe(true)
    for (const v of ['explorer', 'more', 'more:', '', null, 3]) expect(isPageId(v)).toBe(false)
  })

  it('a saved sidebarPane maps to agents, except explorer → files (DESIGN.md §13)', () => {
    expect(pageOfSidebarPane('explorer')).toBe('files')
    for (const v of ['sessions', 'jobs', 'understanding', 'nonsense', undefined]) expect(pageOfSidebarPane(v)).toBe('agents')
  })

  it('pageOf keeps a page id and maps anything else', () => {
    expect(pageOf('inbox')).toBe('inbox')
    expect(pageOf('more:hiw')).toBe('more:hiw')
    expect(pageOf('explorer')).toBe('files')
    expect(pageOf('jobs')).toBe('agents')
  })
})
