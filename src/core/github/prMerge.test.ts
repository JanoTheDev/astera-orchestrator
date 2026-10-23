import { describe, it, expect } from 'vitest'
import { mergePullRequest } from './prMerge'

const fail = (stderr: string, spawnError?: string) => async () => ({ ok: false, stdout: '', stderr, ...(spawnError ? { spawnError } : {}) })

describe('mergePullRequest', () => {
  it('runs gh pr merge with the method and the branch deletion', async () => {
    const calls: { args: string[]; cwd: string }[] = []
    const r = await mergePullRequest({ cwd: '/wt', number: 7, method: 'squash', deleteBranch: true }, async (args, cwd) => {
      calls.push({ args, cwd })
      return { ok: true, stdout: '', stderr: '' }
    })
    expect(r).toEqual({ ok: true })
    expect(calls).toEqual([{ args: ['pr', 'merge', '7', '--squash', '--delete-branch'], cwd: '/wt' }])
  })

  it('takes a branch when there is no number', async () => {
    let seen: string[] = []
    await mergePullRequest({ cwd: '/wt', branch: 'me/plan', method: 'merge' }, async (a) => ((seen = a), { ok: true, stdout: '', stderr: '' }))
    expect(seen).toEqual(['pr', 'merge', 'me/plan', '--merge'])
  })

  it('refuses without a target, or one that reads as a flag, before running gh', async () => {
    const never = async () => {
      throw new Error('gh ran')
    }
    expect((await mergePullRequest({ cwd: '/wt', method: 'merge' }, never)).ok).toBe(false)
    expect((await mergePullRequest({ cwd: '/wt', branch: '--admin', method: 'merge' }, never)).ok).toBe(false)
  })

  it.each([
    ['X Pull request #7 is not mergeable: the merge commit cannot be cleanly created.', 'not-mergeable'],
    ['Pull request #7 is already merged', 'already-merged'],
    ['HTTP 401: Bad credentials', 'auth'],
    ['could not resolve to a repository', 'not-found'],
    ['dial tcp: no such host', 'network'],
    ['something odd', 'other']
  ])('maps %j to %s', async (stderr, kind) => {
    const r = await mergePullRequest({ cwd: '/wt', number: 7, method: 'merge' }, fail(stderr))
    expect(r).toMatchObject({ ok: false, kind })
  })

  it('says gh is not installed', async () => {
    expect(await mergePullRequest({ cwd: '/wt', number: 7, method: 'merge' }, fail('', 'ENOENT'))).toMatchObject({ ok: false, kind: 'not-installed' })
  })
})
