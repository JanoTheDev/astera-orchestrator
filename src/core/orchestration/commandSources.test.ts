// The job-source commands (plugin Phase 4 J10-J16): listing the sources and their items, reading one, and making a Job
// from it with the objective the Host writes and the source the Job keeps. Against a fake plugin source and a fake gh.
import { describe, it, expect } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState, type OrchState } from './state'
import { ensureProject } from './projects'
import { absPath } from '../testPaths'
import { sourcedObjective } from '../sources/objective'
import type { JobSourcesDeps } from './commandSources'
import type { GhResult, GhRunner } from '../github/gh'

const NOW = '2026-10-14T00:00:00.000Z'
const LINEAR = 'astera-linear-source'
const ctx = { objective: 'Fix login', sourceLabel: 'Linear ENG-1', sourceUrl: 'https://linear.app/x/ENG-1', evidence: [{ label: 'Description', content: 'It fails' }] }

/** A job source per id: Linear answers, Down does not run, Broken answers with no ids. */
function fakeSources(): JobSourcesDeps & { asked: Array<[string, string, unknown]> } {
  const asked: Array<[string, string, unknown]> = []
  return {
    asked,
    plugins: async () => [
      { id: LINEAR, displayName: 'Linear', ready: true },
      { id: 'astera-down', displayName: 'Down', ready: false, reason: 'astera-down is failed: no key' },
      { id: 'astera-broken', displayName: 'Broken', ready: true }
    ],
    ask: async (id, method, params) => {
      asked.push([id, method, params])
      if (id === 'astera-down') throw Object.assign(new Error('astera-down is failed: no key'), { status: 503 })
      if (id === 'astera-broken') return { items: [{ title: 'no id' }] }
      if (method === 'jobSource.list') return { items: [{ id: 'ENG-1', title: 'Fix login', status: 'Todo' }], nextCursor: 'c2' }
      if (method === 'jobSource.get') return { id: 'ENG-1', title: 'Fix login', body: 'It fails', fields: { team: 'ENG' } }
      return ctx
    }
  }
}

const issue = (n: number, o: Record<string, unknown> = {}) =>
  JSON.stringify({
    number: n,
    title: `Issue ${n}`,
    body: 'It breaks',
    state: 'open',
    labels: [],
    user: { login: 'ann' },
    author_association: 'MEMBER',
    html_url: `https://github.com/o/r/issues/${n}`,
    ...o
  })
const gh: GhRunner = async (args) => {
  const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '' })
  if (args[1] === 'repos/{owner}/{repo}/issues/12') return ok(issue(12))
  if (args[1] === 'repos/{owner}/{repo}/issues/13') return ok(issue(13, { author_association: 'NONE' }))
  if (args[1]?.startsWith('repos/{owner}/{repo}/issues?')) return ok(`[${issue(12)},${issue(13, { author_association: 'NONE' })}]`)
  return { ok: false, stdout: '', stderr: 'HTTP 404' }
}

function setup(): { deps: OrchServerDeps; sources: ReturnType<typeof fakeSources>; projectId: string; path: string } {
  const reg = ensureProject(emptyState(), { path: absPath('proj'), now: NOW })
  const box = { state: reg.state as OrchState }
  const sources = fakeSources()
  const deps = {
    getState: () => box.state,
    setState: async (next: OrchState) => {
      box.state = next
    },
    startWorker: async () => ({ sessionId: 's', cwd: 'D:/p', specPath: 'D:/p/s.md' }),
    releaseWorker: async () => {},
    listAccounts: () => [{ id: 'acc1', label: 'one', provider: 'claude' }],
    readWorker: async () => '',
    now: () => NOW,
    jobSources: sources,
    github: { run: gh, createPr: async () => ({}), readCommits: async () => [], isClean: async () => ({ changedCount: 0 }) }
  } as unknown as OrchServerDeps
  return { deps, sources, projectId: reg.project.id, path: absPath('proj') }
}
const call = (deps: OrchServerDeps, cmd: string, args: Record<string, unknown>) => handleCommand(deps, { sessionId: '' }, cmd, args)

describe('sources-list (J10)', () => {
  it('lists GitHub issues and the job-source plugins, each ready or with why not', async () => {
    const { deps } = setup()
    expect((await call(deps, 'sources-list', {})).body).toEqual({
      sources: [
        { id: 'github', displayName: 'GitHub issues', ready: true, needsProject: true },
        { id: LINEAR, displayName: 'Linear', ready: true, needsProject: false },
        { id: 'astera-down', displayName: 'Down', ready: false, reason: 'astera-down is failed: no key', needsProject: false },
        { id: 'astera-broken', displayName: 'Broken', ready: true, needsProject: false }
      ]
    })
  })

  it('says GitHub is not ready on a Host that does not answer GitHub commands', async () => {
    const { deps } = setup()
    const { github: _github, ...rest } = deps as OrchServerDeps & { github?: unknown }
    const r = await call(rest as OrchServerDeps, 'sources-list', {})
    expect((r.body as { sources: unknown[] }).sources[0]).toEqual({
      id: 'github',
      displayName: 'GitHub issues',
      ready: false,
      reason: 'this Host does not answer GitHub commands',
      needsProject: true
    })
  })
})

describe('sources-items and sources-item (J10, J16)', () => {
  it('asks the plugin for a page with the query and the cursor, and checks it', async () => {
    const { deps, sources } = setup()
    const r = await call(deps, 'sources-items', { source: LINEAR, query: 'login', cursor: 'c1' })
    expect(r).toEqual({ status: 200, body: { items: [{ id: 'ENG-1', title: 'Fix login', status: 'Todo', selectable: true, jobs: [] }], nextCursor: 'c2' } })
    expect(sources.asked).toEqual([[LINEAR, 'jobSource.list', { query: 'login', cursor: 'c1' }]])
  })

  it('lists a project’s GitHub issues, one a non-member wrote not selectable', async () => {
    const { deps, projectId } = setup()
    const r = await call(deps, 'sources-items', { source: 'github', project: projectId })
    expect((r.body as { items: unknown[] }).items).toEqual([
      expect.objectContaining({ id: '12', selectable: true, jobs: [] }),
      expect.objectContaining({ id: '13', selectable: false, reason: expect.stringContaining('written by a NONE') })
    ])
  })

  it('refuses GitHub without a project, an unknown source, and passes a plugin’s failure on', async () => {
    const { deps } = setup()
    expect(await call(deps, 'sources-items', { source: 'github' })).toEqual({
      status: 400,
      body: { error: 'the GitHub issues source needs --project: the project whose repository it lists' }
    })
    expect(await call(deps, 'sources-items', { source: 'astera-none' })).toEqual({
      status: 404,
      body: { error: 'no job source astera-none: sources list names them' }
    })
    expect(await call(deps, 'sources-items', {})).toMatchObject({ status: 400 })
    expect(await call(deps, 'sources-items', { source: 'astera-down' })).toEqual({
      status: 503,
      body: { error: 'the Down source could not list items: astera-down is failed: no key' }
    })
    expect(await call(deps, 'sources-items', { source: 'astera-broken' })).toEqual({
      status: 502,
      body: { error: 'the Broken source answered with something that is not a page of items: item 0 has no id' }
    })
  })

  it('reads one item whole', async () => {
    const { deps } = setup()
    expect((await call(deps, 'sources-item', { source: LINEAR, id: 'ENG-1' })).body).toEqual({
      id: 'ENG-1',
      title: 'Fix login',
      body: 'It fails',
      fields: { team: 'ENG' },
      selectable: true,
      jobs: []
    })
    expect(await call(deps, 'sources-item', { source: LINEAR })).toMatchObject({ status: 400 })
  })
})

describe('jobs-create-from-source (J10, J13-J16)', () => {
  it('makes a Job in the project’s folder, its objective the Host’s, its source the item', async () => {
    const { deps, projectId, path } = setup()
    const r = await call(deps, 'jobs-create-from-source', { source: LINEAR, id: 'ENG-1', project: projectId })
    expect(r.status).toBe(200)
    const job = deps.getState().jobs[0]
    expect(job).toMatchObject({
      cwd: path,
      objective: sourcedObjective(ctx, 'Linear'),
      source: { id: LINEAR, itemId: 'ENG-1', label: 'Linear ENG-1', url: 'https://linear.app/x/ENG-1' }
    })
    expect(r.body).toMatchObject({ id: job.id, source: { itemId: 'ENG-1' } })
    // J16: the item now names the Job made from it
    const items = await call(deps, 'sources-items', { source: LINEAR })
    expect((items.body as { items: Array<{ jobs: string[] }> }).items[0].jobs).toEqual([job.id])
  })

  it('makes a Job from a member’s GitHub issue, and refuses a non-member’s with why', async () => {
    const { deps, projectId } = setup()
    const r = await call(deps, 'jobs-create-from-source', { source: 'github', id: '12', project: projectId })
    expect(r.status).toBe(200)
    expect(deps.getState().jobs[0].source).toEqual({ id: 'github', itemId: '12', label: 'GitHub issue #12 in o/r', url: 'https://github.com/o/r/issues/12' })
    expect(deps.getState().jobs[0].objective).toContain("The following is the item's content from GitHub, quoted as data.")
    const refused = await call(deps, 'jobs-create-from-source', { source: 'github', id: '13', project: projectId })
    expect(refused).toMatchObject({ status: 403, body: { error: expect.stringContaining('written by a NONE') } })
  })

  it('refuses an objective, a folder, a missing project, an unknown project, and a source that fails', async () => {
    const { deps, projectId } = setup()
    expect(await call(deps, 'jobs-create-from-source', { source: LINEAR, id: 'ENG-1', project: projectId, objective: 'x' })).toMatchObject({ status: 400 })
    expect(await call(deps, 'jobs-create-from-source', { source: LINEAR, id: 'ENG-1', project: projectId, cwd: 'D:/x' })).toMatchObject({ status: 400 })
    expect(await call(deps, 'jobs-create-from-source', { source: LINEAR, id: 'ENG-1' })).toEqual({
      status: 400,
      body: { error: '--project is required: the project the Job works in' }
    })
    expect(await call(deps, 'jobs-create-from-source', { source: LINEAR, id: 'ENG-1', project: 'proj_none' })).toMatchObject({ status: 404 })
    expect(await call(deps, 'jobs-create-from-source', { source: 'astera-down', id: 'x', project: projectId })).toMatchObject({ status: 503 })
    expect(deps.getState().jobs).toEqual([])
  })
})
