import { describe, expect, it } from 'vitest'
import type { PrInfo } from '../../../../core/github/types'
import { worktreeActions, type ActionFacts } from './worktreeActions'

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
