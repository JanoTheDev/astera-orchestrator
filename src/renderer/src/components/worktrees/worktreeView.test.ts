import { afterEach, describe, expect, it } from 'vitest'
import type { WorktreeRow } from '../../../../core/worktrees/cleanup'
import { closeWorktrees, filterWorktrees, rowState, selectWorktree, showWorktrees, worktreeEntries, worktreeViewState } from './worktreeView'
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
      openSettings: () => {},
      openActivity: () => {},
      openView: () => {},
      openPanel: () => {},
      toggleSideBar: () => {},
      togglePanel: () => {}
    })
    openPage('worktrees')
    expect(worktreeViewState()).toEqual({ open: true, selected: null })
    openWorktree('/wt/b')
    expect(worktreeViewState()).toEqual({ open: true, selected: '/wt/b' })
    off()
  })
})

describe('filterWorktrees / rowState', () => {
  const row = (branch: string, status: WorktreeRow['item']['status'] = 'ok', over: Partial<WorktreeRow> = {}): WorktreeRow =>
    ({ item: { id: branch, name: branch, branch, path: `/wt/${branch}`, status }, owner: undefined, ahead: null, behind: null, dirty: null, unpushed: null, live: false, ready: false, ...over }) as WorktreeRow

  it('puts unreachable rows in one bottom group per status, and drops them when "Reachable only" is on', () => {
    const rows = [row('a'), row('b', 'unreachable'), row('c', 'unreachable'), row('d', 'orphan-dir')]
    const all = filterWorktrees(rows, '', false)
    expect(all.reachable.map((r) => r.item.branch)).toEqual(['a'])
    expect(all.trouble.map((g) => [g.status, g.rows.length])).toEqual([['unreachable', 2], ['orphan-dir', 1]])
    expect(filterWorktrees(rows, '', true).trouble).toEqual([])
  })

  it('searches branch, path, plan and task titles, case-insensitively', () => {
    const owner = { jobId: 'j', runId: 'r', plan: 'Billing', running: true, merged: false, taskIds: ['t'], taskTitles: ['Fix Login'], sessionId: undefined }
    const rows = [row('feat/x'), row('y', 'ok', { owner })]
    expect(filterWorktrees(rows, 'FEAT', false).reachable.map((r) => r.item.branch)).toEqual(['feat/x'])
    expect(filterWorktrees(rows, 'login', false).reachable.map((r) => r.item.branch)).toEqual(['y'])
    expect(filterWorktrees(rows, 'billing', false).reachable.map((r) => r.item.branch)).toEqual(['y'])
  })

  it('a live session reads active, a merged owner merged, otherwise no chip', () => {
    const owner = { jobId: 'j', runId: 'r', plan: 'P', running: false, merged: true, taskIds: [], taskTitles: [] }
    expect(rowState(row('a', 'ok', { live: true, owner }))).toBe('active')
    expect(rowState(row('a', 'ok', { owner }))).toBe('merged')
    expect(rowState(row('a'))).toBeNull()
  })
})

describe('worktreeEntries', () => {
  const row = (branch: string, status: WorktreeRow['item']['status'] = 'ok', over: Partial<WorktreeRow> = {}): WorktreeRow =>
    ({ item: { id: branch, name: branch, branch, path: `/wt/${branch}`, status }, owner: undefined, ahead: null, behind: null, dirty: null, unpushed: null, live: false, ready: false, ...over }) as WorktreeRow
  const owner = { jobId: 'j', runId: 'r', plan: 'P', running: true, merged: false, taskIds: [], taskTitles: [] }

  it('lists the reachable rows first (plans, ready, yours) and the unreachable ones last, grouped by status', () => {
    const rows = [row('lost', 'unreachable'), row('mine'), row('done', 'ok', { ready: true }), row('odd', 'orphan-dir'), row('task', 'ok', { owner }), row('gone', 'unreachable')]
    const entries = worktreeEntries(filterWorktrees(rows, '', false))
    expect(entries.map((e) => [e.row.item.branch, e.trouble])).toEqual([
      ['task', null],
      ['done', null],
      ['mine', null],
      ['lost', 'unreachable'],
      ['gone', 'unreachable'],
      ['odd', 'orphan-dir']
    ])
  })

  it('leaves the unreachable rows out when "Reachable only" is on', () => {
    const entries = worktreeEntries(filterWorktrees([row('a'), row('b', 'unreachable')], '', true))
    expect(entries.map((e) => e.row.item.branch)).toEqual(['a'])
  })
})
