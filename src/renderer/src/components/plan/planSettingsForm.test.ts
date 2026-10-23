import { describe, expect, it } from 'vitest'
import { DEFAULT_CONCURRENCY, MAX_CONCURRENT_WORKERS, MAX_REVIEW_ROUNDS, type Job, type JobRun, type Project } from '../../../../core/orchestration/types'
import { clampReviewRounds, clampWorkers, planSettingsFormOf, priorityChoicesOf, settingsDiff, settledValues, SETTING_REASON_KEY, type PlanSettingsValues } from './planSettingsForm'

const NOW = '2026-10-23T00:00:00.000Z'
const job = (over: Partial<Job> = {}): Job => ({ id: 'job_a', objective: 'o', cwd: '/repo', createdAt: NOW, ...over })
const run = (over: Partial<JobRun> = {}): JobRun => ({ id: 'r1', jobId: 'job_a', ordinal: 1, createdAt: NOW, ...over })
const project: Project = { id: 'p1', path: '/repo', name: 'repo', addedAt: NOW, replan: 'off', handsOff: true, concurrency: 6 }

describe('planSettingsFormOf', () => {
  it("shows the plan's own value, else its project's, else the default", () => {
    const f = planSettingsFormOf(job({ projectId: 'p1', concurrency: 2 }), run(), project, 'running')
    expect(f.values).toEqual({ concurrency: 2, priority: 0, reviewRounds: MAX_REVIEW_ROUNDS, replan: false, autoApprove: false, handsOff: true, delivery: 'pr' })
    expect(planSettingsFormOf(job(), undefined, undefined, undefined).values.concurrency).toBe(DEFAULT_CONCURRENCY)
    expect(Object.values(f.fields).every((x) => x.editable && x.reason === undefined)).toBe(true)
  })
  it('a finished plan is read-only throughout, with its reason', () => {
    const f = planSettingsFormOf(job(), run(), undefined, 'completed')
    expect(Object.values(f.fields)).toEqual(Array(7).fill({ editable: false, reason: 'finished' }))
    expect(planSettingsFormOf(job({ archivedAt: NOW }), run(), undefined, 'running').fields.priority).toEqual({ editable: false, reason: 'finished' })
  })
  it('delivery alone locks once it has started', () => {
    const f = planSettingsFormOf(job(), run({ deliveryState: { state: 'delivering', attempts: 1 } }), undefined, 'running')
    expect(f.fields.delivery).toEqual({ editable: false, reason: 'deliveryStarted' })
    expect(f.fields.concurrency.editable).toBe(true)
    expect(SETTING_REASON_KEY[f.fields.delivery.reason!]).toBe('plan.settings.reason.deliveryStarted')
  })
})

describe('clamps', () => {
  it('holds workers to 1..MAX_CONCURRENT_WORKERS and drops what is not a number', () => {
    expect(clampWorkers('4')).toBe(4)
    expect(clampWorkers('0')).toBe(1)
    expect(clampWorkers('2.6')).toBe(3)
    expect(clampWorkers('9999')).toBe(MAX_CONCURRENT_WORKERS)
    expect(clampWorkers('')).toBeNull()
    expect(clampWorkers('x')).toBeNull()
  })
  it('holds review rounds to 1..MAX_REVIEW_ROUNDS', () => {
    expect(clampReviewRounds('0')).toBe(1)
    expect(clampReviewRounds('99')).toBe(MAX_REVIEW_ROUNDS)
  })
})

describe('settingsDiff', () => {
  const base: PlanSettingsValues = { concurrency: 3, priority: 0, reviewRounds: 2, replan: true, autoApprove: false, handsOff: false, delivery: 'pr' }
  it('sends only what changed, in the words jobs-set takes', () => {
    expect(settingsDiff(base, base)).toBeNull()
    expect(settingsDiff(base, { ...base, concurrency: 5 })).toEqual({ concurrency: 5 })
    expect(settingsDiff(base, { ...base, replan: false, autoApprove: true, handsOff: true, delivery: 'push', priority: -1, reviewRounds: 3 })).toEqual({
      replan: 'off',
      autoApprove: 'on',
      handsOff: 'on',
      delivery: 'push',
      priority: -1,
      reviewRounds: 3
    })
  })
  it('reverts to the old values when the save failed', () => {
    const next = { ...base, concurrency: 5 }
    expect(settledValues(base, next, false)).toBe(base)
    expect(settledValues(base, next, true)).toBe(next)
  })
})

describe('priorityChoicesOf', () => {
  it('names low, normal and high, and keeps a number set elsewhere', () => {
    expect(priorityChoicesOf(0).map((c) => c.value)).toEqual([1, 0, -1])
    expect(priorityChoicesOf(7).map((c) => c.value)).toEqual([7, 1, 0, -1])
    expect(priorityChoicesOf(7)[0].key).toBeUndefined()
  })
})
