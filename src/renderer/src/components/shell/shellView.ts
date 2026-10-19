// W9-B: what the top bar and the status bar say (DESIGN.md §1). Pure, so the node-only test suite reaches it.
import type { Account, Attention } from '../../../../core/types'
import type { Job, JobRun, Task } from '../../../../core/orchestration/types'
import { afterNameOf, afterQueued, afterStandOf } from '../../../../core/orchestration/after'
import { jobNameOf } from '../../../../core/orchestration/jobName'
import type { Translate } from '../checkText'

export interface ShellCounts {
  /** Live consoles: a session whose process still runs. */
  consoles: number
  /** Of those, the ones at work right now (attention `working`). */
  working: number
  /** What waits on the owner: the Inbox's "needs you" items (core/orchestration/sessionIndex.ts needsInput). */
  waiting: number
}

export function shellCounts(
  sessions: readonly { id: string; status: string }[],
  attention: Readonly<Record<string, Attention>>,
  needsYou: readonly unknown[]
): ShellCounts {
  const live = sessions.filter((s) => s.status === 'running')
  return { consoles: live.length, working: live.filter((s) => attention[s.id] === 'working').length, waiting: needsYou.length }
}

/** "Next: X starts after Y delivers" (W8-C `Job.after`): the oldest still-queued plan, "+N" for the rest, or null when
 *  nothing is queued. A plan whose predecessor stopped says so: it will not start by itself. */
export function nextQueuedLine(s: { jobs: readonly Job[]; runs: readonly JobRun[]; tasks: readonly Task[] }, t: Translate): string | null {
  const queued = s.jobs.filter(afterQueued).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const job = queued[0]
  if (!job) return null
  const state = { jobs: [...s.jobs], runs: [...s.runs], tasks: [...s.tasks] }
  const after = afterNameOf(state, job.after!)
  const line = t(afterStandOf(state, job.after!) === 'stopped' ? 'shell.next.waits' : 'shell.next.after', { plan: jobNameOf(job), after })
  return queued.length > 1 ? `${line} (+${queued.length - 1})` : line
}

/** The account the status bar and the top-bar meter show: the focused console's, else the first one. */
export function activeAccountOf(accounts: readonly Account[], focusedAccountId: string | undefined): Account | undefined {
  return accounts.find((a) => a.id === focusedAccountId) ?? accounts[0]
}
