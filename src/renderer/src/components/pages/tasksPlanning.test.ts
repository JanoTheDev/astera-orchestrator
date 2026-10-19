import { describe, expect, it } from 'vitest'
import type { JobRow, TaskBlockedReason } from '../../../../core/types'
import { planningEntriesOf, planningStageOf, stageText, waitKindOf, waitText } from './tasksPlanning'

const row = (o: Partial<JobRow>): JobRow => ({ id: 'j', objective: 'o', tasks: [], ...o }) as JobRow

describe('planningStageOf', () => {
  it('names the stage of a plan still being planned', () => {
    expect(planningStageOf(row({ pendingStart: true, planned: true, plannerSessionId: 's' }))).toBe('writing')
    expect(planningStageOf(row({ pendingStart: true, planned: true, planReady: true }))).toBe('ready')
    expect(planningStageOf(row({ pendingStart: true, after: 'a' }))).toBe('queued')
    expect(planningStageOf(row({ outcome: 'running', replanWave: 1 }))).toBe('replanning')
  })
  it('is null for plans past planning, unplanned, archived or scheduled', () => {
    expect(planningStageOf(row({ outcome: 'running' }))).toBeNull()
    expect(planningStageOf(row({ pendingStart: true }))).toBeNull()
    expect(planningStageOf(row({ pendingStart: true, planned: true, archivedAt: 'x' }))).toBeNull()
  })
})

describe('planningEntriesOf / stageText', () => {
  it('lists only planning plans and names the plan a queued one waits for', () => {
    const a = row({ id: 'a', title: 'Alpha', outcome: 'running' })
    const b = row({ id: 'b', pendingStart: true, after: 'a' })
    const entries = planningEntriesOf([a, b])
    expect(entries.map((e) => e.plan.id)).toEqual(['b'])
    expect(stageText(entries[0])).toEqual({ key: 'pages.tasks.planning.queued', params: { plan: 'Alpha' } })
  })
  it('counts the replanned wave from 1', () => {
    const [e] = planningEntriesOf([row({ replanWave: 1 })])
    expect(stageText(e).params).toEqual({ n: 2 })
  })
})

describe('waitKindOf / waitText (why a Task card waits)', () => {
  it('names another plan holding the files as a lease', () => {
    const reason = { kind: 'same-files', waitingOn: { id: 't', title: 'T' }, path: 'a.ts', plan: { id: 'p', title: 'Auth' }, delivery: true } as const
    expect(waitKindOf(reason)).toBe('lease')
    expect(waitText(reason, {})).toEqual({ key: 'pages.tasks.wait.lease', params: { plan: 'Auth' } })
  })
  it('names the plan a queued plan starts after', () => {
    const reason = { kind: 'pending-start', after: { id: 'p', title: 'Auth' } } as const
    expect(waitKindOf(reason)).toBe('queued')
    expect(waitText(reason, {})).toEqual({ key: 'pages.tasks.wait.queued', params: { plan: 'Auth' } })
  })
  it('says which wave is open for a Task waiting on its deps, or counts the deps without waves', () => {
    const reason: TaskBlockedReason = { kind: 'deps', waitingOn: [{ id: 'a', title: 'A', status: 'dispatched' }] }
    expect(waitKindOf(reason)).toBe('wave')
    expect(waitText(reason, { wave: { at: 2, of: 3 } })).toEqual({ key: 'pages.tasks.wait.wave', params: { at: 2, of: 3 } })
    expect(waitText(reason, {})).toEqual({ key: 'pages.tasks.wait.deps', params: { count: 1 } })
  })
  it('has no chip for reasons the line already says', () => {
    expect(waitKindOf({ kind: 'next' })).toBeNull()
    expect(waitKindOf(undefined)).toBeNull()
    expect(waitText({ kind: 'pending-start' }, {})).toBeNull()
  })
})
