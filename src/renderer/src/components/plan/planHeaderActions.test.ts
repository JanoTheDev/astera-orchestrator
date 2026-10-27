import { describe, expect, it } from 'vitest'
import type { JobRow } from '../../../../core/types'
import { headerActionsOf, planActionsOf } from './planHeaderActions'

const row = (o: Partial<JobRow>): JobRow => ({ id: 'j', objective: 'o', tasks: [{}], outcome: 'running', ...o }) as unknown as JobRow
const primaries = (a: ReturnType<typeof headerActionsOf>): number => [a.primary].filter((x) => x !== null).length

describe('headerActionsOf', () => {
  it('keeps Open consoles visible on a running plan, with no finished group and no primary', () => {
    const a = headerActionsOf(row({}), true)
    expect(a).toMatchObject({ finished: false, approve: false, consoles: true, copyId: true, primary: null })
    expect(a.openPr).toBeUndefined()
    expect(a.archive).toBeUndefined()
  })

  it('makes Approve the one primary on a plan waiting for approval', () => {
    const a = headerActionsOf(row({ pendingStart: true, planned: true, planReady: true }), true)
    expect(a).toMatchObject({ finished: false, approve: true, consoles: true, primary: 'approve' })
  })

  it('a finished plan with a PR: Open PR is the primary, Archive and Copy ID beside it, consoles in the menu', () => {
    const a = headerActionsOf(row({ outcome: 'completed', pr: { at: 'x', url: 'https://gh/pr/1', number: 1 } }), true)
    expect(a).toEqual({ finished: true, approve: false, consoles: false, askMore: false, openPr: { kind: 'pr', url: 'https://gh/pr/1' }, archive: 'archive', copyId: true, primary: 'openPr' })
  })

  it('a finished plan without a remote shows its branch, and Archive is the primary', () => {
    const a = headerActionsOf(row({ outcome: 'completed', pr: { at: 'x', note: 'no remote', branch: 'astera/plan' } }), true)
    expect(a.openPr).toEqual({ kind: 'branch', branch: 'astera/plan' })
    expect(a.primary).toBe('archive')
  })

  it('a failed plan is finished too; an archived one offers Unarchive', () => {
    expect(headerActionsOf(row({ outcome: 'failed' }), true)).toMatchObject({ finished: true, archive: 'archive', primary: 'archive' })
    expect(headerActionsOf(row({ outcome: 'completed', archivedAt: 'x' }), true)).toMatchObject({ finished: true, archive: 'unarchive' })
    expect(headerActionsOf(row({ outcome: 'running', archivedAt: 'x' }), true).finished).toBe(true)
  })

  it("a Runtime's finished plan has no Archive; with no PR nothing is primary", () => {
    const a = headerActionsOf(row({ outcome: 'completed' }), false)
    expect(a.archive).toBeUndefined()
    expect(a.copyId).toBe(true)
    expect(a.primary).toBeNull()
  })

  it('a schedule template or a plan not started is never finished', () => {
    expect(headerActionsOf(row({ outcome: 'completed', schedule: {} as never }), true).finished).toBe(false)
    expect(headerActionsOf(row({ outcome: 'completed', pendingStart: true }), true).finished).toBe(false)
    expect(headerActionsOf(row({ outcome: 'checking' }), true).finished).toBe(false)
    expect(headerActionsOf(row({ outcome: 'blocked' }), true).finished).toBe(false)
  })

  it('no row: consoles only', () => {
    expect(headerActionsOf(undefined, true)).toEqual({ finished: false, approve: false, consoles: true, askMore: false, copyId: true, primary: null })
  })

  it('a planned, unarchived, finished plan of this computer makes Chat the primary', () => {
    const a = headerActionsOf(row({ outcome: 'completed', planned: true, pr: { at: 'x', url: 'u' } }), true)
    expect(a).toMatchObject({ askMore: true, primary: 'askMore', archive: 'archive' })
    expect(headerActionsOf(row({ outcome: 'failed', planned: true }), true).primary).toBe('askMore')
  })

  it('Chat on a running or waiting plan too, but never the primary; none for archived, unplanned or paired-Runtime plans', () => {
    expect(headerActionsOf(row({ outcome: 'running', planned: true }), true)).toMatchObject({ askMore: true, primary: null })
    expect(headerActionsOf(row({ pendingStart: true, planned: true, planReady: true }), true)).toMatchObject({ askMore: true, primary: 'approve' })
    expect(headerActionsOf(row({ outcome: 'completed', planned: true, archivedAt: 'x' }), true).askMore).toBe(false)
    expect(headerActionsOf(row({ outcome: 'completed' }), true).askMore).toBe(false)
    expect(headerActionsOf(row({ outcome: 'completed', planned: true }), false).askMore).toBe(false)
  })

  it('never more than one primary', () => {
    for (const o of [{}, { outcome: 'completed' as const }, { outcome: 'completed' as const, pr: { at: 'x', url: 'u' } }, { pendingStart: true, planned: true as const }])
      expect(primaries(headerActionsOf(row(o), true))).toBeLessThanOrEqual(1)
  })
})

describe('planActionsOf per plan status', () => {
  const running = { id: 't', status: 'dispatched', startedAt: 'x' }
  const wt = { worktrees: ['/w/a'] }
  const act = (o: Partial<JobRow>, local = true) => planActionsOf(row(o) as never, local)

  it('lists Copy ID in every state', () => {
    const states: Array<Partial<JobRow>> = [
      { pendingStart: true, planned: true },
      { pendingStart: true, planned: true, planReady: true },
      { outcome: 'running' },
      { paused: true },
      { dispatchHold: true },
      { stuck: 'stalled' },
      { outcome: 'failed' },
      { outcome: 'completed' },
      { outcome: 'completed', archivedAt: 'x' }
    ]
    for (const o of states) {
      expect(act(o).copyId).toBe(true)
      expect(headerActionsOf(row(o), true).copyId).toBe(true)
    }
  })

  it('planning: Reject is offered, nothing runs', () => {
    expect(act({ pendingStart: true, planned: true })).toMatchObject({ reject: true, stop: false, refreshLead: false, rename: true })
  })

  it('approve: Reject beside Approve', () => {
    expect(act({ pendingStart: true, planned: true, planReady: true })).toMatchObject({ reject: true, refreshLead: false })
    expect(headerActionsOf(row({ pendingStart: true, planned: true, planReady: true }), true).approve).toBe(true)
  })

  it('working: Stop and Refresh lead, no Reject', () => {
    expect(act({ tasks: [running] as never })).toMatchObject({ stop: true, refreshLead: true, restartLead: false, reject: false })
  })

  it('working with no coordinator: Restart lead instead of Refresh lead', () => {
    expect(act({ coordinatorMissing: true })).toMatchObject({ refreshLead: false, restartLead: true })
  })

  it('paused (stopped): the coordinator is gone, so no Refresh lead', () => {
    expect(act({ paused: true })).toMatchObject({ refreshLead: false, stop: false })
  })

  it('held: workers carry on, so Stop stays and the lead can be refreshed', () => {
    expect(act({ dispatchHold: true, tasks: [running] as never })).toMatchObject({ stop: true, refreshLead: true })
  })

  it('stalled: nothing runs, the lead can be refreshed', () => {
    expect(act({ stuck: 'stalled' })).toMatchObject({ stop: false, refreshLead: true })
  })

  it('failed and done: no Stop, no Refresh lead, no Reject', () => {
    for (const outcome of ['failed', 'completed'] as const)
      expect(act({ outcome })).toMatchObject({ stop: false, refreshLead: false, reject: false })
  })

  it('archived: no Refresh lead, no Merge everything', () => {
    expect(act({ outcome: 'running', archivedAt: 'x', ...wt })).toMatchObject({ refreshLead: false, mergeAll: false, merge: true })
  })

  it('worktrees open Merge, Merge everything and the folder; none means none', () => {
    expect(act({ ...wt })).toMatchObject({ merge: true, mergeAll: true, folder: true })
    expect(act({})).toMatchObject({ merge: false, mergeAll: false, folder: false })
    expect(act({ pendingStart: true, ...wt })).toMatchObject({ mergeAll: false })
    expect(act({ schedule: {} as never, ...wt }).merge).toBe(false)
  })

  it('Open PR follows the row in any state', () => {
    expect(act({ outcome: 'running', pr: { at: 'x', url: 'u' } }).openPr).toEqual({ kind: 'pr', url: 'u' })
    expect(act({ pr: { at: 'x', branch: 'b' } }).openPr).toEqual({ kind: 'branch', branch: 'b' })
    expect(act({}).openPr).toBeUndefined()
  })

  it("a paired Runtime's plan keeps only the read actions", () => {
    expect(act({ pendingStart: true, planned: true, coordinatorMissing: true }, false)).toMatchObject({ rename: false, reject: false, restartLead: false, refreshLead: false, copyId: true })
  })
})

describe('planActionsOf mergePr', () => {
  const act = (o: Partial<JobRow>) => planActionsOf(row(o) as never, true)
  const pr = { at: 'x', url: 'https://gh/pr/7', number: 7 }

  it('offers Merge PR for a ready, not-landed, unarchived PR', () => {
    expect(act({ outcome: 'completed', pr }).mergePr).toEqual({ url: 'https://gh/pr/7', number: 7 })
  })

  it('offers nothing for a draft, a landed, an archived or a missing PR', () => {
    expect(act({ pr: { ...pr, draft: true } }).mergePr).toBeUndefined()
    expect(act({ pr: { ...pr, landed: 'merged' } }).mergePr).toBeUndefined()
    expect(act({ pr: { ...pr, landed: 'closed' } }).mergePr).toBeUndefined()
    expect(act({ outcome: 'completed', archivedAt: 'x', pr }).mergePr).toBeUndefined()
    expect(act({ pr: { at: 'x', note: 'no remote', branch: 'b' } }).mergePr).toBeUndefined()
    expect(act({}).mergePr).toBeUndefined()
  })
})
