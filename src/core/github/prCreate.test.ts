import { describe, it, expect } from 'vitest'
import { createPullRequest, pushBranch, readCommits, type PrCreateRequest } from './prCreate'

const req = (over: Partial<PrCreateRequest> = {}): PrCreateRequest => ({
  worktreePath: 'C:/wt/opal',
  repoPath: 'D:/repo',
  branch: 'parsingk/opal',
  base: 'develop',
  title: 't',
  body: 'b',
  draft: false,
  needsPush: false,
  ...over
})

const okGh = { ok: true, stdout: 'https://github.com/o/r/pull/7', stderr: '' }
const okGit = { ok: true, stdout: '', stderr: '' }

describe('createPullRequest', () => {
  it('creates without pushing when the branch is already on the remote', async () => {
    const gitCalls: string[][] = []
    const r = await createPullRequest(req(), {
      runGit: async (a) => {
        gitCalls.push(a)
        return okGit
      },
      runGh: async () => okGh,
      normalizeBase: async (_r, b) => b
    })
    expect(r).toEqual({ ok: true, url: 'https://github.com/o/r/pull/7' })
    expect(gitCalls).toEqual([])
  })

  it('pushes with -u and only then creates', async () => {
    const order: string[] = []
    const r = await createPullRequest(req({ needsPush: true }), {
      runGit: async (a) => {
        order.push('git ' + a.join(' '))
        return okGit
      },
      runGh: async (a) => {
        order.push('gh ' + a.join(' '))
        return okGh
      },
      normalizeBase: async (_r, b) => b
    })
    expect(r.ok).toBe(true)
    expect(order[0]).toBe('git fetch origin parsingk/opal')
    expect(order.at(-2)).toBe('git push -u origin parsingk/opal')
    expect(order.at(-1)).toContain('gh pr create')
  })

  // A force fallback here would rewrite someone's remote branch to make a button work.
  it('never falls back to force when the push is rejected', async () => {
    const calls: string[][] = []
    const r = await createPullRequest(req({ needsPush: true }), {
      runGit: async (a) => {
        calls.push(a)
        return a[0] === 'remote' ? { ok: true, stdout: 'git@github.com:o/r.git', stderr: '' } : { ok: false, stdout: '', stderr: 'rejected: non-fast-forward' }
      },
      runGh: async () => okGh,
      normalizeBase: async (_r, b) => b
    })
    expect(r).toEqual({
      ok: false,
      stage: 'push',
      kind: 'rejected',
      detail: 'rejected: non-fast-forward',
      pushed: false
    })
    expect(calls.filter((a) => a[0] === 'push')).toHaveLength(1)
    expect(calls.map((a) => a.join(' ')).join('\n')).not.toContain('force')
  })

  // W7-E (#80): no `origin` is a project without a remote, not a rejected push
  it('says no-remote when the push fails because there is no origin', async () => {
    const r = await createPullRequest(req({ needsPush: true }), {
      runGit: async () => ({ ok: false, stdout: '', stderr: "fatal: 'origin' does not appear to be a git repository" }),
      runGh: async () => okGh,
      normalizeBase: async (_r, b) => b
    })
    expect(r).toMatchObject({ ok: false, stage: 'push', kind: 'no-remote', pushed: false })
  })

  // Leaving this out invites someone to undo a push that was fine.
  it('reports that the push already succeeded when only the create failed', async () => {
    const r = await createPullRequest(req({ needsPush: true }), {
      runGit: async () => okGit,
      runGh: async () => ({ ok: false, stdout: '', stderr: 'HTTP 403: API rate limit exceeded' }),
      normalizeBase: async (_r, b) => b
    })
    expect(r).toMatchObject({ ok: false, stage: 'create', kind: 'rate-limit', pushed: true })
  })

  it('recognises an already-existing PR as its own kind', async () => {
    const r = await createPullRequest(req(), {
      runGit: async () => okGit,
      runGh: async () => ({
        ok: false,
        stdout: '',
        stderr: 'a pull request for branch "parsingk/opal" into branch "develop" already exists:\nhttps://github.com/o/r/pull/3'
      }),
      normalizeBase: async (_r, b) => b
    })
    expect(r).toMatchObject({ ok: false, stage: 'create', kind: 'exists', pushed: false })
  })

  // The union mirrors GhFailureKind; a bucket the classifier knows must not be flattened into
  // 'other', or a later reader cannot tell an unclassified failure from a discarded answer.
  it('passes a classifier bucket through rather than folding it into other', async () => {
    const r = await createPullRequest(req(), {
      runGit: async () => okGit,
      runGh: async () => ({ ok: false, stdout: '', stderr: 'no git remotes found' }),
      normalizeBase: async (_r, b) => b
    })
    expect(r).toMatchObject({ ok: false, stage: 'create', kind: 'no-remote' })
  })

  // 'truncated' comes only from spawnError — a maxBuffer overflow leaves stderr empty, which is
  // why classifyGhFailure takes two arguments. Dropping the second makes the member unreachable.
  it('passes spawnError through, so a truncated read is not misread as unclassified', async () => {
    const r = await createPullRequest(req(), {
      runGit: async () => okGit,
      runGh: async () => ({
        ok: false,
        stdout: '',
        stderr: '',
        spawnError: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      }),
      normalizeBase: async (_r, b) => b
    })
    expect(r).toMatchObject({ ok: false, stage: 'create', kind: 'truncated' })
  })

  // A gh that is not installed leaves stderr empty; the Host's create_pr needs the spawn error to
  // say so rather than "gh failed".
  it('keeps the spawnError of a failed create on the result', async () => {
    const r = await createPullRequest(req(), {
      runGit: async () => okGit,
      runGh: async () => ({ ok: false, stdout: '', stderr: '', spawnError: 'ENOENT' }),
      normalizeBase: async (_r, b) => b
    })
    expect(r).toMatchObject({ ok: false, stage: 'create', spawnError: 'ENOENT' })
  })

  it('passes the normalised base, and --draft only when asked', async () => {
    let args: string[] = []
    await createPullRequest(req({ base: 'origin/develop', draft: true }), {
      runGit: async () => okGit,
      runGh: async (a) => {
        args = a
        return okGh
      },
      normalizeBase: async () => 'develop'
    })
    expect(args).toContain('--base')
    expect(args[args.indexOf('--base') + 1]).toBe('develop')
    expect(args).toContain('--draft')
  })

  it('omits --draft when not asked', async () => {
    let args: string[] = []
    await createPullRequest(req(), {
      runGit: async () => okGit,
      runGh: async (a) => {
        args = a
        return okGh
      },
      normalizeBase: async (_r, b) => b
    })
    expect(args).not.toContain('--draft')
  })

  it('runs gh in the worktree, not the main repo', async () => {
    let cwd = ''
    await createPullRequest(req(), {
      runGit: async () => okGit,
      runGh: async (_a, c) => {
        cwd = c
        return okGh
      },
      normalizeBase: async (_r, b) => b
    })
    expect(cwd).toBe('C:/wt/opal')
  })
})

describe('readCommits', () => {
  // The subject/body separator is %x00 and the commit separator %x01, so a trailing separator
  // leaves an empty last chunk that must not become a commit with no subject.
  it('reads the commits the branch adds over its base, newest first', async () => {
    let args: string[] = []
    const got = await readCommits('C:/wt/opal', 'develop', async (a) => {
      args = a
      return {
        ok: true,
        stdout: 'feat: two\u0000the second body\u0001feat: one\u0000the first body\u0001',
        stderr: ''
      }
    })
    expect(got).toEqual([
      { subject: 'feat: two', body: 'the second body' },
      { subject: 'feat: one', body: 'the first body' }
    ])
    // base..HEAD, not HEAD..base — the other way round lists what the branch is missing.
    expect(args).toContain('develop..HEAD')
  })

  it('a subject with no body reads as an empty body, not as a missing commit', async () => {
    const got = await readCommits('C:/wt/opal', 'develop', async () => ({
      ok: true,
      stdout: 'chore: bump\u0000\u0001',
      stderr: ''
    }))
    expect(got).toEqual([{ subject: 'chore: bump', body: '' }])
  })
})

describe('pushBranch catches up with origin first (a teammate pushed to the plan branch)', () => {
  const forced = (calls: string[][]): boolean => calls.some((a) => a.some((x) => x === '--force' || x.startsWith('--force-with-lease') || x === '-f' || x.startsWith('+')))
  const fake = (merge: 'ok' | 'conflict') => {
    const calls: string[][] = []
    const runGit = async (a: string[]) => {
      calls.push(a)
      const key = a.join(' ')
      if (key === 'rev-parse --verify --quiet FETCH_HEAD^{commit}') return { ok: true, stdout: 'theirs1', stderr: '' }
      if (key === 'merge-base --is-ancestor theirs1 HEAD') return { ok: false, stdout: '', stderr: '' }
      if (key === 'merge --no-edit theirs1') return merge === 'ok' ? okGit : { ok: false, stdout: 'CONFLICT (content): a.ts', stderr: '' }
      return okGit
    }
    return { calls, runGit }
  }

  it('fetches origin\'s branch and merges it in before the push, never rebasing or forcing', async () => {
    const h = fake('ok')
    expect(await pushBranch('/wt', 'plan/x', { runGit: h.runGit })).toEqual({ ok: true })
    const order = h.calls.map((a) => a.join(' '))
    expect(order[0]).toBe('fetch origin plan/x')
    expect(order.indexOf('merge --no-edit theirs1')).toBeLessThan(order.indexOf('push -u origin plan/x'))
    expect(h.calls.some((a) => a[0] === 'rebase' || a[0] === 'reset')).toBe(false)
    expect(forced(h.calls)).toBe(false)
  })

  it('a conflict with origin aborts the merge, pushes nothing and names origin\'s commit', async () => {
    const h = fake('conflict')
    const r = await pushBranch('/wt', 'plan/x', { runGit: h.runGit })
    expect(r).toMatchObject({ ok: false, kind: 'origin-conflict', conflictWith: 'theirs1' })
    expect(h.calls.map((a) => a.join(' '))).toContain('merge --abort')
    expect(h.calls.some((a) => a[0] === 'push')).toBe(false)
  })

  it('origin already in HEAD: no merge, just the push', async () => {
    const calls: string[][] = []
    const r = await pushBranch('/wt', 'plan/x', { runGit: async (a) => { calls.push(a); return a[0] === 'rev-parse' ? { ok: true, stdout: 'theirs1', stderr: '' } : okGit } })
    expect(r).toEqual({ ok: true })
    expect(calls.some((a) => a[0] === 'merge')).toBe(false)
  })
})
