import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openActivity, openConsole, openFile, openInbox, openPanel, openPlan, openSettings, openView, openWorktree,
  registerNavigation, revealRunConfigs, togglePanel, toggleSideBar, type NavigationHandlers
} from './navigation'
import { placeViewTab } from '../../../../core/panes/place'
import { leaves } from '../../../../core/panes/tree'
import { viewTab } from '../../../../core/panes/tabId'

const handlers = (): NavigationHandlers => ({
  openActivity: vi.fn(),
  openView: vi.fn(),
  openPanel: vi.fn(),
  toggleSideBar: vi.fn(),
  togglePanel: vi.fn(),
  openConsole: vi.fn(),
  openPlan: vi.fn(),
  openInbox: vi.fn(),
  openWorktree: vi.fn(),
  openSettings: vi.fn(),
  openFile: vi.fn(),
  startSession: vi.fn(async () => null),
  openTerminalAt: vi.fn(async () => {})
})

describe('navigation registry', () => {
  afterEach(() => vi.restoreAllMocks())

  it('forwards every call to the registered handlers', () => {
    const h = handlers()
    const off = registerNavigation(h)
    openConsole('s1')
    openPlan('j1', 'tasks')
    openInbox('waiting')
    openWorktree('/wt/a')
    openSettings('advanced', 'worktreeRoot')
    openActivity('scm')
    openView('plan', 'j1')
    openView('welcome')
    openPanel('terminal')
    toggleSideBar()
    togglePanel()
    openFile('/wt/a/src/x.ts', { line: 12 })
    expect(h.openFile).toHaveBeenCalledWith('/wt/a/src/x.ts', { line: 12 })
    expect(h.openConsole).toHaveBeenCalledWith('s1')
    expect(h.openPlan).toHaveBeenCalledWith('j1', 'tasks')
    expect(h.openInbox).toHaveBeenCalledWith('waiting')
    expect(h.openWorktree).toHaveBeenCalledWith('/wt/a')
    expect(h.openSettings).toHaveBeenCalledWith('advanced', 'worktreeRoot')
    expect(h.openActivity).toHaveBeenCalledWith('scm')
    expect(h.openView).toHaveBeenNthCalledWith(1, 'plan', 'j1')
    expect(h.openView).toHaveBeenNthCalledWith(2, 'welcome')
    expect(h.openPanel).toHaveBeenCalledWith('terminal')
    expect(h.toggleSideBar).toHaveBeenCalledTimes(1)
    expect(h.togglePanel).toHaveBeenCalledTimes(1)
    off()
  })

  it('is a no-op that warns when nothing is registered', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => openActivity('agents')).not.toThrow()
    expect(() => openConsole('s1')).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('unregistering only removes the handlers it installed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = handlers()
    const b = handlers()
    const offA = registerNavigation(a)
    const offB = registerNavigation(b)
    offA() // stale: b is installed now
    openActivity('plans')
    expect(b.openActivity).toHaveBeenCalledWith('plans')
    expect(a.openActivity).not.toHaveBeenCalled()
    offB()
    openActivity('plans')
    expect(b.openActivity).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('openView placement (placeViewTab)', () => {
  it('opens a view tab once; opening it again focuses the same tab in whichever group holds it', () => {
    const plan = viewTab('plan', 'j1')
    const first = placeViewTab(null, plan)
    const withOther = placeViewTab(first.root, viewTab('settings'), first.paneId)
    const again = placeViewTab(withOther.root, plan, withOther.paneId)
    expect(leaves(again.root!).flatMap((l) => l.tabIds).filter((id) => id === plan)).toHaveLength(1)
    expect(again.paneId).toBe(first.paneId)
  })
})

describe('revealRunConfigs', () => {
  it('opens the Run view first, then raises the focus flag', () => {
    const h = handlers()
    const calls: string[] = []
    h.openActivity = vi.fn(() => void calls.push('open'))
    const off = registerNavigation(h)
    revealRunConfigs(() => calls.push('raise'))
    expect(h.openActivity).toHaveBeenCalledWith('run')
    expect(calls).toEqual(['open', 'raise'])
    off()
  })
})
