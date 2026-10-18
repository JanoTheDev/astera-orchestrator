import { describe, it, expect } from 'vitest'
import { PAGE_IDS, MORE_PAGE_IDS, DEFAULT_PAGE, KEYED_PAGES, initialPage, isPageId, pageOf, pageOfSidebarPane, togglePage, viewFlagsOf } from './pages'

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

// W9-B
describe('the shell’s pages', () => {
  it('Ctrl+1…6 open the top bar’s pages in its order', () => {
    expect(KEYED_PAGES).toEqual(['agents', 'tasks', 'plans', 'inbox', 'worktrees', 'files'])
  })

  it('launch reopens the saved page, maps an old sidebar pane, and never reopens Settings or a More page', () => {
    expect(initialPage(null)).toBe('agents')
    expect(initialPage('plans')).toBe('plans')
    expect(initialPage('explorer')).toBe('files')
    expect(initialPage('jobs')).toBe('agents')
    expect(initialPage('settings')).toBe('agents')
    expect(initialPage('more:history')).toBe('agents')
  })

  // moved from core/ui/sidebar.test.ts: pressing a view's key twice puts things back
  it('a view key opens its page, and pressed again goes back to Agents', () => {
    expect(togglePage('agents', 'files')).toBe('files')
    expect(togglePage('files', 'files')).toBe('agents')
    expect(togglePage('files', 'plans')).toBe('plans')
    expect(togglePage(togglePage('agents', 'more:hiw'), 'more:hiw')).toBe('agents')
  })

  // moved from core/ui/sidebar.test.ts: one view at a time
  it('one view flag at a time, from the page that shows it', () => {
    expect(viewFlagsOf('files')).toEqual({ explorer: true, jobs: false, understanding: false })
    expect(viewFlagsOf('plans')).toEqual({ explorer: false, jobs: true, understanding: false })
    expect(viewFlagsOf('tasks')).toEqual({ explorer: false, jobs: true, understanding: false })
    expect(viewFlagsOf('more:hiw')).toEqual({ explorer: false, jobs: false, understanding: true })
    expect(viewFlagsOf('agents')).toEqual({ explorer: false, jobs: false, understanding: false })
  })
})
