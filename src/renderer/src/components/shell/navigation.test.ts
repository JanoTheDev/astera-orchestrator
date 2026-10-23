import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openActivity, openConsole, openInbox, openPage, openPanel, openPlan, openSettings, openView, openWorktree, pageTargetOf,
  registerNavigation, togglePanel, toggleSideBar, type NavigationHandlers
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
  openPage: vi.fn(),
  openConsole: vi.fn(),
  openPlan: vi.fn(),
  openInbox: vi.fn(),
  openWorktree: vi.fn(),
  openSettings: vi.fn()
})

describe('navigation registry', () => {
  afterEach(() => vi.restoreAllMocks())

  it('forwards every call to the registered handlers', () => {
    const h = handlers()
    const off = registerNavigation(h)
    openPage('files')
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
    expect(h.openPage).toHaveBeenCalledWith('files')
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
    expect(() => openPage('agents')).not.toThrow()
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
    openPage('plans')
    expect(b.openPage).toHaveBeenCalledWith('plans')
    expect(a.openPage).not.toHaveBeenCalled()
    offB()
    openPage('plans')
    expect(b.openPage).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('openPage shim (pageTargetOf)', () => {
  it('maps every old page to its side bar view, Settings to its tab and the Inbox to the panel', () => {
    expect(pageTargetOf('agents')).toEqual({ activity: 'agents' })
    expect(pageTargetOf('plans')).toEqual({ activity: 'plans' })
    expect(pageTargetOf('tasks')).toEqual({ activity: 'plans' })
    expect(pageTargetOf('files')).toEqual({ activity: 'explorer' })
    expect(pageTargetOf('worktrees')).toEqual({ activity: 'scm' })
    expect(pageTargetOf('more:history')).toEqual({ activity: 'history' })
    expect(pageTargetOf('more:hiw')).toEqual({ activity: 'history' })
    expect(pageTargetOf('more:runs')).toEqual({ activity: 'run' })
    expect(pageTargetOf('settings')).toEqual({ view: 'settings' })
    expect(pageTargetOf('inbox')).toEqual({ panel: 'needs' })
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
