// W8-A: the stamp on a real temp repository, and the notes surviving amend, rebase (the repository config) and a
// cherry-pick (Astera's copy).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitSync, makeRepo } from '../worktrees/testRepo'
import { copyNotes, forgetNotesConfig, readNote } from './note'
import { busyWindowsOf, commitKind, stampCommits, WINDOW_SLACK_MS, type StampIdentity } from './stamp'

const WHO: StampIdentity = { job: 'job_1', task: 'tsk_1', session: 'sess_1', agent: 'claude', model: 'sonnet', account: 'acc_1', role: 'worker' }
const T0 = 1_700_000_000 // the agent's turn
const T_OWNER = T0 + 5_000 // the owner, while the session sat idle

/** Commits `file` with `text` at commit time `t` (seconds). */
async function commitAt(repo: string, file: string, text: string, t: number, msg = file): Promise<string> {
  await fs.writeFile(path.join(repo, file), text, 'utf8')
  gitSync(repo, ['add', file])
  process.env.GIT_COMMITTER_DATE = `${t} +0000`
  try {
    gitSync(repo, ['commit', '-m', msg, '--date', `${t} +0000`])
  } finally {
    delete process.env.GIT_COMMITTER_DATE
  }
  return gitSync(repo, ['rev-parse', 'HEAD'])
}

const line = (event: string, at: number, extra: object = {}): string => JSON.stringify({ hook_event_name: event, astera_at: at, ...extra })

afterEach(() => forgetNotesConfig())

describe('busyWindowsOf', () => {
  it('opens a window on a prompt, keeps it through a permission prompt, closes it on Stop; an open turn has no end', () => {
    const lines = [
      line('UserPromptSubmit', 1_000),
      line('Notification', 2_000, { notification_type: 'permission_prompt' }),
      line('PostToolUse', 3_000),
      line('Stop', 4_000),
      'not json',
      line('UserPromptSubmit', 10_000)
    ]
    expect(busyWindowsOf(lines)).toEqual([
      { start: 1_000 - WINDOW_SLACK_MS, end: 4_000 + WINDOW_SLACK_MS },
      { start: 10_000 - WINDOW_SLACK_MS, end: Number.POSITIVE_INFINITY }
    ])
  })

  it('a commit outside every window is human; inside by another author is unknown, never AI', () => {
    const w = [{ start: 0, end: 10 }]
    expect(commitKind(5, 'me@x', w, 'me@x')).toBe('ai')
    expect(commitKind(50, 'me@x', w, 'me@x')).toBe('human')
    expect(commitKind(5, 'other@x', w, 'me@x')).toBe('unknown')
  })
})

describe('stampCommits', () => {
  it('notes a two-commit worker branch, marks the owner commit human, and rewrites nothing', async () => {
    const repo = await makeRepo()
    const base = gitSync(repo, ['rev-parse', 'HEAD'])
    gitSync(repo, ['checkout', '-b', 'task'])
    const ai = await commitAt(repo, 'a.txt', 'one\ntwo\n', T0)
    const owner = await commitAt(repo, 'b.txt', 'mine\n', T_OWNER)
    const windows = busyWindowsOf([line('UserPromptSubmit', T0 * 1000 - 500), line('Stop', T0 * 1000 + 30_000)])

    const stamped = await stampCommits({ cwd: repo, base, identity: WHO, windows })

    expect(stamped).toEqual([
      { sha: ai, kind: 'ai' },
      { sha: owner, kind: 'human' }
    ])
    expect(await readNote(repo, ai)).toEqual({ v: 1, tool: 'astera', ...WHO })
    expect(await readNote(repo, owner)).toEqual({ v: 1, tool: 'astera', ...WHO, human: true })
    expect(gitSync(repo, ['rev-parse', 'HEAD'])).toBe(owner)
    expect(gitSync(repo, ['rev-list', `${base}..HEAD`]).split('\n')).toEqual([owner, ai])

    // A later attempt over the same base (a repair, a review) does not relabel them
    const again = await stampCommits({ cwd: repo, base, identity: { ...WHO, session: 'other', role: 'reviewer' }, windows: [{ start: 0, end: Infinity }] })
    expect(again).toEqual([])
    expect(await readNote(repo, ai)).toMatchObject({ session: 'sess_1', role: 'worker' })
  })

  it('skips a dependency merged in: only the first-parent commits of the attempt are its own', async () => {
    const repo = await makeRepo()
    const base = gitSync(repo, ['rev-parse', 'HEAD'])
    gitSync(repo, ['checkout', '-b', 'dep'])
    const dep = await commitAt(repo, 'dep.txt', 'dep\n', T0)
    gitSync(repo, ['checkout', '-b', 'task', base])
    gitSync(repo, ['merge', '--no-ff', '--no-edit', 'dep'])
    const own = await commitAt(repo, 'a.txt', 'a\n', T0 + 1)
    const stamped = await stampCommits({ cwd: repo, base, identity: WHO, windows: [{ start: 0, end: Infinity }] })
    expect(stamped.map((c) => c.sha)).toEqual([own])
    expect(await readNote(repo, dep)).toBeNull()
  })
})

describe('notes survive rewrites', () => {
  async function stamped(): Promise<{ repo: string; base: string; sha: string }> {
    const repo = await makeRepo()
    const base = gitSync(repo, ['rev-parse', 'HEAD'])
    gitSync(repo, ['checkout', '-b', 'task'])
    const sha = await commitAt(repo, 'a.txt', 'a\n', T0)
    await stampCommits({ cwd: repo, base, identity: WHO, windows: [{ start: 0, end: Infinity }] })
    return { repo, base, sha }
  }

  it('commit --amend carries the note (notes.rewrite.amend)', async () => {
    const { repo, sha } = await stamped()
    gitSync(repo, ['commit', '--amend', '-m', 'amended'])
    const amended = gitSync(repo, ['rev-parse', 'HEAD'])
    expect(amended).not.toBe(sha)
    expect(await readNote(repo, amended)).toMatchObject({ task: 'tsk_1' })
  })

  it('rebase carries the note (notes.rewrite.rebase)', async () => {
    const { repo, base, sha } = await stamped()
    gitSync(repo, ['checkout', '-b', 'moved', base])
    await commitAt(repo, 'other.txt', 'o\n', T0 + 10)
    gitSync(repo, ['checkout', 'task'])
    gitSync(repo, ['rebase', 'moved'])
    const rebased = gitSync(repo, ['rev-parse', 'HEAD'])
    expect(rebased).not.toBe(sha)
    expect(await readNote(repo, rebased)).toMatchObject({ task: 'tsk_1' })
  })

  it("a cherry-pick does not carry it; Astera's copy does", async () => {
    const { repo, base, sha } = await stamped()
    gitSync(repo, ['checkout', '-b', 'picked', base])
    gitSync(repo, ['cherry-pick', sha])
    const picked = gitSync(repo, ['rev-parse', 'HEAD'])
    expect(await readNote(repo, picked)).toBeNull()
    expect(await copyNotes(repo, [[sha, picked]])).toBe(1)
    expect(await readNote(repo, picked)).toMatchObject({ task: 'tsk_1' })
  })
})
