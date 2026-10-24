// W6-H: every guard of a push delivery (deliverByPush), over a fake git runner. A git that answers nothing in a test
// is a stop: an unexpected argv fails the push instead of passing it by accident.
import { afterEach, describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git as realGit, type GitResult } from '../../worktrees/git'
import { deliverByPush, type PushContext } from './integrateGit'
import { createJob, createTask, emptyState, startJobRun, type OrchState } from '../state'
import { deliveryWaitStep } from './deliveryWait'

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
    // backupRef before every reset --hard
    if (key === 'rev-parse --verify --quiet HEAD^{commit}') return { ok: true, stdout: head, stderr: '' }
    if (args[0] === 'update-ref') return { ok: true, stdout: '', stderr: '' }
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
  'status --porcelain --untracked-files=no': { stdout: '' },
  'var GIT_COMMITTER_IDENT': {},
  'fetch origin main': {},
  'merge --ff-only origin/main': {},
  'push origin main': {},
  'merge-base --is-ancestor origin/main HEAD': {}
})

function setup(over: Record<string, Reply | Reply[]> = {}, o: { merge?: 'ok' | 'conflict' | 'conflict-once' | 'dirty'; validate?: 'ok' | 'fail' | 'fail-second'; install?: 'ok' | 'fail' } = {}) {
  const g = fakeGit({ ...happy(), ...over })
  const merges: { into: string; paths: string[]; message?: string }[] = []
  const validated: string[] = []
  const events: string[] = []
  const logs: string[] = []
  const ctx: PushContext = {
    git: g.git,
    gitAtLeast: async () => true,
    log: (m) => logs.push(m),
    mergeWorktrees: async (into, paths, opts) => {
      merges.push({ into, paths, ...(opts?.message !== undefined ? { message: opts.message } : {}) })
      if (o.merge === 'conflict' || (o.merge === 'conflict-once' && merges.length === 1)) {
        g.setHead('merged-1')
        return { ok: false, reason: 'git merge-tree says wt-b does not merge cleanly' }
      }
      g.setHead('merged')
      return o.merge === 'dirty' ? { ok: true, merged: paths, uncommitted: 2, dirty: ['/wt-a'] } : { ok: true, merged: paths, uncommitted: 0 }
    },
    install: async () => {
      events.push('install')
      return o.install === 'fail' ? { ok: false, reason: 'npm ERR! 404 motion' } : { ok: true }
    },
    validate: async (cwd) => {
      events.push('validate')
      validated.push(cwd)
      return o.validate === 'fail' || (o.validate === 'fail-second' && validated.length === 2) ? { ok: false, reason: 'npm test exited 1' } : { ok: true, ran: 1 }
    }
  }
  const go = (branch?: string, defaultBranch?: string, local?: boolean) =>
    deliverByPush(
      { cwd: '/repo', worktrees: ['/wt-a', '/wt-b'], message: 'Deliver plan: P\n\nFixes #7', ...(branch ? { branch } : {}), ...(defaultBranch ? { defaultBranch } : {}), ...(local ? { local } : {}) },
      ctx
    )
  return { ...g, merges, validated, events, logs, go }
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

  it('installs before the validation when the merges changed a lockfile', async () => {
    const h = setup({ 'diff --name-only base HEAD': { stdout: 'src/a.ts\npackage-lock.json' } })
    const r = await h.go()
    expect(r.ok).toBe(true)
    expect(h.events).toEqual(['install', 'validate'])
  })

  it('installs when only package.json changed, in a subfolder too', async () => {
    const h = setup({ 'diff --name-only base HEAD': { stdout: 'packages/ui/package.json' } })
    await h.go()
    expect(h.events).toEqual(['install', 'validate'])
  })

  it('installs when the diff itself fails: unknown counts as changed', async () => {
    const h = setup({ 'diff --name-only base HEAD': { ok: false, stderr: 'fatal: bad revision' } })
    await h.go()
    expect(h.events).toEqual(['install', 'validate'])
  })

  it('runs no install when neither package.json nor a lockfile changed', async () => {
    const h = setup({ 'diff --name-only base HEAD': { stdout: 'src/a.ts\nREADME.md' } })
    await h.go()
    expect(h.events).toEqual(['validate'])
  })

  it('a failed install is a validation failure: no validation, merges undone, nothing pushed', async () => {
    const h = setup({ 'diff --name-only base HEAD': { stdout: 'package.json' } }, { install: 'fail' })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('installing the dependencies failed: npm ERR! 404 motion') })
    expect(h.events).toEqual(['install'])
    expect(h.head()).toBe('base')
    expect(h.calls.some((a) => a[0] === 'push')).toBe(false)
  })

  it('lands on the project branch when one is set, not origin/HEAD', async () => {
    const h = setup({ 'symbolic-ref --quiet --short HEAD': { stdout: 'release' }, 'fetch origin release': {}, 'merge --ff-only origin/release': {}, 'push origin release': {} })
    const r = await h.go('release')
    expect(r.ok && r.branch).toBe('release')
    expect(h.calls.some((a) => a.join(' ') === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD')).toBe(false)
  })

  it('stops on a folder with uncommitted tracked changes, before fetching or merging', async () => {
    const h = setup({ 'status --porcelain --untracked-files=no': { stdout: ' M src/a.ts\n M src/b.ts' } })
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
    // T1: coded, so the loop and the app can tell it from the other stops
    expect(r).toMatchObject({ ok: false, code: 'main-diverged', reason: expect.stringContaining('cannot fast-forward') })
    expect(h.merges).toEqual([])
  })

  // T11: a conflict is first another plan landing on the branch; the plan is refreshed onto it and merged once more
  it('a conflict goes back to the commit before the merges, refreshes the plan and stops when that cannot help', async () => {
    const h = setup({}, { merge: 'conflict' })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('does not merge cleanly') })
    expect(!r.ok && r.reason).toContain('refreshing onto base did not help')
    // the commit about to be lost is kept under a backup ref first
    const order = h.calls.map((a) => a[0])
    expect(order.lastIndexOf('update-ref')).toBeLessThan(order.indexOf('reset'))
    expect(h.calls.find((a) => a[0] === 'update-ref')).toEqual([
      'update-ref',
      expect.stringMatching(/^refs\/astera\/backup\/\d{8}-\d{6}-reset-hard-delivery-retry-merged-$/),
      'merged-1'
    ])
    expect(h.calls.filter((a) => a[0] === 'reset')).toEqual([['reset', '--hard', 'base']])
    expect(h.head()).toBe('base')
    expect(h.calls.some((a) => a[0] === 'push')).toBe(false)
    expect(forced(h.calls)).toBe(false)
    expect(h.validated).toEqual([])
  })

  /** A Run worktree `refreshOnto` merges `base` into cleanly (the fake ignores which worktree asks). */
  const refreshable = (): Record<string, Reply | Reply[]> => ({
    'merge-base --is-ancestor base HEAD': { ok: false },
    'cat-file -e base^{commit}': {},
    'symbolic-ref --quiet HEAD': { stdout: 'refs/heads/astera/b' },
    'status --porcelain --untracked-files=no': { stdout: '' },
    'merge-tree --write-tree HEAD base': { stdout: 'tree' },
    'var GIT_COMMITTER_IDENT': {},
    'merge --no-ff -m Refresh onto main before delivery base': {}
  })

  it('a cross-plan conflict is retried once after refreshing the plan onto the new base, then pushed', async () => {
    const h = setup(refreshable(), { merge: 'conflict-once' })
    const r = await h.go()
    expect(r).toMatchObject({ ok: true, branch: 'main', sha: 'merged' })
    expect(h.merges).toHaveLength(2)
    expect(h.calls.map((a) => a.join(' '))).toContain('merge --no-ff -m Refresh onto main before delivery base')
    expect(h.calls.some((a) => a.join(' ') === 'push origin main')).toBe(true)
    expect(forced(h.calls)).toBe(false)
    expect(h.logs.some((m) => m.includes('trying once more'))).toBe(true)
  })

  it('retries only once: a second failed merge stops the delivery', async () => {
    const h = setup(refreshable(), { merge: 'conflict' })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('after refreshing onto base') })
    expect(h.merges).toHaveLength(2)
    expect(h.calls.some((a) => a[0] === 'push')).toBe(false)
  })

  it('a refresh that conflicts stops without a second merge', async () => {
    const h = setup({ ...refreshable(), 'merge-tree --write-tree HEAD base': { ok: false, stderr: '' } }, { merge: 'conflict' })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('does not merge cleanly into') })
    expect(h.merges).toHaveLength(1)
    expect(h.calls.some((a) => a[0] === 'push')).toBe(false)
  })

  it('undoes only its own merges when the validation fails: back to the commit before them, nothing pushed', async () => {
    const h = setup({}, { validate: 'fail' })
    const r = await h.go()
    // T5: coded, so a hands-free plan opens a fix Task for it
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('npm test exited 1'), code: 'validation-failed' })
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

  it('fetches and pushes again after a rejected push, ten rounds at most, then stops, never forcing', async () => {
    const h = setup({ 'push origin main': { ok: false, stderr: '! [rejected] main -> main (fetch first)' } })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('was rejected') })
    expect(h.calls.filter((a) => a[0] === 'push')).toHaveLength(11)
    expect(h.calls.filter((a) => a[0] === 'fetch')).toHaveLength(11)
    expect(forced(h.calls)).toBe(false)
  })

  it('succeeds on the one retry when the rejection was passing', async () => {
    const h = setup({ 'push origin main': [{ ok: false, stderr: 'remote hung up' }, {}] })
    const r = await h.go()
    expect(r.ok).toBe(true)
    expect(h.calls.filter((a) => a[0] === 'push')).toHaveLength(2)
  })

  const movedOn = (merge: Reply = {}): Record<string, Reply | Reply[]> => ({
    'push origin main': [{ ok: false, stderr: '! [rejected] main -> main (fetch first)' }, {}],
    'merge-base --is-ancestor origin/main HEAD': { ok: false },
    'merge --no-edit origin/main': merge,
    'merge --abort': {},
    'rev-parse origin/main': { stdout: 'o1' }
  })

  it('when origin moved on during the delivery, merges it in, validates again and pushes, never forcing', async () => {
    const h = setup(movedOn())
    const r = await h.go()
    expect(r.ok).toBe(true)
    expect(h.calls.filter((a) => a[0] === 'push')).toHaveLength(2)
    expect(h.validated).toEqual(['/repo', '/repo'])
    expect(forced(h.calls)).toBe(false)
  })

  it('T3: undoes its merges when the moved origin does not merge cleanly, naming the conflict', async () => {
    const h = setup(movedOn({ ok: false, stderr: 'CONFLICT (content)' }))
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, code: 'origin-conflict', conflictWith: 'o1', reason: expect.stringContaining('does not merge cleanly') })
    expect(h.calls).toContainEqual(['merge', '--abort'])
    expect(h.calls.filter((a) => a[0] === 'push')).toHaveLength(1)
    expect(h.head()).toBe('base')
  })

  it('T3: a fetch that fails while catching up is fetch-failed, not rejected, and undoes the merges', async () => {
    const h = setup({
      'push origin main': { ok: false, stderr: '! [rejected] main -> main (fetch first)' },
      'fetch origin main': [{}, { ok: false, stderr: 'Could not resolve host: github.com' }]
    })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, code: 'fetch-failed', reason: expect.stringContaining('fetching origin to catch up failed') })
    expect(h.head()).toBe('base')
  })

  it('T3: a push still rejected after every round is rejected and undoes the merges', async () => {
    const h = setup({ 'push origin main': { ok: false, stderr: '! [rejected] main -> main (fetch first)' } })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, code: 'rejected' })
    expect(h.head()).toBe('base')
  })

  it('T3: leaves the merges when the owner changed the folder meanwhile', async () => {
    const h = setup({
      ...movedOn({ ok: false, stderr: 'CONFLICT (content)' }),
      'status --porcelain --untracked-files=no': [{ stdout: '' }, { stdout: ' M mine.ts' }]
    })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, code: 'origin-conflict', reason: expect.stringContaining('Your folder changed meanwhile') })
    expect(h.head()).toBe('merged')
  })

  it('undoes its merges when the validation fails after merging the moved origin', async () => {
    const h = setup(movedOn(), { validate: 'fail-second' })
    const r = await h.go()
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('after merging origin/main'), code: 'validation-failed' })
    expect(h.calls.filter((a) => a[0] === 'push')).toHaveLength(1)
    expect(h.head()).toBe('base')
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
      { mergeWorktrees: async (_into, paths) => ({ ok: true, merged: paths, uncommitted: 0 }), validate: async () => ({ ok: true, ran: 0 }), install: async () => ({ ok: true }), log: () => {} }
    )
    expect(r).toMatchObject({ ok: true, branch: 'main' })
    expect(sh(origin, 'rev-parse', 'main')).toBe(sh(work, 'rev-parse', 'HEAD'))
  })
})

// W8-A commit attribution
describe('deliverByPush pushes the attribution notes (W8-A)', () => {
  const notes = {
    'show-ref --verify --quiet refs/notes/astera': {},
    'show-ref --verify --quiet refs/notes/remotes/origin/astera': { ok: false }
  }
  const NOTES_PUSH = 'push origin refs/notes/astera:refs/notes/astera'

  it('pushes refs/notes/astera after the branch, never forced', async () => {
    const h = setup({ ...notes, [NOTES_PUSH]: {} })
    expect((await h.go()).ok).toBe(true)
    const order = h.calls.map((a) => a.join(' '))
    expect(order.indexOf(NOTES_PUSH)).toBeGreaterThan(order.indexOf('push origin main'))
    expect(h.calls.filter((a) => a[0] === 'push').some((a) => a.some((x) => x.startsWith('+') || x === '--force'))).toBe(false)
  })

  it('pushes no notes when the delivery stops before its push', async () => {
    const h = setup({ ...notes, [NOTES_PUSH]: {} }, { validate: 'fail' })
    expect((await h.go()).ok).toBe(false)
    expect(h.calls.some((a) => a.join(' ') === NOTES_PUSH)).toBe(false)
  })

  it('a rejected notes push is logged and costs the delivery nothing', async () => {
    const h = setup({ ...notes, [NOTES_PUSH]: { ok: false, stderr: 'rejected' }, 'fetch origin +refs/notes/astera:refs/notes/remotes/origin/astera': { ok: false } })
    expect((await h.go()).ok).toBe(true)
    expect(h.logs.some((l) => l.includes('refs/notes/astera') && l.includes('not pushed'))).toBe(true)
  })

  it('a repository with no notes pushes none', async () => {
    const h = setup({ 'show-ref --verify --quiet refs/notes/astera': { ok: false } })
    expect((await h.go()).ok).toBe(true)
    expect(h.calls.some((a) => a[0] === 'push' && a.includes('refs/notes/astera:refs/notes/astera'))).toBe(false)
  })
})

// T3: the guards over real repositories with a bare origin
describe('deliverByPush over a real bare origin (T3)', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })
  /** origin (bare, main), the owner's clone `work` and a teammate's clone `mate`, all with no git identity configured. */
  function repos() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'push-t3-'))
    // No identity anywhere: the delivery's own git (this process's env) must supply one for its merge commit
    writeFileSync(path.join(dir, 'nogit'), '[user]\n\tuseConfigOnly = true\n')
    for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) delete process.env[k]
    process.env.GIT_CONFIG_GLOBAL = path.join(dir, 'nogit')
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    const env = process.env
    const sh = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8', env }).trim()
    const id = ['-c', 'user.name=t', '-c', 'user.email=t@t']
    const origin = path.join(dir, 'origin.git')
    const work = path.join(dir, 'work')
    const mate = path.join(dir, 'mate')
    sh(dir, 'init', '--bare', '-b', 'main', origin)
    sh(dir, 'clone', origin, work)
    sh(work, 'checkout', '-b', 'main')
    writeFileSync(path.join(work, 'a.txt'), 'a\n')
    sh(work, 'add', '-A')
    sh(work, ...id, 'commit', '-m', 'init')
    sh(work, 'push', '-u', 'origin', 'main')
    sh(dir, 'clone', origin, mate)
    const commit = (cwd: string, file: string, text: string): void => {
      writeFileSync(path.join(cwd, file), text)
      sh(cwd, 'add', '-A')
      sh(cwd, ...id, 'commit', '-m', file)
    }
    return { dir, env, sh, origin, work, mate, commit, id }
  }
  /** A merge of "the plan" that commits `file` into the owner's folder, and a teammate push racing it (the first push is
   *  answered rejected because the teammate landed first). */
  function ctxOf(r: ReturnType<typeof repos>, o: { file: string; text: string; race?: () => void }): PushContext {
    return {
      log: () => {},
      git: async (args, opts) => {
        if (args[0] === 'push' && o.race) {
          const race = o.race
          o.race = undefined
          race()
        }
        return realGit(args, opts)
      },
      mergeWorktrees: async (into, paths) => {
        r.commit(into, o.file, o.text)
        return { ok: true, merged: paths, uncommitted: 0 }
      },
      validate: async () => ({ ok: true, ran: 0 }),
      install: async () => ({ ok: true })
    }
  }

  it('an untracked file in the owner checkout does not block delivery; a modified tracked file does', async () => {
    const r = repos()
    writeFileSync(path.join(r.work, 'scratch.txt'), 'mine')
    const ok = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [], message: 'm' }, ctxOf(r, { file: 'plan.txt', text: 'plan' }))
    expect(ok).toMatchObject({ ok: true })
    expect(r.sh(r.origin, 'rev-parse', 'main')).toBe(r.sh(r.work, 'rev-parse', 'HEAD'))
    writeFileSync(path.join(r.work, 'a.txt'), 'changed')
    const stop = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [], message: 'm' }, ctxOf(r, { file: 'plan2.txt', text: 'p' }))
    expect(stop).toMatchObject({ ok: false, reason: expect.stringContaining('uncommitted change') })
  })

  it('catches up with a teammate push by a merge commit with no git identity configured', async () => {
    const r = repos()
    const ctx = ctxOf(r, {
      file: 'plan.txt',
      text: 'plan',
      race: () => {
        r.commit(r.mate, 'mate.txt', 'mate')
        r.sh(r.mate, 'push', 'origin', 'main')
      }
    })
    const res = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [], message: 'm' }, ctx)
    expect(res).toMatchObject({ ok: true })
    expect(r.sh(r.origin, 'show', 'main:mate.txt')).toBe('mate')
    expect(r.sh(r.origin, 'show', 'main:plan.txt')).toBe('plan')
  })

  it('an origin conflict while catching up puts the local branch back where it was before the delivery', async () => {
    const r = repos()
    const before = r.sh(r.work, 'rev-parse', 'HEAD')
    const ctx = ctxOf(r, {
      file: 'a.txt',
      text: 'plan\n',
      race: () => {
        r.commit(r.mate, 'a.txt', 'mate\n')
        r.sh(r.mate, 'push', 'origin', 'main')
      }
    })
    const res = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [], message: 'm' }, ctx)
    expect(res).toMatchObject({ ok: false, code: 'origin-conflict', conflictWith: r.sh(r.origin, 'rev-parse', 'main') })
    expect(r.sh(r.work, 'rev-parse', 'HEAD')).toBe(before)
    expect(r.sh(r.work, 'status', '--porcelain')).toBe('')
  })

  it('the owner-pushed check says whether every worktree HEAD reached the branch', async () => {
    const r = repos()
    r.sh(r.mate, 'checkout', '-b', 'plan')
    r.commit(r.mate, 'p.txt', 'p')
    const ctx = ctxOf(r, { file: 'x', text: 'x' })
    const no = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [r.mate], message: 'm', ownerPushed: true }, ctx)
    expect(no).toMatchObject({ ok: false, reason: expect.stringContaining('is not on main yet') })
    r.sh(r.mate, 'push', 'origin', 'plan:main')
    const yes = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [r.mate], message: 'm', ownerPushed: true }, ctx)
    expect(yes).toMatchObject({ ok: true, branch: 'main' })
  })
  it('T1: the owner-pushed check accepts work that landed on origin as other commits (a rebase), not work still missing', async () => {
    const r = repos()
    // the plan's worktree, of the owner's repository
    const wt = path.join(r.dir, 'wt')
    r.sh(r.work, 'worktree', 'add', '-b', 'plan', wt)
    r.commit(wt, 'p.txt', 'p\n')
    const ctx = ctxOf(r, { file: 'x', text: 'x' })
    const no = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [wt], message: 'm', ownerPushed: true }, ctx)
    expect(no).toMatchObject({ ok: false, reason: expect.stringContaining('is not on main yet') })
    // the owner landed the same change on a newer main: another commit id, the same patch
    r.commit(r.mate, 'other.txt', 'o\n')
    r.commit(r.mate, 'p.txt', 'p\n')
    r.sh(r.mate, 'push', 'origin', 'main')
    expect(r.sh(r.work, 'rev-parse', 'plan')).not.toBe(r.sh(r.mate, 'rev-parse', 'HEAD'))
    const yes = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [wt], message: 'm', ownerPushed: true }, ctx)
    expect(yes).toMatchObject({ ok: true, branch: 'main', sha: r.sh(r.mate, 'rev-parse', 'HEAD') })
  })
  it('T34: the owner-pushed check accepts several commits squashed into one on origin, not work missing from it', async () => {
    const r = repos()
    const wt = path.join(r.dir, 'wt')
    r.sh(r.work, 'worktree', 'add', '-b', 'plan', wt)
    r.commit(wt, 'p.txt', 'p1\n')
    r.commit(wt, 'q.txt', 'q\n')
    const ctx = ctxOf(r, { file: 'x', text: 'x' })
    // origin gets the plan's work as ONE commit (a squash merge): no patch-id matches either worktree commit
    r.commit(r.mate, 'p.txt', 'p1\n')
    r.commit(r.mate, 'q.txt', 'q\n')
    r.sh(r.mate, 'reset', '--soft', 'HEAD~2')
    r.sh(r.mate, ...r.id, 'commit', '-m', 'squash')
    r.sh(r.mate, 'push', 'origin', 'main')
    expect(r.sh(r.work, 'cherry', 'origin/main', 'plan')).toContain('+')
    const yes = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [wt], message: 'm', ownerPushed: true }, ctx)
    expect(yes).toMatchObject({ ok: true, branch: 'main', sha: r.sh(r.mate, 'rev-parse', 'HEAD') })
    // a change the squash did not take is still refused
    r.commit(wt, 'missing.txt', 'm\n')
    const no = await deliverByPush({ cwd: r.work, branch: 'main', worktrees: [wt], message: 'm', ownerPushed: true }, ctx)
    expect(no).toMatchObject({ ok: false, reason: expect.stringContaining('is not on main yet') })
  })
})

describe('T2: a delivery that waited for another plan validates once', () => {
  /** Two done push plans of /repo; B (newer) meets A (older, so it goes first). */
  function plans() {
    let s: OrchState = emptyState()
    const ids: { job: string; run: string }[] = []
    for (const [name, at] of [['A', '2026-10-22T10:00:00.000Z'], ['B', '2026-10-22T10:00:01.000Z']] as const) {
      const j = createJob(s, { objective: name, cwd: '/repo' }, at)
      if (!j.ok) throw new Error(j.error)
      const r = startJobRun(j.state, j.value.id, at)
      if (!r.ok) throw new Error(r.error)
      const t = createTask(r.state, { runId: r.value.id, title: name, spec: 's', deps: [] }, at)
      if (!t.ok) throw new Error(t.error)
      s = { ...t.state, tasks: t.state.tasks.map((x) => (x.id === t.value.id ? { ...x, status: 'completed' } : x)) }
      ids.push({ job: j.value.id, run: r.value.id })
    }
    const [a, b] = ids
    s = {
      ...s,
      jobs: s.jobs.map((j) => ({
        ...j,
        delivery: 'push' as const,
        ...(j.id === b.job ? { overlaps: [{ taskId: 't', jobId: a.job, otherTaskId: 'u', by: 'path' as const, path: 'src/x.ts' }] } : {})
      }))
    }
    return { s, a, b }
  }

  it('B does not start while A lands; after A delivered it fetches origin once and validates once', async () => {
    const p = plans()
    let s = p.s
    const h = setup()
    const tick = async (at: string): Promise<boolean> => {
      const w = deliveryWaitStep(s, p.b.run, at)
      s = w.state
      if (w.waitingFor) return false
      await h.go()
      return true
    }
    expect(await tick('2026-10-22T10:01:00.000Z')).toBe(false)
    expect(await tick('2026-10-22T10:02:00.000Z')).toBe(false)
    expect(s.runs.find((r) => r.id === p.b.run)?.deliveryState?.waitingFor?.jobId).toBe(p.a.job)
    expect(h.calls).toEqual([])
    s = { ...s, runs: s.runs.map((r) => (r.id === p.a.run ? { ...r, delivery: { at: '2026-10-22T10:03:00.000Z', branch: 'main', sha: 'a1' } } : r)) }
    expect(await tick('2026-10-22T10:04:00.000Z')).toBe(true)
    expect(h.validated).toEqual(['/repo'])
    expect(h.calls.filter((c) => c[0] === 'fetch')).toHaveLength(1)
    expect(h.calls.filter((c) => c[0] === 'push' && c[2] === 'main')).toHaveLength(1)
  })
})

describe('T6: a local merge delivery', () => {
  const noOrigin = { 'symbolic-ref --quiet --short refs/remotes/origin/HEAD': { ok: false } }

  it('merges and validates into the folder\'s own branch, and never fetches or pushes', async () => {
    const h = setup(noOrigin)
    const r = await h.go(undefined, undefined, true)
    expect(r).toEqual({ ok: true, branch: 'main', sha: 'merged', merged: ['/wt-a', '/wt-b'], validated: 1 })
    expect(h.merges).toHaveLength(1)
    expect(h.validated).toEqual(['/repo'])
    expect(h.calls.some((c) => c[0] === 'fetch' || c[0] === 'push')).toBe(false)
  })

  it('refuses a folder with uncommitted changes on that branch', async () => {
    const h = setup({ ...noOrigin, 'status --porcelain --untracked-files=no': { stdout: ' M a.ts' } })
    const r = await h.go('main', undefined, true)
    expect(r).toMatchObject({ ok: false, reason: 'your folder /repo has 1 uncommitted change(s)' })
    expect(h.merges).toEqual([])
  })

  it('refuses a folder on another branch than the delivery branch', async () => {
    const h = setup({ ...noOrigin, 'symbolic-ref --quiet --short HEAD': { stdout: 'feature' } })
    const r = await h.go('main', undefined, true)
    expect(r).toMatchObject({ ok: false, reason: 'your folder /repo is on branch feature, not main' })
  })

  it('undoes its merges when the validation fails', async () => {
    const h = setup(noOrigin, { validate: 'fail' })
    const r = await h.go('main', undefined, true)
    expect(r).toMatchObject({ ok: false, code: 'validation-failed' })
    expect(h.head()).toBe('base')
  })
})
