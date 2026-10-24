// What an expanded row shows of a finished Task, simple mode too: the worker's report and gaps, the review verdict, and
// the changed files. Which blocks show, and whether they start open or folded, is decided here so the row only draws it.
import type { TaskStatus } from '../../../../core/orchestration/types'

/** A report longer than this many lines is cut with "Show all". */
export const REPORT_FOLD_LINES = 12

export interface DoneView {
  /** The Task ended (completed or failed): its report and gaps show, in simple mode too. */
  finished: boolean
  /** The completion block (checks, review issues, verdict) starts open. */
  verdict: 'open' | 'folded'
  /** The changed files block starts open. Lazy either way: it reads once when it opens. */
  changes: 'open' | 'folded'
  /** "Ask about this task" is offered. */
  ask: boolean
}

export function doneViewOf(task: { status: TaskStatus }): DoneView {
  const finished = task.status === 'completed' || task.status === 'failed'
  return { finished, verdict: finished ? 'open' : 'folded', changes: task.status === 'completed' ? 'open' : 'folded', ask: finished }
}

/** The report's first lines and whether the rest is folded away. */
export function foldReport(text: string, lines = REPORT_FOLD_LINES): { head: string; folded: boolean } {
  const all = text.split('\n')
  return all.length <= lines ? { head: text, folded: false } : { head: all.slice(0, lines).join('\n'), folded: true }
}

/** The review verdict, from what the completion block loads: a failed check, else any review issue, else passed. Null
 *  when nothing was checked or reviewed. */
export function verdictOf(d: {
  checks: ReadonlyArray<{ status: string }>
  blockingIssues: readonly unknown[]
  otherIssueCount: number
}): { state: 'passed' | 'issues' | 'failed'; issues: number } | null {
  const issues = d.blockingIssues.length + d.otherIssueCount
  if (d.checks.some((c) => c.status === 'failed' || c.status === 'timed-out' || c.status === 'error')) return { state: 'failed', issues }
  if (issues > 0) return { state: 'issues', issues }
  return d.checks.some((c) => c.status === 'passed') ? { state: 'passed', issues: 0 } : null
}
