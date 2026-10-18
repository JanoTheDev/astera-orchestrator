import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  CHECKPOINT_SCRIPT,
  addedLinesOf,
  busyWindowsOf,
  lineHash,
  logFileOf,
  readCheckpoints,
  realRoot,
  repoRootOf,
  takeCheckpoints
} from './checkpoint'

let tmp: string
let profile: string
let repo: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-ckpt-'))
  profile = path.join(tmp, 'profile')
  repo = path.join(tmp, 'repo')
  await fs.mkdir(path.join(repo, '.git'), { recursive: true })
  await fs.mkdir(profile, { recursive: true })
  await fs.writeFile(path.join(profile, 'astera-attribution-checkpoint.cjs'), CHECKPOINT_SCRIPT)
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** Runs the hook script as Claude Code would: payload on stdin, the session in the env. */
function runHook(profileDir: string, payload: unknown, session = 'sess-a'): void {
  const r = spawnSync(process.execPath, [path.join(profileDir, 'astera-attribution-checkpoint.cjs')], {
    input: JSON.stringify(payload),
    env: { ...process.env, ASTERA_SESSION: session }
  })
  expect(r.status).toBe(0)
}

describe('addedLinesOf', () => {
  it('Write: every line; Edit: the new lines old_string did not have; MultiEdit: each edit', () => {
    expect(addedLinesOf('Write', { file_path: '/r/a', content: 'x\ny\n' })).toEqual([{ file: '/r/a', lines: ['x', 'y'] }])
    expect(addedLinesOf('Edit', { file_path: '/r/a', old_string: 'keep\nold', new_string: 'keep\nnew\nkeep' })).toEqual([
      { file: '/r/a', lines: ['new', 'keep'] }
    ])
    expect(
      addedLinesOf('MultiEdit', { file_path: '/r/a', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: '', new_string: 'c' }] })
    ).toEqual([{ file: '/r/a', lines: ['b', 'c'] }])
  })

  it('apply_patch: the + lines per file, a move renames', () => {
    const patch = '*** Begin Patch\n*** Add File: n.ts\n+one\n*** Update File: o.ts\n*** Move to: p.ts\n@@\n-old\n+two\n ctx\n*** End Patch'
    expect(addedLinesOf('apply_patch', { command: ['apply_patch', patch] })).toEqual([
      { file: 'n.ts', lines: ['one'] },
      { file: 'p.ts', lines: ['two'] }
    ])
  })

  it('other tools and bad input: nothing', () => {
    expect(addedLinesOf('Bash', { command: 'echo > a' })).toEqual([])
    expect(addedLinesOf('Write', null)).toEqual([])
  })
})

describe('repoRootOf', () => {
  it('walks up to .git; a missing file resolves through its folder; outside a repo is null', async () => {
    await fs.mkdir(path.join(repo, 'src'))
    const r = repoRootOf(path.join(repo, 'src', 'new.ts'), fsSync, path)
    expect(r).toEqual({ root: realRoot(repo), rel: 'src/new.ts' })
    expect(repoRootOf(path.join(tmp, 'nofile'), fsSync, path)).toBeNull()
  })
})

describe('CHECKPOINT_SCRIPT (the hook)', () => {
  it('an Edit appends line hashes and no content, in a log outside the repo', async () => {
    const file = path.join(repo, 'a.ts')
    runHook(profile, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      cwd: repo,
      tool_input: { file_path: file, old_string: 'const a = 1', new_string: 'const a = 1\nconst secretValue = 42\n\n' }
    })
    const log = logFileOf(profile, realRoot(repo))
    expect(log.startsWith(profile)).toBe(true)
    expect(path.relative(repo, log).startsWith('..')).toBe(true)
    const raw = await fs.readFile(log, 'utf8')
    expect(raw).not.toContain('secretValue')
    expect(raw).not.toContain('42')
    const entries = await readCheckpoints(profile, repo)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ session: 'sess-a', path: 'a.ts', addedLineHashes: [lineHash('const secretValue = 42')] })
  })

  it('writes nothing without a session or outside a repository', async () => {
    runHook(profile, { tool_name: 'Write', cwd: repo, tool_input: { file_path: path.join(repo, 'a'), content: 'x' } }, '')
    runHook(profile, { tool_name: 'Write', cwd: tmp, tool_input: { file_path: path.join(tmp, 'b'), content: 'x' } })
    expect(await readCheckpoints(profile, repo)).toEqual([])
  })
})

describe('takeCheckpoints', () => {
  it('keeps what use() keeps; an append landing meanwhile is not lost', async () => {
    const e = (p: string) => ({ at: 1, session: 's', path: p, addedLineHashes: ['h'] })
    const log = logFileOf(profile, realRoot(repo))
    await fs.mkdir(path.dirname(log), { recursive: true })
    await fs.writeFile(log, [e('a'), e('b')].map((x) => JSON.stringify(x)).join('\n') + '\n')
    const n = await takeCheckpoints(profile, repo, (entries) => {
      fsSync.appendFileSync(log, JSON.stringify(e('late')) + '\n') // a hook firing mid-stamp
      return { keep: entries.filter((x) => x.path === 'b'), result: entries.length }
    })
    expect(n).toBe(2)
    expect((await readCheckpoints(profile, repo)).map((x) => x.path).sort()).toEqual(['b', 'late'])
  })
})

describe('busyWindowsOf', () => {
  it('a turn runs from its first working event to the idle one; an open turn has no end', () => {
    const ev = (at: number, name: string) => JSON.stringify({ astera_at: at, hook_event_name: name })
    expect(busyWindowsOf('s', [ev(10, 'UserPromptSubmit'), ev(20, 'PostToolUse'), ev(30, 'Stop'), ev(40, 'UserPromptSubmit')])).toEqual([
      { session: 's', from: 10, to: 30 },
      { session: 's', from: 40 }
    ])
  })
})
