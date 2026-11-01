// T26: the review rows and the live Reviewing badge.
import { describe, expect, it } from 'vitest'
import { t } from '../../../../core/i18n'
import { isReviewing, reviewRowsOf, reviewingElapsed, type TaskReview } from './reviewList'

const START = '2026-10-01T00:00:00.000Z'
const at = (s: number): string => new Date(Date.parse(START) + s * 1000).toISOString()
const review = (id: string, over: Partial<TaskReview> = {}): TaskReview => ({ id, provider: 'claude', accountId: 'a', startedAt: START, issues: [], transcript: false, ...over })

describe('reviewRowsOf', () => {
  it('lists the newest review first, with its model, verdict label and run time', () => {
    const rows = reviewRowsOf(
      [
        review('r1', { model: 'opus', endedAt: at(150), verdict: 'rejected', issues: [{ title: 'bug', severity: 'high', blocking: true }], transcript: true }),
        review('r2', { startedAt: at(300), endedAt: at(420), verdict: 'passed' })
      ],
      Date.parse(at(1000))
    )
    expect(rows.map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(rows[1]).toMatchObject({ model: 'opus', elapsed: '2:30', state: 'rejected', running: false, transcript: true })
    expect(rows[0]).toMatchObject({ model: 'claude', elapsed: '2:00', state: 'passed' })
    expect(rows.map((r) => t('en', r.label))).toEqual(['Passed', 'Rejected'])
  })

  it('counts a running review up to now and calls an ended one with no verdict stopped', () => {
    const rows = reviewRowsOf([review('run'), review('lost', { startedAt: at(-600), endedAt: at(-500) })], Date.parse(at(125)))
    expect(rows[0]).toMatchObject({ id: 'run', running: true, state: 'running', elapsed: '2:05' })
    expect(rows[1]).toMatchObject({ id: 'lost', state: 'stopped', elapsed: '1:40' })
  })

  it('folds issues beyond three', () => {
    const issues = [1, 2, 3, 4, 5].map((n) => ({ title: `i${n}`, severity: 'low', blocking: false }))
    expect(reviewRowsOf([review('r', { endedAt: at(60), verdict: 'passed', issues })], 0)[0].folded).toBe(2)
  })
})

describe('the Reviewing badge', () => {
  it('reads 2:05 for a review started 125 s ago', () => {
    expect(reviewingElapsed(START, Date.parse(START) + 125_000)).toBe('2:05')
    expect(t('en', 'plan.review.badge', { elapsed: '2:05' })).toBe('Reviewing · 2:05')
  })

  it('shows only while a reviewer runs', () => {
    expect(isReviewing({ status: 'reviewing', startedAt: START })).toBe(true)
    expect(isReviewing({ status: 'reviewing' })).toBe(false) // the reviewer has not started yet
    expect(isReviewing({ status: 'reviewing', startedAt: START, reviewerEnded: true })).toBe(false)
    expect(isReviewing({ status: 'dispatched', startedAt: START })).toBe(false)
  })
})
