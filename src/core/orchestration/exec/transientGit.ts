// T8: a merge into the plan branch that failed for a passing reason (git out of memory, a locked index, an unreadable
// git status, a briefly detached HEAD) is retried with backoff in a hands-off plan, instead of going to a merge worker
// or the owner. Pure: dispatchLoop.ts mergeIntoPlan schedules the retries and records each as a decision.
import type { MessageKey } from '../../i18n'
import type { Decision } from '../types'
import type { Integration } from './integrateGit'

/** Why an integration failed for a passing reason. */
export type TransientCause = 'out-of-memory' | 'resources' | 'index' | 'unreadable' | 'detached-head'

/** git's own wordings, posix and Windows (Git for Windows prints the C runtime's and Win32's messages). */
const TEXTS: ReadonlyArray<readonly [TransientCause, RegExp]> = [
  // "fatal: Out of memory, malloc failed (tried to allocate 1048576 bytes)", "Out of memory? mmap failed: ..."
  ['out-of-memory', /\bout of memory\b/i],
  ['out-of-memory', /\b(x?malloc|realloc|calloc|mmap) failed\b/i],
  // posix strerror(ENOMEM)
  ['out-of-memory', /\bcannot allocate memory\b/i],
  // Windows: the C runtime's strerror(ENOMEM) is "Not enough space"; Win32 errors 8 and 14. Not a full disk
  // ("There is not enough space on the disk").
  ['out-of-memory', /\bnot enough space\b(?! on the disk)/i],
  ['out-of-memory', /\bnot enough (memory|storage) (resources )?(is |are )?available\b/i],
  // Windows: the commit limit was reached (ERROR_COMMITMENT_LIMIT)
  ['out-of-memory', /\bpaging file is too small\b/i],
  ['out-of-memory', /\bENOMEM\b/],
  // "fatal: unable to create thread: Resource temporarily unavailable", a spawn's EAGAIN
  ['resources', /\bunable to create thread\b/i],
  ['resources', /\bresource temporarily unavailable\b/i],
  ['resources', /\bEAGAIN\b/],
  // "fatal: Unable to create 'C:/repo/.git/index.lock': File exists." / "Another git process seems to be running"
  ['index', /\bindex\.lock\b/i],
  ['index', /\banother git process seems to be running\b/i],
  ['index', /\bunable to write new index file\b/i]
]

/** The integration answers that are passing by what they are, whatever git printed. */
const KEYS: ReadonlyMap<MessageKey, TransientCause> = new Map<MessageKey, TransientCause>([
  ['jobs.integration.detachedHead', 'detached-head'],
  ['jobs.integration.statusUnreadable', 'unreadable'],
  ['jobs.integration.worktreeListUnreadable', 'unreadable']
])

/** The passing cause git's text names, or null. */
export function transientCauseOfText(text: string): TransientCause | null {
  return TEXTS.find(([, re]) => re.test(text))?.[0] ?? null
}

/** Why an integration failed for a passing reason, or null when it did not (a conflict, uncommitted changes, no git).
 *  A merge whose source worktree's git status could not be read (only `unchecked`, nothing `dirty`) is passing too. */
export function transientCauseOf(result: Integration): TransientCause | null {
  if (result.kind === 'merged') return (result.unchecked?.length ?? 0) > 0 && (result.dirty?.length ?? 0) === 0 ? 'unreadable' : null
  const byKey = result.kind === 'human' && result.message ? KEYS.get(result.message.key) : undefined
  return byKey ?? transientCauseOfText(result.reason)
}

/** The cause in the words of a decision's `why`. */
export function transientWhy(cause: TransientCause): string {
  switch (cause) {
    case 'out-of-memory':
      return 'git ran out of memory'
    case 'resources':
      return 'the machine had no resources to spare for git'
    case 'index':
      return "the repository's index was locked or could not be written"
    case 'unreadable':
      return 'the git status or worktree list could not be read'
    case 'detached-head':
      return "the plan folder's HEAD was detached"
  }
}

/** The kind of the Gate a merge into the plan branch that could not be made opens (dispatchLoop.ts mergeIntoPlan). */
export const MERGE_FAILED_GATE = 'merge-failed' as const
/** Its options: answered, the Task is tried again. A hands-off plan answers `retry` once (autoAnswer.ts). */
export const MERGE_FAILED_OPTIONS = ['retry'] as const

/** The waits before each retry of a transiently failed merge: 1, 2, 4, 8 and 16 minutes. Five retries per Task, then
 *  today's path (a merge worker, or the owner's Gate). */
export const MERGE_RETRY_BACKOFF_MS: readonly number[] = [1, 2, 4, 8, 16].map((m) => m * 60_000)

/** The start of a retry decision's `choice`: how a retry is told apart among a Job's decisions. */
export const MERGE_RETRY_CHOICE = 'retry the merge in '

/** The choice of the `n`th retry (1-based): "retry the merge in 4 min (3 of 5)". */
export const mergeRetryChoice = (n: number): string =>
  `${MERGE_RETRY_CHOICE}${MERGE_RETRY_BACKOFF_MS[n - 1] / 60_000} min (${n} of ${MERGE_RETRY_BACKOFF_MS.length})`

/** The retries a Job's decisions record for a Task: how many, and when the next try is due. Undefined: none. Read
 *  after a Host restart, so the count and the wait survive it. */
export function mergeRetryOf(decisions: readonly Decision[] | undefined, taskId: string): { tries: number; dueAt: number } | undefined {
  const mine = (decisions ?? []).filter((d) => d.taskId === taskId && d.choice.startsWith(MERGE_RETRY_CHOICE))
  if (mine.length === 0) return undefined
  const tries = Math.min(mine.length, MERGE_RETRY_BACKOFF_MS.length)
  return { tries, dueAt: Date.parse(mine[mine.length - 1].at) + MERGE_RETRY_BACKOFF_MS[tries - 1] }
}
