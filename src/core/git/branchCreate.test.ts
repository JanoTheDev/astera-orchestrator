import { afterEach, describe, expect, it } from 'vitest'
import { removeFixture } from '../testFixtures'
import { addOrigin, gitSync, makeRepo, tempDir } from '../worktrees/testRepo'
import { createBranch } from './branchCreate'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => removeFixture(d)))
})
const repo = async (): Promise<string> => {
  const r = await makeRepo('astera-branch-create-')
  dirs.push(r)
  return r
}
const withOrigin = async (r: string): Promise<string> => {
  const bare = await addOrigin(r)
  dirs.push(bare)
  return bare
}
const commit = (r: string, msg: string): string => {
  gitSync(r, ['commit', '--allow-empty', '-m', msg])
  return gitSync(r, ['rev-parse', 'HEAD'])
}

describe('createBranch', () => {
  it('refuses a name git does not accept, with a reason', async () => {
    const cwd = await repo()
    for (const name of ['', 'has space', 'a..b', '-x', 'x.lock', '@{-1}', 'a~b']) {
      const r = await createBranch({ cwd, name })
      expect(r.ok, name).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/valid branch name/)
    }
  })

  it('refuses a branch that already exists locally', async () => {
    const cwd = await repo()
    expect(await createBranch({ cwd, name: 'main' })).toEqual({ ok: false, reason: 'branch main already exists' })
  })

  it('refuses an unknown base and creates nothing', async () => {
    const cwd = await repo()
    const r = await createBranch({ cwd, name: 'feat/x', from: 'nope' })
    expect(r).toEqual({ ok: false, reason: 'unknown base: nope' })
    expect(gitSync(cwd, ['branch', '--list', 'feat/x'])).toBe('')
  })

  it('creates the branch from `from`, not from HEAD, and pushes nothing without an origin', async () => {
    const cwd = await repo()
    const base = gitSync(cwd, ['rev-parse', 'HEAD'])
    gitSync(cwd, ['branch', 'dev'])
    commit(cwd, 'later')
    const r = await createBranch({ cwd, name: 'feat/x', from: 'dev' })
    expect(r).toEqual({ ok: true, name: 'feat/x', from: 'dev', pushed: false })
    expect(gitSync(cwd, ['rev-parse', 'feat/x'])).toBe(base)
    expect(gitSync(cwd, ['symbolic-ref', '--short', 'HEAD'])).toBe('main')
  })

  it('defaults `from` to the repository default branch', async () => {
    const cwd = await repo()
    expect(await createBranch({ cwd, name: 'feat/y' })).toEqual({ ok: true, name: 'feat/y', from: 'main', pushed: false })
  })

  it('publishes the new branch to origin with an upstream, from the fetched origin branch', async () => {
    const cwd = await repo()
    const bare = await withOrigin(cwd)
    // origin moves ahead of the local main
    const other = await tempDir('astera-branch-create-clone-')
    dirs.push(other)
    gitSync(other, ['clone', bare, 'c'])
    const clone = `${other}/c`
    gitSync(clone, ['config', 'user.email', 't@t.com'])
    gitSync(clone, ['config', 'user.name', 'T'])
    const ahead = commit(clone, 'ahead')
    gitSync(clone, ['push', 'origin', 'main'])

    const r = await createBranch({ cwd, name: 'feat/z' })
    expect(r).toEqual({ ok: true, name: 'feat/z', from: 'origin/main', pushed: true })
    expect(gitSync(cwd, ['rev-parse', 'feat/z'])).toBe(ahead)
    expect(gitSync(bare, ['rev-parse', 'feat/z'])).toBe(ahead)
    expect(gitSync(cwd, ['rev-parse', '--abbrev-ref', 'feat/z@{upstream}'])).toBe('origin/feat/z')
  })

  it('keeps the local branch and says why when the remote cannot be reached', async () => {
    const cwd = await repo()
    const bare = await withOrigin(cwd)
    await removeFixture(bare)
    const r = await createBranch({ cwd, name: 'feat/w' })
    expect(r).toMatchObject({ ok: true, name: 'feat/w', pushed: false })
    expect(r.ok && r.pushError).toBeTruthy()
    expect(gitSync(cwd, ['branch', '--list', 'feat/w'])).toContain('feat/w')
  })
})
