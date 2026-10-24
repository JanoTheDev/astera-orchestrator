import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkSource, createSourceUpdater, isSourceRepo } from './sourceUpdate'
import type { UpdateStatus } from '../core/types'

let dir: string
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8'
  }).trim()

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-source-update-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** A bare "origin" and the owner's checkout cloned from it, both on main with one commit. */
function repoPair(): { origin: string; checkout: string; pusher: string } {
  const origin = path.join(dir, 'origin.git')
  const checkout = path.join(dir, 'checkout')
  const pusher = path.join(dir, 'pusher')
  execFileSync('git', ['init', '--bare', '--quiet', '-b', 'main', origin])
  execFileSync('git', ['clone', '--quiet', origin, pusher], { stdio: 'ignore' })
  git(pusher, 'checkout', '--quiet', '-b', 'main')
  git(pusher, 'commit', '--quiet', '--allow-empty', '-m', 'first')
  git(pusher, 'push', '--quiet', 'origin', 'main')
  execFileSync('git', ['clone', '--quiet', origin, checkout], { stdio: 'ignore' })
  return { origin, checkout, pusher }
}

describe('checkSource', () => {
  it('is up to date when the built commit is origin/main, and two behind after two pushes', async () => {
    const { checkout, pusher } = repoPair()
    const built = git(checkout, 'rev-parse', 'HEAD')
    expect(await checkSource(checkout, built)).toEqual({ behind: 0, commits: [], target: built })

    git(pusher, 'commit', '--quiet', '--allow-empty', '-m', 'fix: second')
    git(pusher, 'commit', '--quiet', '--allow-empty', '-m', 'feat: third')
    git(pusher, 'push', '--quiet', 'origin', 'main')
    const head = git(pusher, 'rev-parse', 'HEAD')

    const r = await checkSource(checkout, built)
    expect(r.behind).toBe(2)
    expect(r.target).toBe(head)
    expect(r.commits.map((c) => c.subject)).toEqual(['feat: third', 'fix: second'])
    // The owner's working tree and branch are left where they were.
    expect(git(checkout, 'rev-parse', 'HEAD')).toBe(built)
  })

  it('isSourceRepo needs a git checkout with an origin remote', async () => {
    const { checkout } = repoPair()
    expect(await isSourceRepo(checkout)).toBe(true)
    expect(await isSourceRepo(path.join(dir, 'missing'))).toBe(false)
    const lone = path.join(dir, 'lone')
    execFileSync('git', ['init', '--quiet', lone])
    expect(await isSourceRepo(lone)).toBe(false)
  })
})

describe('createSourceUpdater', () => {
  const updater = (checkout: string, built: string, pushed: UpdateStatus[], platform: NodeJS.Platform = 'darwin') =>
    createSourceUpdater({
      sourceDir: checkout,
      builtCommit: built,
      userData: path.join(dir, 'userData'),
      platform,
      appImage: undefined,
      getMode: () => 'notify',
      push: (s) => pushed.push(s),
      log: () => {},
      text: (k) => k,
      idleSeconds: () => 0,
      quitForInstall: async () => {}
    })

  it('a manual check pushes checking then uptodate, then available with the commits', async () => {
    const { checkout, pusher } = repoPair()
    const built = git(checkout, 'rev-parse', 'HEAD')
    const pushed: UpdateStatus[] = []
    const u = updater(checkout, built, pushed)
    u.start()
    try {
      await u.check(true)
      expect(pushed.map((s) => s.state)).toEqual(['checking', 'uptodate'])

      git(pusher, 'commit', '--quiet', '--allow-empty', '-m', 'fix: second')
      git(pusher, 'commit', '--quiet', '--allow-empty', '-m', 'feat: third')
      git(pusher, 'push', '--quiet', 'origin', 'main')
      await u.check(true)
      const last = pushed.at(-1)!
      expect(last.state).toBe('available')
      expect(last.source?.behind).toBe(2)
      expect(last.source?.commits.map((c) => c.subject)).toEqual(['feat: third', 'fix: second'])
      expect(last.version).toBe(git(pusher, 'rev-parse', 'HEAD').slice(0, 7))
    } finally {
      u.stop()
    }
  })

  it('announces the commits that came in once, when the app boots on a different build than last run', async () => {
    const { checkout, pusher } = repoPair()
    const first = git(checkout, 'rev-parse', 'HEAD')
    const boot = async (built: string): Promise<unknown> => {
      const u = updater(checkout, built, [])
      u.start()
      try {
        return await u.justUpdated()
      } finally {
        u.stop()
      }
    }
    expect(await boot(first)).toBeNull() // first run: nothing to compare with
    git(pusher, 'commit', '--quiet', '--allow-empty', '-m', 'fix: second')
    git(pusher, 'commit', '--quiet', '--allow-empty', '-m', 'feat: third')
    git(pusher, 'push', '--quiet', 'origin', 'main')
    git(checkout, 'pull', '--quiet', 'origin', 'main')
    const next = git(checkout, 'rev-parse', 'HEAD')
    expect(await boot(next)).toEqual({ sha: next.slice(0, 7), commits: [
      { sha: next, subject: 'feat: third' },
      { sha: expect.any(String), subject: 'fix: second' }
    ] })
    expect(await boot(next)).toBeNull() // shown once
  })

  it('still announces the sha when the previous commit is unknown to git', async () => {
    const { checkout } = repoPair()
    const built = git(checkout, 'rev-parse', 'HEAD')
    await fs.mkdir(path.join(dir, 'userData', 'self-update'), { recursive: true })
    await fs.writeFile(path.join(dir, 'userData', 'self-update', 'state.json'), JSON.stringify({ lastRunCommit: 'f'.repeat(40) }))
    const u = updater(checkout, built, [])
    u.start()
    try {
      expect(await u.justUpdated()).toEqual({ sha: built.slice(0, 7), commits: [] })
    } finally {
      u.stop()
    }
  })

  it('install refuses where it cannot self-install, and a missing checkout is an error only when asked', async () => {
    const pushed: UpdateStatus[] = []
    const u = updater(path.join(dir, 'missing'), 'abc', pushed)
    u.start()
    try {
      expect(await u.install()).toEqual({ mode: 'failed', message: 'update.source.nothingToInstall' })
      await u.check(true)
      expect(pushed).toEqual([{ state: 'error', message: 'update.source.noCheckout' }])
    } finally {
      u.stop()
    }
  })
})
