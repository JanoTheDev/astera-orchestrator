import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { GhResult } from './gh'
import {
  createTaskIssue,
  findExistingIssue,
  hasIssueWorkflow,
  mergeLinks,
  pickExistingIssue,
  planPrBody,
  planPrTasksOf,
  prNumberOf,
  rangeCommits,
  taskMarker
} from './taskLinks'
import { emptyState } from '../orchestration/state'
import type { Dispatch, Task } from '../orchestration/types'

/** A gh that answers by the `--search` value (or the whole argv) and records every call. */
const fakeGh = (answer: (args: string[]) => Partial<GhResult> | undefined) => {
  const calls: string[][] = []
  const run = async (args: string[]): Promise<GhResult> => {
    calls.push(args)
    const a = answer(args)
    return a ? { ok: true, stdout: '', stderr: '', ...a } : { ok: false, stdout: '', stderr: `unexpected: ${args.join(' ')}` }
  }
  return { run, calls }
}
const searchOf = (args: string[]): string => args[args.indexOf('--search') + 1]
const row = (o: Partial<{ number: number; title: string; body: string; state: string }>) => ({
  number: 1, title: 'x', url: `https://github.com/o/r/issues/${o.number ?? 1}`, body: '', state: 'OPEN', ...o
})

describe('pickExistingIssue', () => {
  it('finds the issue by its marker or its title (case and spaces aside), open first', () => {
    const rows = [row({ number: 1, title: 'Add login ', state: 'CLOSED' }), row({ number: 2, title: 'add login' })]
    expect(pickExistingIssue(rows, { title: 'Add login', taskId: 't1' })?.number).toBe(2)
    expect(pickExistingIssue([row({ number: 3, body: `x ${taskMarker('t1')} y` })], { title: 'other', taskId: 't1' })?.number).toBe(3)
    expect(pickExistingIssue([row({ title: 'Add logout' })], { title: 'Add login', taskId: 't1' })).toBeNull()
  })
})

describe('findExistingIssue: no duplicates, and it never creates', () => {
  it('finds an existing issue by title when the marker search is empty', async () => {
    const gh = fakeGh((a) =>
      a[1] === 'list' ? { stdout: JSON.stringify(searchOf(a).includes('in:title') ? [row({ number: 7, title: 'Add login' })] : []) } : undefined
    )
    const r = await findExistingIssue(gh.run, '/repo', { title: 'Add login', taskId: 't1' })
    expect(r).toEqual({ ok: true, issue: expect.objectContaining({ number: 7 }) })
    expect(gh.calls.map(searchOf)).toEqual([`"${taskMarker('t1')}" in:body`, '"Add login" in:title'])
    expect(gh.calls.every((c) => c[0] === 'issue' && c[1] === 'list')).toBe(true)
  })

  it('stops at the marker search when it hits', async () => {
    const gh = fakeGh(() => ({ stdout: JSON.stringify([row({ number: 4, body: taskMarker('t1') })]) }))
    const r = await findExistingIssue(gh.run, '/repo', { title: 'T', taskId: 't1' })
    expect(r.ok && r.issue?.number).toBe(4)
    expect(gh.calls).toHaveLength(1)
  })

  it('answers null when nothing matches, and a gh failure as one', async () => {
    const none = fakeGh(() => ({ stdout: JSON.stringify([row({ title: 'unrelated' })]) }))
    expect(await findExistingIssue(none.run, '/repo', { title: 'T', taskId: 't1' })).toEqual({ ok: true, issue: null })
    expect(none.calls.some((c) => c[1] === 'create')).toBe(false)
    const down = fakeGh(() => ({ ok: false, stderr: 'dial tcp: no such host' }))
    expect(await findExistingIssue(down.run, '/repo', { title: 'T', taskId: 't1' })).toMatchObject({ ok: false, kind: 'network' })
  })
})

describe('hasIssueWorkflow', () => {
  it("is true when the repository's CLAUDE.md says how issues are made, false otherwise", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-links-'))
    try {
      expect(await hasIssueWorkflow(dir)).toBe(false)
      await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Rules\nKeep functions small.\n')
      expect(await hasIssueWorkflow(dir)).toBe(false)
      await fs.mkdir(path.join(dir, '.claude'), { mode: 0o700 })
      await fs.writeFile(path.join(dir, '.claude', 'CLAUDE.md'), 'Before work, run `gh issue create` and add it to the GitHub Project.')
      expect(await hasIssueWorkflow(dir)).toBe(true)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('createTaskIssue', () => {
  it('puts the marker in the body and reads the number from the URL gh prints', async () => {
    const gh = fakeGh(() => ({ stdout: 'Creating issue in o/r\n\nhttps://github.com/o/r/issues/42' }))
    expect(await createTaskIssue(gh.run, '/repo', { title: 'T', body: 'do it', taskId: 't1' })).toEqual({
      ok: true,
      issue: { number: 42, url: 'https://github.com/o/r/issues/42' }
    })
    expect(gh.calls[0].slice(0, 2)).toEqual(['issue', 'create'])
    expect(gh.calls[0][gh.calls[0].indexOf('--body') + 1]).toContain(taskMarker('t1'))
  })
})

describe('mergeLinks', () => {
  it('replaces the issue and branch, and unions PRs by number and commits in order', () => {
    const a = mergeLinks(undefined, { issue: { number: 1, url: 'u1' }, commits: ['a', 'b'], prs: [{ number: 5, url: 'p5', state: 'open' }] })
    const b = mergeLinks(a, { branch: 'feat', commits: ['b', 'c'], prs: [{ number: 5, url: 'p5', state: 'merged' }, { number: 6, url: 'p6', state: 'open' }] })
    expect(b).toEqual({
      issue: { number: 1, url: 'u1' },
      branch: 'feat',
      commits: ['a', 'b', 'c'],
      prs: [{ number: 5, url: 'p5', state: 'merged' }, { number: 6, url: 'p6', state: 'open' }]
    })
  })
})

describe('rangeCommits', () => {
  it('asks git for base..HEAD, oldest first, and keeps only commit ids', async () => {
    const asked: string[][] = []
    const out = await rangeCommits('/wt', 'abc1234', 'HEAD', async (a) => {
      asked.push(a)
      return { ok: true, stdout: 'abc1235\nabc1236\n', stderr: '' }
    })
    expect(out).toEqual(['abc1235', 'abc1236'])
    expect(asked[0]).toEqual(['rev-list', '--reverse', '--max-count=100', 'abc1234..HEAD'])
    expect(await rangeCommits('/wt', 'x', 'HEAD', async () => ({ ok: false, stdout: '', stderr: 'bad' }))).toEqual([])
  })
})

describe("the plan's pull request", () => {
  it('says Closes only for an issue made for the plan, Refs for one that was there, and names model and account', () => {
    const body = planPrBody({
      plan: 'Refactor auth',
      tasks: [
        { title: 'A', status: 'completed', issue: { number: 3, url: 'u', closes: true }, model: 'opus', account: 'Work', acceptanceCriteria: ['tests pass'] },
        { title: 'B', status: 'completed', issue: { number: 4, url: 'u' } }
      ]
    })
    expect(body).toContain('Closes #3')
    expect(body).toContain('Refs #4')
    expect(body).not.toContain('Closes #4')
    expect(body).toContain('model `opus`, account `Work`')
    expect(body).toContain('  - tests pass')
  })

  it("reads each Task's last working attempt, not its review, and its acceptance criteria by shape", () => {
    const t = { id: 't1', runId: 'r1', title: 'A', spec: '', deps: [], status: 'completed', consecutiveFailures: 0, createdAt: '', updatedAt: '' } as Task
    const d = (id: string, over: Partial<Dispatch>) => ({ id, taskId: 't1', accountId: 'acc1', ...over }) as Dispatch
    const s = {
      ...emptyState(),
      tasks: [{ ...t, acceptanceCriteria: ['works'] } as Task, { ...t, id: 't2', runId: 'r2' }],
      dispatches: [d('d1', { model: 'sonnet' }), d('d2', { model: 'opus', review: true })]
    }
    expect(planPrTasksOf(s, 'r1', (id) => (id === 'acc1' ? 'Work' : undefined))).toEqual([
      { title: 'A', status: 'completed', acceptanceCriteria: ['works'], model: 'sonnet', account: 'Work' }
    ])
  })

  it('reads a PR number off its URL', () => {
    expect(prNumberOf('https://github.com/o/r/pull/13')).toBe(13)
    expect(prNumberOf('https://github.com/o/r/issues/13')).toBeNull()
  })
})
