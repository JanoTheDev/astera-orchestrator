import { describe, expect, it } from 'vitest'
import type { JobRow } from '../../../../core/types'
import { planningEntriesOf, planningStageOf, stageText } from './tasksPlanning'

const row = (o: Partial<JobRow>): JobRow => ({ id: 'j', objective: 'o', tasks: [], ...o }) as JobRow

describe('planningStageOf', () => {
  it('names the stage of a plan still being planned', () => {
    expect(planningStageOf(row({ pendingStart: true, planned: true, plannerSessionId: 's' }))).toBe('writing')
    expect(planningStageOf(row({ pendingStart: true, planned: true, planReady: true }))).toBe('ready')
    expect(planningStageOf(row({ pendingStart: true, planned: true, after: 'a' }))).toBe('queued')
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
    const b = row({ id: 'b', pendingStart: true, planned: true, after: 'a' })
    const entries = planningEntriesOf([a, b])
    expect(entries.map((e) => e.plan.id)).toEqual(['b'])
    expect(stageText(entries[0])).toEqual({ key: 'pages.tasks.planning.queued', params: { plan: 'Alpha' } })
  })
  it('counts the replanned wave from 1', () => {
    const [e] = planningEntriesOf([row({ replanWave: 1 })])
    expect(stageText(e).params).toEqual({ n: 2 })
  })
})
