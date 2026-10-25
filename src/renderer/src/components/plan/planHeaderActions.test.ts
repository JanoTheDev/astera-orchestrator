import { describe, expect, it } from 'vitest'
import type { JobRow } from '../../../../core/types'
import { headerActionsOf } from './planHeaderActions'

const row = (o: Partial<JobRow>): JobRow => ({ id: 'j', objective: 'o', tasks: [{}], outcome: 'running', ...o }) as unknown as JobRow
const primaries = (a: ReturnType<typeof headerActionsOf>): number => [a.primary].filter((x) => x !== null).length

describe('headerActionsOf', () => {
  it('keeps Open consoles visible on a running plan, with no finished group and no primary', () => {
    const a = headerActionsOf(row({}), true)
    expect(a).toMatchObject({ finished: false, approve: false, consoles: true, copyId: false, primary: null })
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
    expect(headerActionsOf(undefined, true)).toEqual({ finished: false, approve: false, consoles: true, askMore: false, copyId: false, primary: null })
  })

  it('a planned, unarchived, finished plan of this computer makes Ask & plan more the primary', () => {
    const a = headerActionsOf(row({ outcome: 'completed', planned: true, pr: { at: 'x', url: 'u' } }), true)
    expect(a).toMatchObject({ askMore: true, primary: 'askMore', archive: 'archive' })
    expect(headerActionsOf(row({ outcome: 'failed', planned: true }), true).primary).toBe('askMore')
  })

  it('no Ask & plan more on a running, archived, unplanned or paired-Runtime plan', () => {
    expect(headerActionsOf(row({ outcome: 'running', planned: true }), true).askMore).toBe(false)
    expect(headerActionsOf(row({ outcome: 'completed', planned: true, archivedAt: 'x' }), true).askMore).toBe(false)
    expect(headerActionsOf(row({ outcome: 'completed' }), true).askMore).toBe(false)
    expect(headerActionsOf(row({ outcome: 'completed', planned: true }), false).askMore).toBe(false)
  })

  it('never more than one primary', () => {
    for (const o of [{}, { outcome: 'completed' as const }, { outcome: 'completed' as const, pr: { at: 'x', url: 'u' } }, { pendingStart: true, planned: true as const }])
      expect(primaries(headerActionsOf(row(o), true))).toBeLessThanOrEqual(1)
  })
})
