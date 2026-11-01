import { promises as fs } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { ARGV_BUDGET, argvLength } from '../git/argvBudget'
import { markPrReady, prBodyArgs, prStateOf, pullPathOf, READY_MUTATION, setPrBody } from './prUpdate'
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

  it('reads the body from a file with --input, never from the command line', () => {
    expect(prBodyArgs(PR, '/tmp/b.json')).toEqual(['api', '-X', 'PATCH', 'repos/o/r/pulls/7', '--input', '/tmp/b.json'])
    expect(prBodyArgs('https://github.com/o/r', '/tmp/b.json')).toBeNull()
  })

  it('updates the body over REST while gh pr edit is refused for classic projects', async () => {
    const sent: string[] = []
    const gh = fake((a) => (a[0] === 'pr' && a[1] === 'edit' ? { ok: false, stderr: CLASSIC } : {}))
    const run = async (a: string[]): Promise<GhResult> => (sent.push(await fs.readFile(a[a.indexOf('--input') + 1], 'utf8')), gh.run(a))
    expect((await setPrBody(run, PR, 'new body', '/r')).ok).toBe(true)
    expect(gh.calls).toHaveLength(1)
    expect(gh.calls[0].slice(0, 5)).toEqual(['api', '-X', 'PATCH', 'repos/o/r/pulls/7', '--input'])
    expect(JSON.parse(sent[0])).toEqual({ body: 'new body' })
  })

  // The body of a 60-Task plan: more than a Windows command line holds, starting with @ and with non-ASCII text
  it('sends a 60-Task body as JSON in a temp file: short command line, body intact, file removed afterwards', async () => {
    const body = '@' + Array.from({ length: 60 }, (_, i) => `## Task ${i}: ${'a long title '.repeat(40)}\nC:\\Users\\someone\\astera-worktrees\\Gameful-Monorepo\\${'x'.repeat(60)}\n한글 "quoted"\n`).join('\n')
    expect(body.length).toBeGreaterThan(32_000)
    let file = ''
    let argv: string[] = []
    let sent = ''
    const run = async (a: string[]): Promise<GhResult> => {
      argv = a
      file = a[a.indexOf('--input') + 1]
      sent = await fs.readFile(file, 'utf8')
      return { ok: true, stdout: '', stderr: '' }
    }
    expect((await setPrBody(run, PR, body, '/r')).ok).toBe(true)
    expect(argvLength('gh', argv)).toBeLessThan(ARGV_BUDGET)
    expect(JSON.parse(sent)).toEqual({ body })
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('removes the temp file when gh fails, and returns the failure', async () => {
    let file = ''
    const run = async (a: string[]): Promise<GhResult> => ((file = a[a.indexOf('--input') + 1]), { ok: false, stdout: '', stderr: 'spawn E2BIG', spawnError: 'E2BIG' })
    expect(await setPrBody(run, PR, 'b', '/r')).toMatchObject({ ok: false, spawnError: 'E2BIG' })
    await expect(fs.access(file)).rejects.toThrow()
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

  // T1
  it('reads a pull request state with gh pr view --json, and null when gh cannot tell', async () => {
    const merged = fake(() => ({ stdout: JSON.stringify({ state: 'MERGED', mergedAt: '2026-10-22T00:00:00Z', closedAt: '2026-10-22T00:00:00Z' }) }))
    expect(await prStateOf(merged.run, PR, '/r')).toBe('MERGED')
    expect(merged.calls).toEqual([['pr', 'view', PR, '--json', 'state,mergedAt,closedAt']])
    expect(await prStateOf(fake(() => ({ stdout: '{"state":"CLOSED"}' })).run, PR, '/r')).toBe('CLOSED')
    expect(await prStateOf(fake(() => ({ ok: false, stderr: 'HTTP 401' })).run, PR, '/r')).toBeNull()
    expect(await prStateOf(fake(() => ({ stdout: 'not json' })).run, PR, '/r')).toBeNull()
  })
})
