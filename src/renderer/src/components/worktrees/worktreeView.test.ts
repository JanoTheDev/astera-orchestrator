import { afterEach, describe, expect, it } from 'vitest'
import { closeWorktrees, selectWorktree, showWorktrees, worktreeViewState } from './worktreeView'
import { openPage, openWorktree, registerNavigation } from '../shell/navigation'

describe('worktreeView', () => {
  afterEach(() => {
    closeWorktrees()
    selectWorktree(null)
  })

  it('showing with a path opens the page on that worktree', () => {
    showWorktrees('/wt/a')
    expect(worktreeViewState()).toEqual({ open: true, selected: '/wt/a' })
  })

  it('showing without a path keeps the last choice; closing keeps it too', () => {
    showWorktrees('/wt/a')
    closeWorktrees()
    expect(worktreeViewState()).toEqual({ open: false, selected: '/wt/a' })
    showWorktrees()
    expect(worktreeViewState()).toEqual({ open: true, selected: '/wt/a' })
  })

  it('openWorktree(path) through the navigation contract lands on the worktree; openPage("worktrees") on the page', () => {
    const off = registerNavigation({
      openPage: (id) => id === 'worktrees' && showWorktrees(),
      openWorktree: (p) => showWorktrees(p),
      openConsole: () => {},
      openPlan: () => {},
      openInbox: () => {},
      openSettings: () => {}
    })
    openPage('worktrees')
    expect(worktreeViewState()).toEqual({ open: true, selected: null })
    openWorktree('/wt/b')
    expect(worktreeViewState()).toEqual({ open: true, selected: '/wt/b' })
    off()
  })
})
