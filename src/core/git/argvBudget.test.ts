import { promises as fs } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// execFile is replaced for the spawn-error tests only: `spawnWith` decides what the next call does.
const spawnWith = vi.hoisted(() => ({ next: null as null | ((cb: (err: unknown, out: string, errOut: string) => void) => void) }))
vi.mock('node:child_process', async (orig) => {
  const real = await orig<typeof import('node:child_process')>()
  return {
    ...real,
    execFile: ((file: string, args: string[], opts: unknown, cb: (err: unknown, out: string, errOut: string) => void) => {
      if (!spawnWith.next) return (real.execFile as (...a: unknown[]) => unknown)(file, args, opts, cb)
      spawnWith.next(cb)
      return { exitCode: null, signalCode: null, once: () => {}, on: () => {}, kill: () => true }
    }) as unknown as typeof real.execFile
  }
})

import { mergeDepsInto } from '../orchestration/exec/integrateGit'
import { createPullRequest } from '../github/prCreate'
import { setPrBody } from '../github/prUpdate'
import { gh, type GhResult } from '../github/gh'
import { remapMerged } from '../attribution/remap'
import { git, type GitResult } from '../worktrees/git'
import { ARGV_BUDGET, argvLength, warnLongArgv } from './argvBudget'

beforeEach(() => {
  spawnWith.next = null
})

const tooLong = (code: string) => (cb: (err: unknown, out: string, errOut: string) => void) =>
  cb(Object.assign(new Error(`spawn ${code}`), { code, syscall: 'spawn' }), '', '')

describe('argvLength', () => {
  it('counts every argument with its separator and quotes', () => {
    expect(argvLength('git', ['log', 'abc'])).toBe(3 + 3 + 3 + 3 + 3 + 3)
  })

  it('warns, and does not throw, past the budget', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    warnLongArgv('git', ['merge', 'x'.repeat(ARGV_BUDGET)])
    expect(warn).toHaveBeenCalledTimes(1)
    warnLongArgv('git', ['merge', 'main'])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('a spawn failure from a command line that is too long', () => {
  it.each(['ENAMETOOLONG', 'E2BIG'])('gh() answers %s as a failure with spawnError, not as a throw', async (code) => {
    spawnWith.next = tooLong(code)
    expect(await gh(['pr', 'create'])).toMatchObject({ ok: false, spawnError: code, stderr: `spawn ${code}` })
  })

  it('gh() answers an execFile that throws synchronously the same way', async () => {
    spawnWith.next = () => {
      throw Object.assign(new Error('spawn ENAMETOOLONG'), { code: 'ENAMETOOLONG' })
    }
    expect(await gh(['pr', 'create'])).toMatchObject({ ok: false, spawnError: 'ENAMETOOLONG' })
  })

  it.each(['ENAMETOOLONG', 'E2BIG'])('git() answers %s as a failure with errorCode, not as a throw', async (code) => {
    spawnWith.next = tooLong(code)
    expect(await git(['merge', 'x'])).toMatchObject({ ok: false, errorCode: code, stderr: `spawn ${code}` })
  })

  it('createPullRequest returns it as a create-stage failure carrying spawnError', async () => {
    spawnWith.next = tooLong('ENAMETOOLONG')
    const r = await createPullRequest(
      { worktreePath: process.cwd(), repoPath: process.cwd(), branch: 'b', base: 'main', title: 't', body: 'b', draft: false, needsPush: false },
      { normalizeBase: async (_r, b) => b }
    )
    expect(r).toMatchObject({ ok: false, stage: 'create', spawnError: 'ENAMETOOLONG' })
  })
})

// The delivery path of a plan with 60 worktrees whose paths are long: the PR body, its update, the merge of each
// worktree, the push and the attribution remap. Fake runners record every command line.
describe('delivery of a 60-worktree plan', () => {
  const WORKTREES = Array.from({ length: 60 }, (_, i) => `C:\\Users\\someone\\astera-worktrees\\Gameful-Monorepo\\${String(i).padStart(2, '0')}-${'long-task-name-'.repeat(4)}`)
  const body = WORKTREES.map((w, i) => `## Task ${i}: ${'a very long task title '.repeat(4)}\nWorktree: ${w}\n${'The report says what was done. '.repeat(20)}`).join('\n\n')
  const SHA = (i: number): string => i.toString(16).padStart(40, 'a')

  it('keeps every spawned command line under the budget and delivers the body intact', async () => {
    const lines: number[] = []
    const seen: string[] = []
    const bodyFiles: string[] = []
    const note = (cmd: string, a: string[]): void => void lines.push(argvLength(cmd, a))
    const fakeGit = async (a: string[]): Promise<GitResult> => {
      note('git', a)
      seen.push(a.join(' '))
      return { ok: !(a.includes('merge-base') && a.includes('--is-ancestor') && a.at(-1) === 'squashed'), stdout: a[0] === 'symbolic-ref' ? 'refs/heads/astera/t' : 'a'.repeat(40), stderr: '' }
    }
    const fakeGh = async (a: string[]): Promise<GhResult> => {
      note('gh', a)
      const file = a.includes('--body-file') ? a[a.indexOf('--body-file') + 1] : a[a.indexOf('--input') + 1]
      bodyFiles.push(file)
      const sent = await fs.readFile(file, 'utf8')
      expect(a.includes('--body-file') ? sent : (JSON.parse(sent) as { body: string }).body).toBe(body)
      return { ok: true, stdout: 'https://github.com/o/r/pull/9', stderr: '' }
    }

    // each worktree merged into the plan's, then the push and the PR
    await mergeDepsInto('C:\\wt\\plan', WORKTREES, { log: () => {}, git: fakeGit as never })
    const created = await createPullRequest(
      { worktreePath: 'C:\\wt\\plan', repoPath: 'C:\\repo', branch: 'astera/plan', base: 'main', title: 'Deliver plan', body, draft: false, needsPush: true },
      { runGit: fakeGit, runGh: fakeGh, normalizeBase: async (_r, b) => b }
    )
    expect(created).toMatchObject({ ok: true })
    await setPrBody(fakeGh, 'https://github.com/o/r/pull/9', body, 'C:\\wt\\plan')

    // the squash remap of 200 commits
    await remapMerged({
      cwd: 'C:\\repo',
      mergeCommit: SHA(999),
      originals: Array.from({ length: 200 }, (_, i) => SHA(i + 1)),
      run: async (a) => {
        note('git', a)
        return { ok: !(a[0] === 'merge-base'), stdout: '', stderr: '' }
      }
    })

    expect(seen.filter((l) => l.includes(' merge ') || l.startsWith('merge ')).length).toBeGreaterThanOrEqual(60)
    expect(Math.max(...lines)).toBeLessThan(ARGV_BUDGET)
    // the temp files are gone
    for (const f of bodyFiles) await expect(fs.access(f)).rejects.toThrow()
  })
})
