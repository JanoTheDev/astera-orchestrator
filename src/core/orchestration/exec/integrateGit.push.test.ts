// W6-H: every guard of a push delivery (deliverByPush), over a fake git runner. A git that answers nothing in a test
// is a stop: an unexpected argv fails the push instead of passing it by accident.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { GitResult } from '../../worktrees/git'
import { deliverByPush, type PushContext } from './integrateGit'

type Reply = Partial<GitResult> | ((cwd?: string) => Partial<GitResult>)

/** A git that answers each argv (joined by spaces) from `replies`, records every call, and moves HEAD with `merge`
 *  (the fake mergeWorktrees) and `reset --hard`. */
function fakeGit(replies: Record<string, Reply | Reply[]>) {
  const calls: string[][] = []
  let head = 'base'
  const left: Record<string, Reply[]> = {}
  for (const [k, v] of Object.entries(replies)) left[k] = Array.isArray(v) ? [...v] : [v]
  const git = (async (args: string[], opts?: { cwd?: string }) => {
    calls.push(args)
    const key = args.join(' ')
    if (key === 'rev-parse HEAD') return { ok: true, stdout: head, stderr: '' }
    if (args[0] === 'reset' && args[1] === '--hard') {
      const r = left[key]?.shift()
      if (r === undefined) head = args[2]
      const v = typeof r === 'function' ? r(opts?.cwd) : r
      return { ok: true, stdout: '', stderr: '', ...v }
    }
    const queue = left[key]
    const r = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (r === undefined) return { ok: false, stdout: '', stderr: `unexpected git ${key}` }
    const v = typeof r === 'function' ? r(opts?.cwd) : r
    return { ok: true, stdout: '', stderr: '', ...v }
  }) as unknown as NonNullable<PushContext['git']>
  return { git, calls, setHead: (h: string) => (head = h), head: () => head }
}

/** The happy path's answers; a test overrides the one it is about. */
const happy = (): Record<string, Reply | Reply[]> => ({
  'symbolic-ref --quiet --short refs/remotes/origin/HEAD': { stdout: 'origin/main' },
  'symbolic-ref --quiet --short HEAD': { stdout: 'main' },
  'status --porcelain': { stdout: '' },
  'fetch origin main': {},
  'merge --ff-only origin/main': {},
  'push origin main': {},
  'merge-base --is-ancestor origin/main HEAD': {}
})

function setup(over: Record<string, Reply | Reply[]> = {}, o: { merge?: 'ok' | 'conflict' | 'dirty'; validate?: 'ok' | 'fail' } = {}) {
  const g = fakeGit({ ...happy(), ...over })
  const merges: { into: string; paths: string[]; message?: string }[] = []
  const validated: string[] = []
  const logs: string[] = []
  const ctx: PushContext = {
    git: g.git,
    log: (m) => logs.push(m),
    mergeWorktrees: async (into, paths, opts) => {
      merges.push({ into, paths, ...(opts?.message !== undefined ? { message: opts.message } : {}) })
      if (o.merge === 'conflict') {
        g.setHead('merged-1')
        return { ok: false, reason: 'git merge-tree says wt-b does not merge cleanly' }
      }
      g.setHead('merged')
      return o.merge === 'dirty' ? { ok: true, merged: paths, uncommitted: 2, dirty: ['/wt-a'] } : { ok: true, merged: paths, uncommitted: 0 }
    },
    validate: async (cwd) => {
      validated.push(cwd)
      return o.validate === 'fail' ? { ok: false, reason: 'npm test exited 1' } : { ok: true, ran: 1 }
    }
  }
  const go = (branch?: string, defaultBranch?: string) =>
    deliverByPush(
      { cwd: '/repo', worktrees: ['/wt-a', '/wt-b'], message: 'Deliver plan: P\n\nFixes #7', ...(branch ? { branch } : {}), ...(defaultBranch ? { defaultBranch } : {}) },
      ctx
    )
  return { ...g, merges, validated, logs, go }
}

const forced = (calls: string[][]): boolean => calls.some((a) => a.some((x) => x === '--force' || x.startsWith('--force-with-lease') || x === '-f' || x.startsWith('+')))

describe('deliverByPush (W6-H)', () => {
  it('fetches, fast-forwards, merges with the message, validates, then pushes to origin main', async () => {
    const h = setup()
    const r = await h.go()
    expect(r).toEqual({ ok: true, branch: 'main', sha: 'merged', merged: ['/wt-a', '/wt-b'], validated: 1 })
    expect(h.merges).toEqual([{ into: '/repo', paths: ['/wt-a', '/wt-b'], message: 'Deliver plan: P\n\nFixes #7' }])
    expect(h.validated).toEqual(['/repo'])
    const order = h.calls.map((a) => a.join(' '))
    expect(order.indexOf('fetch origin main')).toBeLessThan(order.indexOf('merge --ff-only origin/main'))
    expect(order).toContain('push origin main')
    expect(forced(h.calls)).toBe(false)
  })

  it('lands on the project branch when one is set, not origin/HEAD', async () => {
    const h = setup({ 'symbolic-ref --quiet --short HEAD': { stdout: 'release' }, 'fetch origin release': {}, 'merge --ff-only origin/release': {}, 'push origin release': {} })
    const r = await h.go('release')
    expect(r.ok && r.branch).toBe('release')
    expect(h.calls.some((a) => a.join(' ') === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD')).toBe(false)
  })

  it('stops on a folder with uncommitted changes, before fetching or merging', async () => {
    const h = setup({ 'status --porcelain': { stdout: ' M src/a.ts\n?? notes.txt' } })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('has 2 uncommitted change(s)') })
    expect(h.calls.some((a) => a[0] === 'fetch' || a[0] === 'stash' || a[0] === 'reset')).toBe(false)
    expect(h.merges).toEqual([])
  })

  it('stops on a folder on another branch', async () => {
    const h = setup({ 'symbolic-ref --quiet --short HEAD': { stdout: 'feature/x' } })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('is on branch feature/x, not main') })
    expect(h.merges).toEqual([])
  })

  it('stops when the local branch cannot fast-forward to origin', async () => {
    const h = setup({ 'merge --ff-only origin/main': { ok: false, stderr: 'fatal: Not possible to fast-forward, aborting.' } })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('cannot fast-forward') })
    expect(h.merges).toEqual([])
  })

  it('stops on a conflict and leaves the folder as the merge left it', async () => {
    const h = setup({}, { merge: 'conflict' })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('does not merge cleanly') })
    expect(!r.ok && r.reason).toContain('git reset --hard base undoes them')
    expect(h.calls.some((a) => a[0] === 'reset' || a[0] === 'push')).toBe(false)
    expect(h.validated).toEqual([])
  })

  it('undoes only its own merges when the validation fails: back to the commit before them, nothing pushed', async () => {
    const h = setup({}, { validate: 'fail' })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('npm test exited 1') })
    expect(h.calls.filter((a) => a[0] === 'reset')).toEqual([['reset', '--hard', 'base']])
    expect(h.head()).toBe('base')
    expect(h.calls.some((a) => a[0] === 'push')).toBe(false)
  })

  it('undoes its merges when a worktree held work that was not merged', async () => {
    const h = setup({}, { merge: 'dirty' })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('/wt-a') })
    expect(h.head()).toBe('base')
    expect(h.validated).toEqual([])
  })

  it('fetches and pushes once more after a rejected push, then stops, never forcing', async () => {
    const h = setup({ 'push origin main': { ok: false, stderr: '! [rejected] main -> main (fetch first)' } })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('was rejected') })
    expect(h.calls.filter((a) => a[0] === 'push')).toHaveLength(2)
    expect(h.calls.filter((a) => a[0] === 'fetch')).toHaveLength(2)
    expect(forced(h.calls)).toBe(false)
  })

  it('succeeds on the one retry when the rejection was passing', async () => {
    const h = setup({ 'push origin main': [{ ok: false, stderr: 'remote hung up' }, {}] })
    const r = await h.go()
    expect(r.ok).toBe(true)
    expect(h.calls.filter((a) => a[0] === 'push')).toHaveLength(2)
  })

  it('does not push again when origin moved on: the retry would not be a fast-forward', async () => {
    const h = setup({ 'push origin main': { ok: false, stderr: 'rejected' }, 'merge-base --is-ancestor origin/main HEAD': { ok: false } })
    const r = await h.go()
    expect(r.ok).toBe(false)
    expect(h.calls.filter((a) => a[0] === 'push')).toHaveLength(1)
  })

  it('stops when the default branch cannot be told', async () => {
    const h = setup({ 'symbolic-ref --quiet --short refs/remotes/origin/HEAD': { ok: false } })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('delivery branch') })
  })

  it("falls back to the project's recorded default branch when origin/HEAD is not set (#102)", async () => {
    const h = setup({ 'symbolic-ref --quiet --short refs/remotes/origin/HEAD': { ok: false } })
    const r = await h.go(undefined, 'main')
    expect(r).toMatchObject({ ok: true, branch: 'main' })
  })
})

describe('deliverByPush with a real bare origin that has no HEAD ref (W8-G #102)', () => {
  it('pushes to the project default branch', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'push-'))
    const sh = (cwd: string, ...a: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()
    const origin = path.join(dir, 'origin.git')
    const work = path.join(dir, 'work')
    sh(dir, 'init', '--bare', '-b', 'trunk', origin)
    sh(dir, 'init', '-b', 'main', work)
    writeFileSync(path.join(work, 'a.txt'), 'a')
    sh(work, 'add', '-A')
    sh(work, 'commit', '-m', 'init')
    sh(work, 'remote', 'add', 'origin', origin)
    sh(work, 'push', '-u', 'origin', 'main')
    expect(() => sh(work, 'symbolic-ref', 'refs/remotes/origin/HEAD')).toThrow() // the case: origin/HEAD is not set
    const r = await deliverByPush(
      { cwd: work, defaultBranch: 'main', worktrees: [], message: 'm' },
      { mergeWorktrees: async (_into, paths) => ({ ok: true, merged: paths, uncommitted: 0 }), validate: async () => ({ ok: true, ran: 0 }), log: () => {} }
    )
    expect(r).toMatchObject({ ok: true, branch: 'main' })
    expect(sh(origin, 'rev-parse', 'main')).toBe(sh(work, 'rev-parse', 'HEAD'))
  })
})
