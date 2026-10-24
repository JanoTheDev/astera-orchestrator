import { describe, expect, it } from 'vitest'
import type { JobTask } from '../../../../core/types'
import { durationText, planSummaryOf, type SummaryRow } from './planSummary'

const task = (status: JobTask['status'], extra: Partial<JobTask> = {}): JobTask => ({ id: status, title: status, status, ...extra }) as unknown as JobTask
const NOW = Date.parse('2026-10-24T12:00:00Z')
const row = (o: Partial<SummaryRow>): SummaryRow => ({ tasks: [], outcome: 'running', ...o }) as SummaryRow

describe('planSummaryOf', () => {
  it('counts Tasks by state, the first four always, cancelled only when there is one', () => {
    const s = planSummaryOf(
      row({ tasks: [task('completed'), task('completed'), task('dispatched', { startedAt: 'x' }), task('reviewing'), task('pending'), task('failed')] }),
      NOW
    )
    expect(s.counts).toEqual([
      { state: 'done', n: 2 },
      { state: 'running', n: 2 },
      { state: 'waiting', n: 1 },
      { state: 'failed', n: 1 }
    ])
    expect(s.total).toBe(6)
    expect(s.percent).toBe(33)
    const cancelled = planSummaryOf(row({ tasks: [task('pending', { board: { category: 'cancelled' } } as never)] }), NOW)
    expect(cancelled.counts.at(-1)).toEqual({ state: 'cancelled', n: 1 })
  })

  it('a running plan counts its time from the start (auto start first, else made), none before it starts', () => {
    expect(planSummaryOf(row({ createdAt: '2026-10-24T11:00:00Z' }), NOW).time).toEqual({ kind: 'running', ms: 3_600_000 })
    expect(planSummaryOf(row({ createdAt: '2026-10-24T09:00:00Z', autoStartedAt: '2026-10-24T11:30:00Z' }), NOW).time?.ms).toBe(1_800_000)
    expect(planSummaryOf(row({ createdAt: '2026-10-24T11:00:00Z', pendingStart: true }), NOW).time).toBeUndefined()
  })

  it('a finished plan says how long it took when it knows its finish, and nothing otherwise', () => {
    const done = planSummaryOf(row({ outcome: 'completed', createdAt: '2026-10-24T10:00:00Z', finishedAt: '2026-10-24T10:45:00Z' }), NOW)
    expect(done.time).toEqual({ kind: 'finished', ms: 2_700_000, finishedAt: '2026-10-24T10:45:00Z' })
    expect(planSummaryOf(row({ outcome: 'failed', createdAt: '2026-10-24T10:00:00Z' }), NOW).time).toBeUndefined()
  })

  it('the PR link, else the branch of a project with no remote, else a PR that failed to open', () => {
    expect(planSummaryOf(row({ pr: { at: 'x', url: 'u', number: 7, draft: true } }), NOW).link).toEqual({ kind: 'pr', url: 'u', number: 7, draft: true })
    expect(planSummaryOf(row({ pr: { at: 'x', note: 'no remote', branch: 'b' } }), NOW).link).toEqual({ kind: 'branch', branch: 'b' })
    expect(planSummaryOf(row({ pr: { at: 'x', error: 'gh failed' } }), NOW).link).toEqual({ kind: 'prFailed', error: 'gh failed' })
    expect(planSummaryOf(row({}), NOW).link).toBeUndefined()
  })

  it('the delivery state, ignoring a pending wait; then delivered by, review and dismissed', () => {
    expect(planSummaryOf(row({ delivery: { runId: 'r', state: 'failed', reason: 'conflict' } }), NOW).delivery).toEqual({ kind: 'failed', reason: 'conflict' })
    expect(planSummaryOf(row({ delivery: { runId: 'r', state: 'pending' } }), NOW).delivery).toBeUndefined()
    expect(planSummaryOf(row({ deliveredBy: { jobId: 'j2', title: 'Later' } }), NOW).delivery).toEqual({ kind: 'deliveredBy', title: 'Later' })
    expect(planSummaryOf(row({ awaitingReview: true }), NOW).delivery).toEqual({ kind: 'review' })
    expect(planSummaryOf(row({ deliveryDismissed: true }), NOW).delivery).toEqual({ kind: 'dismissed' })
  })

  it('carries the wave and the areas', () => {
    const s = planSummaryOf(row({ wave: { at: 2, of: 3 }, areas: ['src/core'] }), NOW)
    expect(s.wave).toEqual({ at: 2, of: 3 })
    expect(s.areas).toEqual(['src/core'])
    expect(planSummaryOf(row({}), NOW).areas).toEqual([])
  })
})

describe('durationText', () => {
  it('is short and coarse', () => {
    expect(durationText(10_000)).toBe('<1m')
    expect(durationText(42 * 60_000)).toBe('42m')
    expect(durationText(3 * 3_600_000)).toBe('3h')
    expect(durationText(3 * 3_600_000 + 5 * 60_000)).toBe('3h 5m')
    expect(durationText(52 * 3_600_000)).toBe('2d 4h')
    expect(durationText(48 * 3_600_000)).toBe('2d')
    expect(durationText(-5)).toBe('<1m')
  })
})
