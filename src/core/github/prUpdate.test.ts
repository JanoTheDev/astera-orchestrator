import { describe, it, expect } from 'vitest'
import { markPrReady, prBodyArgs, pullPathOf, READY_MUTATION, setPrBody } from './prUpdate'
import type { GhResult } from './gh'

const PR = 'https://github.com/o/r/pull/7'
const CLASSIC = 'GraphQL: Projects (classic) is being deprecated in favor of the new Projects experience'

/** A fake gh: `answer` decides each call's result, every call is recorded. */
const fake = (answer: (a: string[]) => Partial<GhResult>) => {
  const calls: string[][] = []
  const run = async (a: string[]): Promise<GhResult> => (calls.push(a), { ok: true, stdout: '', stderr: '', ...answer(a) })
  return { calls, run }
}

describe('prUpdate', () => {
  it('reads owner, repo and number from a pull request URL only', () => {
    expect(pullPathOf(PR)).toBe('repos/o/r/pulls/7')
    expect(pullPathOf('https://github.com/o/r/issues/7')).toBeNull()
  })

  it('sets the body with -f, so a body starting with @ is sent as text', () => {
    expect(prBodyArgs(PR, '@file')).toEqual(['api', '-X', 'PATCH', 'repos/o/r/pulls/7', '-f', 'body=@file'])
  })

  it('updates the body over REST while gh pr edit is refused for classic projects', async () => {
    const gh = fake((a) => (a[0] === 'pr' && a[1] === 'edit' ? { ok: false, stderr: CLASSIC } : {}))
    expect((await setPrBody(gh.run, PR, 'new body', '/r')).ok).toBe(true)
    expect(gh.calls).toEqual([['api', '-X', 'PATCH', 'repos/o/r/pulls/7', '-f', 'body=new body']])
  })

  it('refuses a URL that is not a pull request without calling gh', async () => {
    const gh = fake(() => ({}))
    expect((await setPrBody(gh.run, 'https://github.com/o/r', 'b', '/r')).ok).toBe(false)
    expect(gh.calls).toEqual([])
  })

  it('marks ready with gh pr ready, and with the mutation alone when that is refused for classic projects', async () => {
    const plain = fake(() => ({}))
    expect((await markPrReady(plain.run, PR, '/r')).ok).toBe(true)
    expect(plain.calls).toEqual([['pr', 'ready', PR]])

    const refused = fake((a) => (a[0] === 'pr' ? { ok: false, stderr: CLASSIC } : a[2] === '--jq' ? { stdout: 'PR_id\n' } : {}))
    expect((await markPrReady(refused.run, PR, '/r')).ok).toBe(true)
    expect(refused.calls.slice(1)).toEqual([
      ['api', 'repos/o/r/pulls/7', '--jq', '.node_id'],
      ['api', 'graphql', '-f', `query=${READY_MUTATION}`, '-f', 'id=PR_id']
    ])
  })

  it('a pr ready refused for another reason is that refusal', async () => {
    const gh = fake(() => ({ ok: false, stderr: 'HTTP 401' }))
    expect((await markPrReady(gh.run, PR, '/r')).stderr).toBe('HTTP 401')
    expect(gh.calls).toHaveLength(1)
  })
})
