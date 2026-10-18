import { afterEach, describe, expect, it, vi } from 'vitest'
import { openConsole, openInbox, openPage, openPlan, openSettings, openWorktree, registerNavigation, type NavigationHandlers } from './navigation'

const handlers = (): NavigationHandlers => ({
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
    openSettings('worktree', 'root')
    expect(h.openPage).toHaveBeenCalledWith('files')
    expect(h.openConsole).toHaveBeenCalledWith('s1')
    expect(h.openPlan).toHaveBeenCalledWith('j1', 'tasks')
    expect(h.openInbox).toHaveBeenCalledWith('waiting')
    expect(h.openWorktree).toHaveBeenCalledWith('/wt/a')
    expect(h.openSettings).toHaveBeenCalledWith('worktree', 'root')
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
