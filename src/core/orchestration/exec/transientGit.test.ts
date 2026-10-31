import { describe, expect, it } from 'vitest'
import type { Integration } from './integrateGit'
import { MERGE_RETRY_BACKOFF_MS, mergeRetryChoice, mergeRetryOf, transientCauseOf, transientCauseOfText } from './transientGit'

const failed = (output: string, key: 'jobs.integration.mergeFailedRestored' | 'jobs.integration.mergeFailedLeft' = 'jobs.integration.mergeFailedRestored'): Integration => ({
  kind: 'human',
  reason: `Could not merge the a branch into the folder to merge into: ${output}. The folder was put back as it was before the merge.`,
  message: { key, params: { branch: 'a', output } }
})

describe('transientCauseOfText', () => {
  it.each([
    ['fatal: Out of memory, malloc failed (tried to allocate 1048576 bytes)', 'out-of-memory'],
    ['fatal: Out of memory, realloc failed', 'out-of-memory'],
    ['fatal: Out of memory? mmap failed: Cannot allocate memory', 'out-of-memory'],
    ['error: unable to read sha1 file: Cannot allocate memory', 'out-of-memory'],
    // Windows: the C runtime's strerror(ENOMEM), Win32 errors 8, 14 and 1455
    ['fatal: mmap failed: Not enough space', 'out-of-memory'],
    ['error: Not enough memory resources are available to process this command.', 'out-of-memory'],
    ['error: Not enough storage is available to process this command.', 'out-of-memory'],
    ['fatal: The paging file is too small for this operation to complete.', 'out-of-memory'],
    ['Error: spawn ENOMEM', 'out-of-memory'],
    ['fatal: unable to create thread: Resource temporarily unavailable', 'resources'],
    ['Error: spawn git EAGAIN', 'resources'],
    ["fatal: Unable to create '/home/u/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository", 'index'],
    ["fatal: Unable to create 'C:/Users/u/repo/.git/index.lock': File exists.", 'index'],
    ['fatal: Unable to create \'C:\\Users\\u\\repo\\.git\\worktrees\\wt\\index.lock\': Permission denied', 'index'],
    ['fatal: unable to write new index file', 'index']
  ])('%s is %s', (text, cause) => {
    expect(transientCauseOfText(text)).toBe(cause)
  })

  it.each([
    'CONFLICT (content): Merge conflict in src/a.ts\nAutomatic merge failed; fix conflicts and then commit the result.',
    'error: Your local changes to the following files would be overwritten by merge:\n\tsrc/main.ts',
    'error: The following untracked working tree files would be overwritten by merge:\n\tmain/readme.md',
    'fatal: There is not enough space on the disk.',
    'fatal: refusing to merge unrelated histories',
    'merge-tree: refs/heads/nope - not something we can merge'
  ])('%s is not passing', (text) => {
    expect(transientCauseOfText(text)).toBeNull()
  })
})

describe('transientCauseOf', () => {
  it('reads git stderr in a failed merge, a failed merge-tree and a thrown error', () => {
    expect(transientCauseOf(failed('fatal: Out of memory, malloc failed (tried to allocate 8 bytes)', 'jobs.integration.mergeFailedLeft'))).toBe('out-of-memory')
    expect(
      transientCauseOf({
        kind: 'agent',
        reason: 'the app could not test whether a merges into the branch this folder is on — git merge-tree failed: fatal: Out of memory, malloc failed',
        worktrees: []
      })
    ).toBe('out-of-memory')
    expect(transientCauseOf({ kind: 'human', reason: 'Error: spawn git EAGAIN' })).toBe('resources')
  })

  it('takes a detached HEAD and an unreadable status or worktree list by their key, whatever git printed', () => {
    expect(transientCauseOf({ kind: 'human', reason: 'x', message: { key: 'jobs.integration.detachedHead', params: { folder: 'C:\\p' } } })).toBe('detached-head')
    expect(transientCauseOf({ kind: 'human', reason: 'x', message: { key: 'jobs.integration.statusUnreadable', params: { folder: '/p', error: 'timed out' } } })).toBe('unreadable')
    expect(transientCauseOf({ kind: 'human', reason: 'x', message: { key: 'jobs.integration.worktreeListUnreadable', params: { error: 'Error: EBUSY' } } })).toBe('unreadable')
  })

  it('a source worktree whose status could not be read is passing; one with uncommitted changes is not', () => {
    expect(transientCauseOf({ kind: 'merged', uncommitted: 0, unchecked: ['C:\\wt\\a'] })).toBe('unreadable')
    expect(transientCauseOf({ kind: 'merged', uncommitted: 2, unchecked: ['/wt/a'], dirty: ['/wt/b'] })).toBeNull()
    expect(transientCauseOf({ kind: 'merged', uncommitted: 0 })).toBeNull()
  })

  it('a conflict, uncommitted changes, a merge in progress and a missing git are not passing', () => {
    expect(transientCauseOf({ kind: 'agent', reason: 'git merge-tree says a does not merge cleanly into the branch this folder is on', worktrees: [] })).toBeNull()
    expect(transientCauseOf({ kind: 'human', reason: 'x', message: { key: 'jobs.integration.uncommitted', params: { count: 2 } } })).toBeNull()
    expect(transientCauseOf({ kind: 'human', reason: 'x', message: { key: 'jobs.integration.inProgress', params: { op: 'merge', marker: 'MERGE_HEAD' } } })).toBeNull()
    expect(transientCauseOf({ kind: 'human', reason: 'x', message: { key: 'jobs.integration.noGit', params: { folder: '/p' } } })).toBeNull()
    expect(transientCauseOf(failed('error: Your local changes to the following files would be overwritten by merge: main.ts'))).toBeNull()
  })
})

describe('mergeRetryOf', () => {
  const at = (ms: number): string => new Date(ms).toISOString()
  const T0 = Date.parse('2026-10-31T10:00:00.000Z')
  const retry = (n: number, ms: number) => ({ at: at(ms), kind: 'gate' as const, taskId: 'tsk_A', question: 'q', choice: mergeRetryChoice(n), why: 'git ran out of memory' })

  it('backs off 1, 2, 4, 8 and 16 minutes', () => {
    expect(MERGE_RETRY_BACKOFF_MS).toEqual([60_000, 120_000, 240_000, 480_000, 960_000])
    expect(mergeRetryChoice(1)).toBe('retry the merge in 1 min (1 of 5)')
    expect(mergeRetryChoice(5)).toBe('retry the merge in 16 min (5 of 5)')
  })

  it("counts a Task's retry decisions and times the next try from the last", () => {
    expect(mergeRetryOf(undefined, 'tsk_A')).toBeUndefined()
    const decisions = [retry(1, T0), { ...retry(1, T0), taskId: 'tsk_B' }, { ...retry(1, T0), choice: 'retry-once' }, retry(2, T0 + 60_000), retry(3, T0 + 180_000)]
    expect(mergeRetryOf(decisions, 'tsk_A')).toEqual({ tries: 3, dueAt: T0 + 180_000 + 240_000 })
    expect(mergeRetryOf(decisions, 'tsk_B')).toEqual({ tries: 1, dueAt: T0 + 60_000 })
    expect(mergeRetryOf(decisions, 'tsk_C')).toBeUndefined()
  })
})
