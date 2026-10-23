import { describe, it, expect } from 'vitest'
import { editableSettingsOf } from './planSettings'
import { emptyState } from './state'
import { MAX_REVIEW_ROUNDS, type Job, type JobRun, type Task } from './types'

const NOW = '2026-10-23T00:00:00.000Z'
const job = (over: Partial<Job> = {}): Job => ({ id: 'job_a', objective: 'o', cwd: '/repo', createdAt: NOW, ...over })
const run = (over: Partial<JobRun> = {}): JobRun => ({ id: 'r1', jobId: 'job_a', ordinal: 1, createdAt: NOW, ...over })
const task = (status: Task['status']): Task =>
  ({ id: 't1', runId: 'r1', jobId: 'job_a', title: 'T', spec: 's', deps: [], status, consecutiveFailures: 0, createdAt: NOW, updatedAt: NOW }) as Task
const state = (j: Job, runs: JobRun[], tasks: Task[]) => ({ ...emptyState(), jobs: [j], runs, tasks })

describe('editableSettingsOf', () => {
  it('a running plan is editable and reports current values or defaults', () => {
    const s = editableSettingsOf(state(job({ concurrency: 2, handsOff: true }), [run()], [task('ready')]), 'job_a')!
    expect(s.concurrency).toEqual({ value: 2, editable: true })
    expect(s.handsOff.value).toBe(true)
    expect(s.reviewRounds.value).toBe(MAX_REVIEW_ROUNDS)
    expect(s.replan.value).toBe('waves')
    expect(s.delivery).toEqual({ value: 'pr', editable: true })
    expect(Object.values(s).every((f) => f.editable)).toBe(true)
  })

  it('a queued plan with no Run is editable', () => {
    expect(editableSettingsOf(state(job({ pendingStart: true }), [], []), 'job_a')!.priority.editable).toBe(true)
  })

  it('a started delivery greys only delivery', () => {
    const s = editableSettingsOf(state(job(), [run({ deliveryState: { state: 'delivering', attempts: 1 } })], [task('ready')]), 'job_a')!
    expect(s.delivery).toMatchObject({ editable: false, reason: 'deliveryStarted' })
    expect(s.concurrency.editable).toBe(true)
  })

  it('a finished plan greys everything', () => {
    const s = editableSettingsOf(state(job(), [run()], [task('completed')]), 'job_a')!
    expect(Object.values(s).every((f) => !f.editable && f.reason === 'finished')).toBe(true)
  })

  it('is undefined for an unknown plan', () => {
    expect(editableSettingsOf(emptyState(), 'nope')).toBeUndefined()
  })
})
