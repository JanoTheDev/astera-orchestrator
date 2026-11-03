// A worker's report of a Task done commits what it left uncommitted (owner report 2026-11-02, run_d7918893935ddbd7:
// the worker staged its change and never committed it; the review approved, the Task completed, and the delivery could
// not carry it).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { commitLeftoverWork, leftoverLines } from './leftoverWork'

const sh = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function repo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-leftover-'))
  sh(dir, ['init', '-q', '-b', 'main'])
  sh(dir, ['config', 'user.name', 'T'])
  sh(dir, ['config', 'user.email', 't@example.com'])
  writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  writeFileSync(path.join(dir, '.gitignore'), 'build/\n')
  sh(dir, ['add', '-A'])
  sh(dir, ['commit', '-q', '-m', 'init'])
  return dir
}

describe('commitLeftoverWork', () => {
  it('answers clean for a worktree with everything committed, and commits nothing', async () => {
    const dir = repo()
    const before = sh(dir, ['rev-parse', 'HEAD'])
    expect(await commitLeftoverWork(dir, 'left over')).toEqual({ kind: 'clean' })
    expect(sh(dir, ['rev-parse', 'HEAD'])).toBe(before)
  })

  it('commits a staged change, an unstaged one and a new file as one commit, leaving the folder clean', async () => {
    const dir = repo()
    writeFileSync(path.join(dir, 'a.txt'), 'two\n')
    sh(dir, ['add', 'a.txt']) // staged, never committed: the reported case
    writeFileSync(path.join(dir, 'b.txt'), 'new\n')
    const r = await commitLeftoverWork(dir, 'Task: work left uncommitted at its report')
    expect(r).toMatchObject({ kind: 'committed', files: 2 })
    expect(sh(dir, ['status', '--porcelain'])).toBe('')
    expect(sh(dir, ['log', '-1', '--format=%s'])).toBe('Task: work left uncommitted at its report')
    expect(sh(dir, ['show', '--name-only', '--format=', 'HEAD']).split('\n').sort()).toEqual(['a.txt', 'b.txt'])
  })

  it('leaves ignored files out and answers clean when only they changed', async () => {
    const dir = repo()
    mkdirSync(path.join(dir, 'build'))
    writeFileSync(path.join(dir, 'build', 'out.js'), 'x')
    expect(await commitLeftoverWork(dir, 'left over')).toEqual({ kind: 'clean' })
  })

  it('never commits a conflict left half resolved', async () => {
    const dir = repo()
    sh(dir, ['checkout', '-q', '-b', 'side'])
    writeFileSync(path.join(dir, 'a.txt'), 'side\n')
    sh(dir, ['commit', '-q', '-am', 'side'])
    sh(dir, ['checkout', '-q', 'main'])
    writeFileSync(path.join(dir, 'a.txt'), 'main\n')
    sh(dir, ['commit', '-q', '-am', 'main'])
    try {
      sh(dir, ['merge', 'side'])
    } catch {
      // the conflict is the point
    }
    const r = await commitLeftoverWork(dir, 'left over')
    expect(r).toMatchObject({ kind: 'failed', reason: expect.stringContaining('conflict') })
  })

  it('answers unknown, never throws, where git cannot run', async () => {
    const r = await commitLeftoverWork(path.join(os.tmpdir(), `astera-no-such-folder-${process.pid}`), 'left over')
    expect(r.kind).toBe('unknown')
  })

  it('does not count the worktree link to node_modules as work', () => {
    expect(leftoverLines('?? node_modules\n M src/a.ts\n')).toEqual([' M src/a.ts'])
  })
})
