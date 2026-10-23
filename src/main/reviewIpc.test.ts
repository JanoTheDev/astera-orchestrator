import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CONTENT_TOO_LARGE } from '../core/review/changeMap'
import { changeMapOf, isKnownCwd, readNewFrom, registerReviewIpc, type ReviewDeps } from './reviewIpc'

const WT = path.resolve('/wt/one')
const PROJECT = path.resolve('/proj')
const deps = (over: Partial<ReviewDeps> = {}): ReviewDeps => ({
  worktrees: () => [{ path: WT, baseRef: 'origin/main' }],
  projectPaths: async () => [PROJECT],
  ...over
})

function handlers(d: ReviewDeps): Map<string, (e: unknown, ...a: unknown[]) => unknown> {
  const map = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
  registerReviewIpc({ handle: (c, fn) => void map.set(c, fn) }, d)
  return map
}

describe('isKnownCwd', () => {
  it('accepts a registered worktree or a project, nothing else', async () => {
    expect(await isKnownCwd(WT, deps())).toBe(true)
    expect(await isKnownCwd(PROJECT, deps())).toBe(true)
    expect(await isKnownCwd(path.join(WT, 'sub'), deps())).toBe(false)
    expect(await isKnownCwd('/etc', deps())).toBe(false)
    expect(await isKnownCwd('relative', deps())).toBe(false)
    expect(await isKnownCwd(undefined, deps())).toBe(false)
  })
})

describe('readNewFrom', () => {
  it('reads a plain file, refuses a symlink, a missing file and a path outside the root, and flags a big one', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-'))
    try {
      await fs.writeFile(path.join(root, 'a.ts'), 'export const a = 1\n')
      await fs.writeFile(path.join(root, 'big.ts'), 'x'.repeat(1024 * 1024 + 1))
      await fs.symlink('/etc/hostname', path.join(root, 'link.ts'))
      const read = readNewFrom(root)
      expect(await read('a.ts')).toBe('export const a = 1\n')
      expect(await read('big.ts')).toBe(CONTENT_TOO_LARGE)
      expect(await read('link.ts')).toBeNull()
      expect(await read('missing.ts')).toBeNull()
      expect(await read('../outside.ts')).toBeNull()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

describe('changeMapOf', () => {
  it('diffs base...HEAD with renames and returns the map', async () => {
    const git = vi.fn(async (_a: string[], _o?: unknown) => ({
      ok: true,
      stdout: 'diff --git a/x.py b/x.py\n--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@ def f():\n-a\n+b\n',
      stderr: ''
    }))
    const map = await changeMapOf('/wt', 'origin/main', { git })
    expect(map?.files.map((f) => f.path)).toEqual(['x.py'])
    const args = git.mock.calls[0][0] as string[]
    expect(args).toContain('--find-renames')
    expect(args).toContain('-U3')
    expect(args.slice(args.indexOf('--end-of-options'))).toEqual(['--end-of-options', 'origin/main...HEAD', '--'])
  })

  it('is null when git fails', async () => {
    expect(await changeMapOf('/wt', 'nope', { git: async () => ({ ok: false, stdout: '', stderr: 'bad' }) })).toBeNull()
  })
})

describe('review.changeMap handler', () => {
  const ok = { ok: true, stdout: '', stderr: '' }

  it('refuses an unknown cwd without running git', async () => {
    const git = vi.fn(async () => ok)
    expect(await handlers(deps({ git }))!.get('review.changeMap')!(null, { cwd: '/etc' })).toBeNull()
    expect(git).not.toHaveBeenCalled()
  })

  it("uses the worktree's own base, else the detected one, and never an option-like base", async () => {
    const git = vi.fn(async (_a: string[], _o?: unknown) => ok)
    const h = handlers(deps({ git, detectBase: async () => 'main' }))
    await h.get('review.changeMap')!(null, { cwd: WT })
    await h.get('review.changeMap')!(null, { cwd: PROJECT })
    expect(await h.get('review.changeMap')!(null, { cwd: PROJECT, base: '--output=/tmp/x' })).not.toBeNull()
    const bases = git.mock.calls.map((c) => c[0][c[0].length - 2])
    expect(bases).toEqual(['origin/main...HEAD', 'main...HEAD', 'main...HEAD'])
  })
})

describe('pr.merge handler', () => {
  it('validates cwd and method, then passes number or branch to the merge', async () => {
    const merge = vi.fn(async () => ({ ok: true as const }))
    const h = handlers(deps({ merge })).get('pr.merge')!
    expect(await h(null, { cwd: '/etc', number: 1, method: 'merge' })).toMatchObject({ ok: false })
    expect(await h(null, { cwd: WT, number: 1, method: 'fast-forward' })).toMatchObject({ ok: false })
    expect(merge).not.toHaveBeenCalled()
    expect(await h(null, { cwd: WT, number: 7, branch: 'ignored', method: 'squash', deleteBranch: true })).toEqual({ ok: true })
    expect(merge).toHaveBeenLastCalledWith({ cwd: WT, number: 7, method: 'squash', deleteBranch: true })
    await h(null, { cwd: WT, branch: 'me/feat', method: 'rebase' })
    expect(merge).toHaveBeenLastCalledWith({ cwd: WT, branch: 'me/feat', method: 'rebase' })
  })
})
