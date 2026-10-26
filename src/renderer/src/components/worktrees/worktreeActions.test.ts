import { describe, expect, it } from 'vitest'
import type { PrInfo } from '../../../../core/github/types'
import { worktreeActions, worktreeMenu, cdCommand, type ActionFacts } from './worktreeActions'

const pr = (over: Partial<PrInfo> = {}): PrInfo => ({ number: 7, title: 't', state: 'open', isDraft: false, url: 'https://x/pull/7', checks: 'passing', ...over })
const facts = (over: Partial<ActionFacts> = {}): ActionFacts => ({ ok: true, ghConnected: true, ahead: 2, dirty: 0, pr: undefined, pushable: false, busy: false, ...over })

describe('worktreeActions', () => {
  it('no PR: Create PR is on; the PR actions are hidden', () => {
    const a = worktreeActions(facts())
    expect(a.createPr).toEqual({ show: true })
    expect(a.viewPr.show).toBe(false)
    expect(a.mergePr.show).toBe(false)
  })

  it('an open PR swaps Create PR for View and Merge', () => {
    const a = worktreeActions(facts({ pr: pr() }))
    expect(a.createPr.show).toBe(false)
    expect(a.viewPr.show).toBe(true)
    expect(a.mergePr).toEqual({ show: true })
  })

  it('a merged or closed PR leaves Create PR on', () => {
    expect(worktreeActions(facts({ pr: pr({ state: 'merged' }) })).createPr.show).toBe(true)
  })

  it('gives the reason an action is off', () => {
    expect(worktreeActions(facts({ ghConnected: false })).createPr.reason).toBe('worktree.push.ghDisconnected')
    expect(worktreeActions(facts({ ahead: 0 })).createPr.reason).toBe('worktree.push.noCommits')
    expect(worktreeActions(facts({ ahead: null })).createPr.reason).toBeUndefined()
    expect(worktreeActions(facts({ ok: false })).createPr.reason).toBe('worktrees.act.unreachable')
    expect(worktreeActions(facts({ pr: pr({ checks: 'failing' }) })).mergePr.reason).toBe('worktrees.act.prFailing')
    expect(worktreeActions(facts({ pr: pr({ isDraft: true }) })).mergePr.reason).toBe('worktrees.act.prDraft')
    expect(worktreeActions(facts({ pr: pr(), busy: true })).mergePr.reason).toBe('worktrees.act.busy')
  })

  it('Merge into base shows only for a folder a push delivery acts on, and not over a dirty or unknown tree', () => {
    expect(worktreeActions(facts()).mergeBase.show).toBe(false)
    expect(worktreeActions(facts({ pushable: true })).mergeBase).toEqual({ show: true })
    expect(worktreeActions(facts({ pushable: true, dirty: 3 })).mergeBase.reason).toBe('worktrees.act.dirty')
    expect(worktreeActions(facts({ pushable: true, dirty: null })).mergeBase.reason).toBe('worktrees.act.dirtyUnknown')
  })
})

describe('worktreeMenu', () => {
  const base = ['openHere', 'openFiles', 'terminal', 'reveal', 'copyPath']

  it('a clean or dirty worktree without a PR has no PR actions', () => {
    expect(worktreeMenu({ status: 'ok', pr: undefined })).toEqual([...base, 'remove'])
  })

  it('offers View PR and Copy PR link in every PR state', () => {
    for (const state of ['open', 'merged', 'closed'] as const)
      expect(worktreeMenu({ status: 'ok', pr: pr({ state }) })).toEqual([...base, 'viewPr', 'copyPr', 'remove'])
  })

  it('an orphan or unreachable folder offers Copy path and Delete only', () => {
    for (const status of ['orphan-dir', 'unreachable', 'git-unchecked'] as const)
      expect(worktreeMenu({ status, pr: pr() })).toEqual(['copyPath', 'remove'])
  })
})

it('cdCommand quotes a path a shell would split', () => {
  expect(cdCommand('/a/b')).toBe('cd /a/b')
  expect(cdCommand("/a b/it's")).toBe("cd '/a b/it'\\''s'")
})
