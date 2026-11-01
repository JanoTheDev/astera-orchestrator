import { describe, it, expect, beforeEach } from 'vitest'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { createWorktree } from './create'
import { WorktreeRegistry } from './registry'
import { sweepHalfRemoved } from './sweep'
import { gitSync, makeRepo, tempDir } from './testRepo'

let repo: string
let reg: WorktreeRegistry

beforeEach(async () => {
  repo = await makeRepo('astera-wt-sweep-')
  reg = new WorktreeRegistry(path.join(await tempDir('astera-wt-sweepreg-'), 'worktrees.json'), await tempDir('astera-wt-sweeproot-'))
  await reg.load()
})

/** What git deletes first on Windows before a locked file stops it: the folder's `.git` link. */
const halfRemove = (p: string): Promise<void> => fs.rm(path.join(p, '.git'), { force: true })

describe('sweepHalfRemoved', () => {
  it('moves a half removed folder whose head is on a branch to .trash and drops its row; a whole one is not touched', async () => {
    const half = (await createWorktree({ repoPath: repo, name: 'half', registry: reg })).info
    const whole = (await createWorktree({ repoPath: repo, name: 'whole', registry: reg })).info
    await halfRemove(half.path)
    const r = await sweepHalfRemoved({ registry: reg, log: () => {} })
    expect(r).toEqual({ trashed: [half.path], kept: [] })
    expect(existsSync(half.path)).toBe(false)
    expect((await fs.readdir(path.join(reg.getRoot(), '.trash'))).some((n) => n.startsWith('half-'))).toBe(true)
    expect(reg.get(half.id)).toBeNull()
    expect(gitSync(repo, ['worktree', 'list', '--porcelain'])).not.toMatch(/half/)
    expect(existsSync(path.join(whole.path, '.git'))).toBe(true)
    expect(reg.get(whole.id)).not.toBeNull()
  })

  it('leaves a half removed folder whose head is on no branch, and reports it', async () => {
    const { info } = await createWorktree({ repoPath: repo, name: 'lost', registry: reg })
    gitSync(info.path, ['checkout', '-q', '--detach'])
    await fs.writeFile(path.join(info.path, 'l.txt'), 'l', 'utf8')
    gitSync(info.path, ['add', 'l.txt'])
    gitSync(info.path, ['commit', '-q', '-m', 'on no branch'])
    gitSync(repo, ['branch', '-D', info.branch])
    await halfRemove(info.path)
    const logs: string[] = []
    const r = await sweepHalfRemoved({ registry: reg, log: (m) => logs.push(m) })
    expect(r).toEqual({ trashed: [], kept: [info.path] })
    expect(existsSync(path.join(info.path, 'l.txt'))).toBe(true)
    expect(reg.get(info.id)).not.toBeNull()
    expect(logs.join('\n')).toContain(info.path)
  })
})
