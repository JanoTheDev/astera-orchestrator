import { describe, it, expect } from 'vitest'
import { filterSwitcherTabs, type SwitcherTab } from './tabSwitcher'

const tabs: SwitcherTab[] = [
  { tabId: 'a', title: 'claude', label: 'Hold Worker 1', planName: 'Hold', taskTitle: 'Fix login form', projectName: 'Shop' },
  { tabId: 'b', title: 'claude', label: 'Trading Coordinator', planName: 'Trading', projectName: 'Desk' },
  { tabId: 'c', title: 'README.md' }
]
const ids = (q: string): string[] => filterSwitcherTabs(tabs, q).map((t) => t.tabId)

describe('filterSwitcherTabs', () => {
  it('matches initials, like search: hw1 finds Hold Worker 1', () => {
    expect(ids('hw1')).toEqual(['a'])
  })
  it('matches the plan name', () => {
    expect(ids('trading')).toEqual(['b'])
  })
  it('matches the Task name', () => {
    expect(ids('login')).toEqual(['a'])
  })
  it('matches the tab title', () => {
    expect(ids('readme')).toEqual(['c'])
  })
  it('empty query lists every tab in order', () => {
    expect(ids('  ')).toEqual(['a', 'b', 'c'])
  })
})
