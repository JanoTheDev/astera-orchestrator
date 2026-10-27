// `git-branch-create` through handleCommand: only a registered project's folder, only the person.
import { afterEach, describe, expect, it } from 'vitest'
import { handleCommand, type OrchServerDeps } from './command'
import { emptyState } from './state'
import type { Project } from './types'
import { APP_CALLER } from '../host/driver'
import { gitSync, makeRepo } from '../worktrees/testRepo'
import { removeFixture } from '../testFixtures'

const NOW = '2026-10-27T00:00:00.000Z'
let repo = ''
afterEach(async () => {
  if (repo) await removeFixture(repo)
  repo = ''
})

const setup = async () => {
  repo = await makeRepo('astera-branch-cmd-')
  const project: Project = { id: 'p1', path: repo, name: 'shop', addedAt: NOW }
  const state = { ...emptyState(), projects: [project] }
  const deps = { getState: () => state, setState: async () => {}, now: () => NOW } as unknown as OrchServerDeps
  return (args: Record<string, unknown>, sessionId = APP_CALLER) => handleCommand(deps, { sessionId }, 'git-branch-create', args)
}

describe('git-branch-create', () => {
  it('refuses a folder that is not a registered project', async () => {
    const call = await setup()
    const r = await call({ cwd: `${repo}-elsewhere`, name: 'feat/x' })
    expect(r.status).toBe(404)
    expect(gitSync(repo, ['branch', '--list', 'feat/x'])).toBe('')
  })

  it('needs a cwd and a name', async () => {
    const call = await setup()
    expect((await call({ name: 'feat/x' })).status).toBe(400)
    expect((await call({ cwd: repo })).status).toBe(400)
  })

  it('creates the branch in a registered project, and refuses a bad or existing name', async () => {
    const call = await setup()
    const made = await call({ cwd: repo, name: 'feat/x' })
    expect(made).toMatchObject({ status: 200, body: { ok: true, name: 'feat/x', from: 'main', pushed: false } })
    expect((await call({ cwd: repo, name: 'feat/x' })).status).toBe(409)
    expect((await call({ cwd: repo, name: 'a..b' })).status).toBe(409)
  })

  it('is the person’s: an agent session is refused', async () => {
    const call = await setup()
    expect((await call({ cwd: repo, name: 'feat/y' }, 'ses_agent')).status).toBe(403)
  })
})
