import { describe, it, expect } from 'vitest'
import { PAGE_IDS, MORE_PAGE_IDS, DEFAULT_PAGE, initialPage, isPageId, pageOf, pageOfSidebarPane, togglePage, ACTIVITY_IDS, KEYED_ACTIVITY_COUNT, DEFAULT_ACTIVITY, activityOfSaved, clampSidebarWidth } from './pages'

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
  it('launch reopens the saved page, maps an old sidebar pane, and never reopens Settings or a More page', () => {
    expect(initialPage(null)).toBe('agents')
    expect(initialPage('plans')).toBe('plans')
    expect(initialPage('explorer')).toBe('files')
    expect(initialPage('jobs')).toBe('agents')
    expect(initialPage('settings')).toBe('agents')
    expect(initialPage('more:history')).toBe('agents')
    expect(initialPage('inbox')).toBe('agents')
  })

  // moved from core/ui/sidebar.test.ts: pressing a view's key twice puts things back
  it('a view key opens its page, and pressed again goes back to Agents', () => {
    expect(togglePage('agents', 'files')).toBe('files')
    expect(togglePage('files', 'files')).toBe('agents')
    expect(togglePage('files', 'plans')).toBe('plans')
    expect(togglePage(togglePage('agents', 'more:hiw'), 'more:hiw')).toBe('agents')
  })

})

describe('workbench ids', () => {
  it('lists the activities in key order', () => {
    expect(ACTIVITY_IDS).toEqual(['agents', 'plans', 'explorer', 'scm', 'history', 'run', 'devices', 'prs'])
    expect(KEYED_ACTIVITY_COUNT).toBe(6)
    expect(DEFAULT_ACTIVITY).toBe('agents')
  })
  it.each([
    ['agents', { activity: 'agents' }],
    ['plans', { activity: 'plans' }],
    ['tasks', { activity: 'plans' }],
    ['files', { activity: 'explorer' }],
    ['worktrees', { activity: 'scm' }],
    ['more:history', { activity: 'history' }],
    ['more:hiw', { activity: 'history' }],
    ['more:runs', { activity: 'run' }],
    ['inbox', { activity: 'agents', panelTab: 'needs' }],
    ['settings', { activity: 'agents' }],
    ['more:browser', { activity: 'agents' }],
    ['nonsense', { activity: 'agents' }],
    [null, { activity: 'agents' }]
  ])('activityOfSaved(%s)', (saved, want) => {
    expect(activityOfSaved(saved)).toEqual(want)
  })
  it('clamps the side bar width', () => {
    expect(clampSidebarWidth(100)).toBe(170)
    expect(clampSidebarWidth(900)).toBe(600)
    expect(clampSidebarWidth(300)).toBe(300)
    expect(clampSidebarWidth(NaN)).toBe(260)
  })
})
