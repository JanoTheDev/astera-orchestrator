import { describe, expect, it } from 'vitest'
import { REPORT_FOLD_LINES, doneViewOf, foldReport, verdictOf } from './taskDoneView'

describe('doneViewOf', () => {
  it('shows the report, gaps, verdict and open changes of a completed task, in simple mode too', () => {
    expect(doneViewOf({ status: 'completed' })).toEqual({ finished: true, verdict: 'open', changes: 'open', ask: true })
  })
  it('shows a failed task its report and verdict, with the changes folded', () => {
    expect(doneViewOf({ status: 'failed' })).toEqual({ finished: true, verdict: 'open', changes: 'folded', ask: true })
  })
  it('leaves a task still in progress as it was: folded blocks, no Ask', () => {
    for (const status of ['pending', 'ready', 'dispatched', 'blocked', 'validating'] as const)
      expect(doneViewOf({ status })).toEqual({ finished: false, verdict: 'folded', changes: 'folded', ask: false })
  })
})

describe('foldReport', () => {
  const lines = (n: number): string => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')
  it('keeps a short report whole', () => {
    expect(foldReport(lines(REPORT_FOLD_LINES))).toEqual({ head: lines(REPORT_FOLD_LINES), folded: false })
  })
  it('cuts a long one at the fold and says it is folded', () => {
    const r = foldReport(lines(REPORT_FOLD_LINES + 5))
    expect(r.folded).toBe(true)
    expect(r.head.split('\n')).toHaveLength(REPORT_FOLD_LINES)
  })
})

describe('verdictOf', () => {
  const detail = { checks: [], blockingIssues: [], otherIssueCount: 0 }
  it('passed: no failed check and no blocking issue', () => {
    expect(verdictOf({ ...detail, checks: [{ status: 'passed' }, { status: 'not-run' }] })).toEqual({ state: 'passed', issues: 0 })
  })
  it('issues: counts blocking and other issues together', () => {
    expect(verdictOf({ ...detail, blockingIssues: [{}, {}], otherIssueCount: 3 })).toEqual({ state: 'issues', issues: 5 })
  })
  it('failed: a failed, timed-out or errored check', () => {
    for (const status of ['failed', 'timed-out', 'error'] as const) expect(verdictOf({ ...detail, checks: [{ status }] })?.state).toBe('failed')
  })
  it('null: nothing was checked or reviewed', () => {
    expect(verdictOf(detail)).toBeNull()
  })
})
