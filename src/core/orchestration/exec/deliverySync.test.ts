// 2026-11-03: deliveries to one branch are serialized end to end (merge, checks, hook, push), a failed delivery is due
// again once the branch moves, and a push round after a non-fast-forward rejection runs the hook again only when the
// newly arrived commits touch what the delivery changes. Over real repositories with a bare origin.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { git as realGit } from '../../worktrees/git'
import { deliverByPush, type PushContext } from './integrateGit'
import { deliveryLockHolder, deliveryLockKey, withDeliveryLock } from './deliveryLock'
import { readDeliveryHeads } from './dispatchLoop'
import { afterAttempt, deliveryDue } from '../delivery'

const id = ['-c', 'user.name=t', '-c', 'user.email=t@t']

/** origin (bare, main, origin/HEAD set in the clones), the owner's checkout `work` and a teammate's clone `mate`. */
function repos() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deliv-sync-'))
  const sh = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
  const origin = path.join(dir, 'origin.git')
  const work = path.join(dir, 'work')
  const mate = path.join(dir, 'mate')
  sh(dir, 'init', '--bare', '-b', 'main', origin)
  sh(dir, 'clone', origin, work)
  sh(work, 'checkout', '-b', 'main')
  writeFileSync(path.join(work, 'a.txt'), 'a\n')
  writeFileSync(path.join(work, 'shared.txt'), Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n') + '\n')
  sh(work, 'add', '-A')
  sh(work, ...id, 'commit', '-m', 'init')
  sh(work, 'push', '-u', 'origin', 'main')
  sh(work, 'remote', 'set-head', 'origin', 'main')
  sh(dir, 'clone', origin, mate)
  const commit = (cwd: string, file: string, text: string): void => {
    writeFileSync(path.join(cwd, file), text)
    sh(cwd, 'add', '-A')
    sh(cwd, ...id, 'commit', '-m', `${file}: ${text.slice(0, 20)}`)
  }
  return { dir, sh, origin, work, mate, commit }
}

type Repos = ReturnType<typeof repos>

/** A plan's delivery context: its "merge" commits `file` into the checkout, its validation and every git call recorded. */
function plan(r: Repos, name: string, file: string, text: string, events: string[], o: { validate?: () => Promise<boolean>; race?: () => void } = {}) {
  const calls: string[][] = []
  let race = o.race
  const ctx: PushContext = {
    log: () => {},
    git: async (args, opts) => {
      calls.push(args)
      if (args[0] === 'push' && args.includes('main') && race) {
        const go = race
        race = undefined
        go()
      }
      const res = await realGit(args, opts)
      if (args[0] === 'push' && res.ok && args.includes('main')) events.push(`${name}:pushed`)
      return res
    },
    mergeWorktrees: async (into, paths) => {
      events.push(`${name}:merge on ${r.sh(into, 'log', '--format=%s', '-1')}`)
      try {
        r.commit(into, file, text)
      } catch {
        return { ok: false, reason: `${name} does not merge cleanly` }
      }
      return { ok: true, merged: paths, uncommitted: 0 }
    },
    validate: async () => {
      events.push(`${name}:validate`)
      const ok = o.validate ? await o.validate() : true
      return ok ? { ok: true, ran: 1 } : { ok: false, reason: `${name}'s checks failed` }
    },
    install: async () => ({ ok: true })
  }
  return { ctx, calls, go: () => deliverByPush({ cwd: r.work, branch: 'main', worktrees: [], message: `Deliver plan: ${name}` }, ctx) }
}

const until = async (cond: () => boolean, ms = 20_000): Promise<void> => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((res) => setTimeout(res, 20))
  }
}

describe('deliveries to one branch are serialized end to end', () => {
  it("plan B waits for plan A's in-flight delivery, then lands on A's pushed tip", async () => {
    const r = repos()
    const events: string[] = []
    let releaseA: () => void = () => {}
    const aChecks = new Promise<boolean>((res) => (releaseA = () => res(true)))
    const A = plan(r, 'A', 'a-plan.txt', 'A', events, { validate: () => aChecks })
    const B = plan(r, 'B', 'b-plan.txt', 'B', events)
    const a = A.go()
    await until(() => events.includes('A:validate'))
    const b = B.go()
    // B is in line behind A: it has not touched the checkout (not even its status) while A validates
    await new Promise((res) => setTimeout(res, 500))
    expect(events.some((e) => e.startsWith('B:'))).toBe(false)
    expect(B.calls.some((c) => c[0] === 'status' || c[0] === 'merge' || c[0] === 'fetch')).toBe(false)
    expect(deliveryLockHolder(await deliveryLockKey(r.work, 'main'))?.label).toBe('Deliver plan: A')
    releaseA()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toMatchObject({ ok: true })
    expect(rb).toMatchObject({ ok: true })
    // B merged only after A was pushed, on top of A's commit
    expect(events.indexOf('A:pushed')).toBeLessThan(events.findIndex((e) => e.startsWith('B:merge')))
    expect(events.find((e) => e.startsWith('B:merge'))).toBe('B:merge on a-plan.txt: A')
    expect(r.sh(r.origin, 'show', 'main:a-plan.txt')).toBe('A')
    expect(r.sh(r.origin, 'show', 'main:b-plan.txt')).toBe('B')
    expect(r.sh(r.work, 'rev-parse', 'HEAD')).toBe(r.sh(r.origin, 'rev-parse', 'main'))
  })

  it("a plan that conflicts only with another plan's in-flight merge is judged on the tip that plan leaves, not its unpushed commits", async () => {
    const r = repos()
    const events: string[] = []
    let failA: () => void = () => {}
    const aChecks = new Promise<boolean>((res) => (failA = () => res(false)))
    // Both change a.txt: B would conflict with A's merge if it were judged on A's unpushed commits
    const A = plan(r, 'A', 'a.txt', 'from A\n', events, { validate: () => aChecks })
    const B = plan(r, 'B', 'a.txt', 'from B\n', events)
    const before = r.sh(r.work, 'rev-parse', 'HEAD')
    const a = A.go()
    await until(() => events.includes('A:validate'))
    const b = B.go()
    // Long enough for B to reach its merge if nothing held it back
    await until(() => events.some((e) => e.startsWith('B:merge')), 3_000).catch(() => {})
    failA()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toMatchObject({ ok: false, code: 'validation-failed' })
    expect(rb).toMatchObject({ ok: true })
    expect(events.find((e) => e.startsWith('B:merge'))).toBe('B:merge on init')
    expect(r.sh(r.origin, 'show', 'main:a.txt')).toBe('from B')
    expect(r.sh(r.origin, 'rev-parse', 'main^')).toBe(before)
  })

  it('a delivery that waits past the limit stops as delivery-busy without touching the checkout', async () => {
    const key = `test-key-${Math.random()}`
    let free: () => void = () => {}
    const holding = withDeliveryLock(key, 'Deliver plan: A', () => new Promise<void>((res) => (free = res)))
    let ran = false
    const waited = await withDeliveryLock(key, 'Deliver plan: B', async () => (ran = true), { waitMs: 50 })
    expect(waited).toMatchObject({ ok: false, holder: 'Deliver plan: A' })
    expect(ran).toBe(false)
    free()
    await holding
    // The line is free again: the next one runs at once
    expect(await withDeliveryLock(key, 'Deliver plan: C', async () => 'c', { waitMs: 50 })).toEqual({ ok: true, value: 'c' })
  })
})

describe('a failed delivery is due again when its target branch moves', () => {
  it("reads origin's default branch when the plan names none, and a move of it makes the retry due before its backoff", async () => {
    const r = repos()
    const at = '2026-11-03T10:04:42.000Z'
    const heads = await readDeliveryHeads({ worktree: r.work, projectCwd: r.work })
    expect(heads.origin).toBe(r.sh(r.work, 'rev-parse', 'origin/main'))
    const failed = afterAttempt({ state: 'delivering', attempts: 0 }, at, 'git merge-tree says X does not merge cleanly', { code: 'worktree-conflict', heads })
    const soon = Date.parse(at) + 30_000 // the backoff (1 minute) has not run out
    expect(deliveryDue(failed, soon, await readDeliveryHeads({ worktree: r.work, projectCwd: r.work }))).toBe(false)
    // Another plan lands on origin's main; this computer's next fetch sees it
    r.commit(r.mate, 'landed.txt', 'other plan')
    r.sh(r.mate, 'push', 'origin', 'main')
    r.sh(r.work, 'fetch', 'origin', 'main')
    const moved = await readDeliveryHeads({ worktree: r.work, projectCwd: r.work })
    expect(moved.origin).not.toBe(heads.origin)
    expect(deliveryDue(failed, soon, moved)).toBe(true)
  })
})

describe('a push round after a non-fast-forward rejection', () => {
  /** A pre-push hook that counts its runs in a file outside the repository. */
  function countingHook(r: Repos): () => number {
    const runs = path.join(r.dir, 'hook-runs').replace(/\\/g, '/')
    writeFileSync(path.join(r.work, '.git', 'hooks', 'pre-push'), `#!/bin/sh\ncat > /dev/null\necho run >> "${runs}"\nexit 0\n`, { mode: 0o755 })
    return () => (existsSync(runs) ? readFileSync(runs, 'utf8').split('\n').filter((l) => l === 'run').length : 0)
  }

  it("skips the checks and the hook when origin's new commits touch none of the delivery's files, and git push never runs the hook again", async () => {
    const r = repos()
    const hookRuns = countingHook(r)
    const events: string[] = []
    const P = plan(r, 'P', 'plan.txt', 'plan', events, {
      race: () => {
        r.commit(r.mate, 'mate.txt', 'mate')
        r.sh(r.mate, 'push', 'origin', 'main')
      }
    })
    const res = await P.go()
    expect(res).toMatchObject({ ok: true })
    expect(hookRuns()).toBe(1) // Astera's gate only: not inside either git push, not again for the round
    expect(events.filter((e) => e === 'P:validate')).toHaveLength(1)
    const pushes = P.calls.filter((c) => c[0] === 'push' && c.includes('main'))
    expect(pushes).toHaveLength(2)
    for (const p of pushes) expect(p).toContain('--no-verify')
    expect(r.sh(r.origin, 'show', 'main:mate.txt')).toBe('mate')
    expect(r.sh(r.origin, 'show', 'main:plan.txt')).toBe('plan')
  })

  it('validates and runs the hook again when the new commits touch a file the delivery changes', async () => {
    const r = repos()
    const hookRuns = countingHook(r)
    const events: string[] = []
    const lines = (edit: (l: string[]) => void): string => {
      const l = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`)
      edit(l)
      return l.join('\n') + '\n'
    }
    // Both change shared.txt, far apart: a clean merge that still needs the checks again
    const P = plan(r, 'P', 'shared.txt', lines((l) => (l[0] = 'plan line 1')), events, {
      race: () => {
        r.commit(r.mate, 'shared.txt', lines((l) => (l[11] = 'mate line 12')))
        r.sh(r.mate, 'push', 'origin', 'main')
      }
    })
    const res = await P.go()
    expect(res).toMatchObject({ ok: true })
    expect(hookRuns()).toBe(2)
    expect(events.filter((e) => e === 'P:validate')).toHaveLength(2)
    const shared = r.sh(r.origin, 'show', 'main:shared.txt')
    expect(shared).toContain('plan line 1')
    expect(shared).toContain('mate line 12')
  })

  it('a hook that fails on the round is push-refused, reported as the first gate reports it, and nothing is pushed', async () => {
    const r = repos()
    const before = r.sh(r.work, 'rev-parse', 'HEAD')
    const runs = path.join(r.dir, 'hook-runs').replace(/\\/g, '/')
    // Passes once (the gate before the first push), fails after (the round's)
    writeFileSync(
      path.join(r.work, '.git', 'hooks', 'pre-push'),
      `#!/bin/sh\ncat > /dev/null\nif [ -f "${runs}" ]; then echo "lint: error in shared.txt"; exit 1; fi\necho run > "${runs}"\nexit 0\n`,
      { mode: 0o755 }
    )
    const events: string[] = []
    const original = readFileSync(path.join(r.work, 'shared.txt'), 'utf8')
    const P = plan(r, 'P', 'shared.txt', original.replace('line 1\n', 'plan 1\n'), events, {
      race: () => {
        r.commit(r.mate, 'shared.txt', original.replace('line 12', 'mate 12'))
        r.sh(r.mate, 'push', 'origin', 'main')
      }
    })
    const res = await P.go()
    expect(res).toMatchObject({ ok: false, code: 'push-refused', reason: expect.stringContaining('lint: error in shared.txt') })
    expect(r.sh(r.work, 'rev-parse', 'HEAD')).toBe(before)
    expect(r.sh(r.origin, 'show', 'main:shared.txt')).toContain('mate 12')
    expect(r.sh(r.origin, 'show', 'main:shared.txt')).not.toContain('plan 1')
  })
})
