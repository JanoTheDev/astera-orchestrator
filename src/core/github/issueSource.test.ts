// GitHub issues as a job source (Phase 4 J3, J12): the open issues of a project's repository, read with the person's
// gh; pull requests left out; an issue a non-member wrote listed but not selectable; the query kept to this repository.
import { describe, it, expect } from 'vitest'
import type { GhResult, GhRunner } from './gh'
import { issueContext, issueDetail, issuesContext, listIssueItems, REPO_NAME_TTL_MS } from './issueSource'
import { parseIssue } from './issue'

const issue = (n: number, o: Record<string, unknown> = {}) => ({
  number: n,
  title: `Issue ${n}`,
  body: `Body ${n}`,
  state: 'open',
  labels: [{ name: 'bug' }],
  user: { login: 'ann' },
  author_association: 'MEMBER',
  html_url: `https://github.com/o/r/issues/${n}`,
  ...o
})

/** A gh that answers each call from `answers` by its first matching argument, and records the calls. */
function fakeGh(answers: Array<[RegExp, unknown]>) {
  const calls: string[][] = []
  const gh: GhRunner = async (args) => {
    calls.push(args)
    const hit = answers.find(([re]) => args.some((a) => re.test(a)))
    if (!hit) return { ok: false, code: 1, stdout: '', stderr: `no answer for ${args.join(' ')}` } as GhResult
    return { ok: true, code: 0, stdout: typeof hit[1] === 'string' ? hit[1] : JSON.stringify(hit[1]), stderr: '' } as GhResult
  }
  return { gh, calls }
}

describe('listIssueItems (J12)', () => {
  it('lists the open issues of the folder’s repository without a query, leaving pull requests out', async () => {
    const { gh, calls } = fakeGh([[/^repos\/\{owner\}\/\{repo\}\/issues\?/, [issue(1), issue(2, { pull_request: { url: 'x' } }), issue(3)]]])
    const r = await listIssueItems(gh, 'D:/p', {})
    expect(calls).toEqual([['api', 'repos/{owner}/{repo}/issues?state=open&per_page=30&page=1']])
    if (!r.ok) throw new Error(r.message)
    expect(r.items.map((i) => i.id)).toEqual(['1', '3'])
    expect(r.items[0]).toEqual({ id: '1', title: 'Issue 1', status: 'open', url: 'https://github.com/o/r/issues/1', summary: 'Body 1', selectable: true })
    expect(r.nextCursor).toBeUndefined()
  })

  it('marks an issue a non-member wrote as not selectable, with the reason', async () => {
    const { gh } = fakeGh([[/issues\?/, [issue(4, { author_association: 'CONTRIBUTOR' })]]])
    const r = await listIssueItems(gh, 'D:/p', {})
    expect(r.ok && r.items[0]).toMatchObject({
      selectable: false,
      reason: "written by a CONTRIBUTOR of the repository; only an owner, member or collaborator's issue becomes a Job"
    })
  })

  it('gives the next page as the cursor when a page was full', async () => {
    const { gh, calls } = fakeGh([[/issues\?/, Array.from({ length: 30 }, (_, i) => issue(i + 1))]])
    const r = await listIssueItems(gh, 'D:/p', { cursor: '2' })
    expect(calls[0][1]).toBe('repos/{owner}/{repo}/issues?state=open&per_page=30&page=2')
    expect(r.ok && r.nextCursor).toBe('3')
  })

  // The 4a review's M5 and M6: the repository's name is read for each search, as the folder's remote names it now, and
  // an issue the search found in another repository is left out
  // 4a M6 read the name on every search; 5e (performance review) keeps it a minute per folder: a second gh call (~0.7 s)
  // per search pause otherwise, and a folder whose remote changed is searched as it is now within a minute
  it('searches the repository with a query, reading its name once a minute per folder, and keeps its own issues alone', async () => {
    const { gh, calls } = fakeGh([
      [/^repos\/\{owner\}\/\{repo\}$/, 'o/r\n'],
      [/^search\/issues$/, { items: [issue(7), issue(8, { html_url: 'https://github.com/x/y/issues/8' }), issue(9, { html_url: 'https://github.com/O/R/issues/9' })] }]
    ])
    let clock = 1_000_000
    const now = (): number => clock
    const named = (): number => calls.filter((c) => c.includes('repos/{owner}/{repo}')).length
    await listIssueItems(gh, 'D:/p', { query: 'login fails' }, now)
    clock += REPO_NAME_TTL_MS - 1
    await listIssueItems(gh, 'D:/p', { query: 'login' }, now)
    expect(named()).toBe(1)
    await listIssueItems(gh, 'D:/q', { query: 'login' }, now)
    expect(named()).toBe(2)
    clock += 1
    const r = await listIssueItems(gh, 'D:/p', { query: 'crash' }, now)
    expect(named()).toBe(3)
    expect(calls.at(-1)).toEqual(['api', '-X', 'GET', 'search/issues', '-f', 'q=repo:o/r is:issue is:open crash', '-f', 'per_page=30', '-f', 'page=1'])
    expect(r.ok && r.items.map((i) => i.id)).toEqual(['7', '9'])
  })

  // Review Focus 4: GitHub ORs two repo: qualifiers, so a person's would widen the search
  it('keeps a person’s query to this repository, dropping the qualifiers that would leave it', async () => {
    const { gh, calls } = fakeGh([
      [/^repos\/\{owner\}\/\{repo\}$/, 'o/r'],
      [/^search\/issues$/, { items: [] }]
    ])
    await listIssueItems(gh, 'D:/p', { query: 'repo:someone/else bug org:x user:y is:pr -repo:z IS:closed' })
    expect(calls.at(-1)?.[5]).toBe('q=repo:o/r is:issue is:open bug')
  })

  // W6-A: "assigned to me" is a search qualifier of the person's own gh login
  it('mine searches assignee:@me, alone or with a query, and still drops the qualifiers that would leave the repository', async () => {
    const { gh, calls } = fakeGh([
      [/^repos\/\{owner\}\/\{repo\}$/, 'o/r'],
      [/^search\/issues$/, { items: [issue(7)] }]
    ])
    const r = await listIssueItems(gh, 'D:/p', { mine: true })
    expect(calls.at(-1)?.[5]).toBe('q=repo:o/r is:issue is:open assignee:@me')
    expect(r.ok && r.items.map((i) => i.id)).toEqual(['7'])
    await listIssueItems(gh, 'D:/p', { query: 'crash repo:x/y org:z user:u is:closed', mine: true })
    expect(calls.at(-1)?.[5]).toBe('q=repo:o/r is:issue is:open crash assignee:@me')
  })

  it('says what gh said when it fails, and refuses a cursor that is no page number', async () => {
    const { gh } = fakeGh([])
    const r = await listIssueItems(gh, 'D:/p', {})
    expect(r.ok).toBe(false)
    expect(await listIssueItems(gh, 'D:/p', { cursor: 'abc' })).toMatchObject({ ok: false, message: 'the cursor abc is not a page number' })
  })
})

describe('issueDetail and issueContext (J12)', () => {
  it('reads an issue whole, its author and labels as fields', async () => {
    const { gh } = fakeGh([[/issues\/12$/, issue(12, { body: 'Steps:\n1. open' })]])
    const r = await issueDetail(gh, 'D:/p', '12')
    expect(r).toMatchObject({
      ok: true,
      selectable: true,
      detail: { id: '12', title: 'Issue 12', status: 'open', url: 'https://github.com/o/r/issues/12', body: 'Steps:\n1. open', fields: { author: 'ann', labels: 'bug' } }
    })
  })

  it('refuses an id that is no issue number, and a pull request; a closed issue is not selectable', async () => {
    const { gh } = fakeGh([
      [/issues\/5$/, issue(5, { pull_request: { url: 'x' } })],
      [/issues\/6$/, issue(6, { state: 'closed' })]
    ])
    expect(await issueDetail(gh, 'D:/p', 'ENG-1')).toMatchObject({ ok: false, kind: 'not-found', message: 'ENG-1 is not an issue number' })
    expect(await issueDetail(gh, 'D:/p', '5')).toMatchObject({ ok: false, kind: 'not-found', message: '#5 is a pull request, not an issue' })
    expect(await issueDetail(gh, 'D:/p', '6')).toMatchObject({ ok: true, selectable: false, reason: 'Issue #6 is closed' })
  })

  it('makes the context from the title and the body', () => {
    const parsed = parseIssue(JSON.stringify(issue(12, { body: 'It breaks' })))!
    expect(issueContext(parsed)).toEqual({
      objective: 'Issue 12',
      sourceLabel: 'GitHub issue #12 in o/r',
      sourceUrl: 'https://github.com/o/r/issues/12',
      evidence: [{ label: 'Body', content: 'It breaks' }],
      metadata: { labels: 'bug' }
    })
  })
})

// W6-A: several issues, one Job
describe('issuesContext', () => {
  const p = (n: number, o: Record<string, unknown> = {}) => parseIssue(JSON.stringify(issue(n, o)))!
  it('is issueContext for one issue', () => {
    expect(issuesContext([p(3)])).toEqual(issueContext(p(3)))
  })
  it('lists every issue by number and title, each body its own evidence', () => {
    const ctx = issuesContext([p(12), p(14, { body: '' })])
    expect(ctx.objective).toBe('#12 Issue 12\n#14 Issue 14')
    expect(ctx.sourceLabel).toBe('GitHub issues #12, #14 in o/r')
    expect(ctx.evidence).toEqual([
      { label: 'Issue #12 (https://github.com/o/r/issues/12), labels bug', content: 'Body 12' },
      { label: 'Issue #14 (https://github.com/o/r/issues/14), labels bug', content: '(no body)' }
    ])
  })
})
