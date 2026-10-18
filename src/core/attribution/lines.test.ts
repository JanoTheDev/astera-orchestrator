import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { CHECKPOINT_SCRIPT, lineHash, readCheckpoints } from './checkpoint'
import { addedLinesOfDiff, attributeLines, linesForCommit, rangesOf } from './lines'

let tmp: string
let profile: string
let repo: string
const g = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
function hook(payload: unknown, session = 'sess-a'): void {
  const r = spawnSync(process.execPath, [path.join(profile, 'astera-attribution-checkpoint.cjs')], {
    input: JSON.stringify(payload),
    env: { ...process.env, ASTERA_SESSION: session }
  })
  expect(r.status).toBe(0)
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-lines-'))
  profile = path.join(tmp, 'profile')
  repo = path.join(tmp, 'repo')
  await fs.mkdir(profile, { recursive: true })
  await fs.mkdir(repo)
  await fs.writeFile(path.join(profile, 'astera-attribution-checkpoint.cjs'), CHECKPOINT_SCRIPT)
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@t')
  g('config', 'user.name', 't')
  await fs.writeFile(path.join(repo, 'README'), 'base\n')
  g('add', '-A')
  g('commit', '-qm', 'init')
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('linesForCommit', () => {
  it('mixed commit: the agent writes lines 1-5, the owner adds 6-8 before the commit, `lines` holds 1-5 only', async () => {
    const file = path.join(repo, 'f.txt')
    const agent = 'a1\na2\na3\na4\na5\n'
    await fs.writeFile(file, agent)
    hook({ hook_event_name: 'PostToolUse', tool_name: 'Write', cwd: repo, tool_input: { file_path: file, content: agent } })
    await fs.appendFile(file, 'h6\nh7\nh8\n')
    g('add', '-A')
    g('commit', '-qm', 'mixed')
    const r = await linesForCommit({ repo, sha: g('rev-parse', 'HEAD'), profileDir: profile })
    expect(r).toEqual({ session: 'sess-a', lines: { 'f.txt': [[1, 5]] }, aiLines: 5, humanLines: 3 })
    expect(await readCheckpoints(profile, repo)).toEqual([]) // cleared for the committed range
  })

  it('pure AI commit leaves `lines` out; a pure human one is `human`', async () => {
    const file = path.join(repo, 'g.txt')
    await fs.writeFile(file, 'x\ny\n')
    hook({ tool_name: 'Write', cwd: repo, tool_input: { file_path: file, content: 'x\ny\n' } })
    g('add', '-A')
    g('commit', '-qm', 'ai')
    expect(await linesForCommit({ repo, sha: 'HEAD', profileDir: profile })).toEqual({ session: 'sess-a', aiLines: 2, humanLines: 0 })
    await fs.writeFile(path.join(repo, 'h.txt'), 'by hand\n')
    g('add', '-A')
    g('commit', '-qm', 'human')
    expect(await linesForCommit({ repo, sha: 'HEAD', profileDir: profile })).toEqual({ human: true, aiLines: 0, humanLines: 1 })
  })

  it('a file written by Bash inside the session busy window is the session\'s, whole-file', async () => {
    await fs.writeFile(path.join(repo, 'gen.txt'), 'one\ntwo\n') // `echo … > gen.txt` from a Bash call: no checkpoint
    const m = (await fs.stat(path.join(repo, 'gen.txt'))).mtimeMs
    g('add', '-A')
    g('commit', '-qm', 'bash')
    const r = await linesForCommit({ repo, sha: 'HEAD', profileDir: profile, busy: [{ session: 'sess-b', from: m - 1000, to: m + 1000 }] })
    expect(r).toEqual({ session: 'sess-b', aiLines: 2, humanLines: 0 })
    const outside = await linesForCommit({ repo, sha: 'HEAD', profileDir: profile, busy: [{ session: 'sess-b', from: m + 1, to: m + 10 }] })
    expect(outside.human).toBe(true)
  })
})

describe('attributeLines', () => {
  const add = (p: string, line: number, text: string) => ({ path: p, line, text })
  it('a hash is taken once: the owner repeating a line the agent wrote gets the repeat', () => {
    const { result } = attributeLines(
      [add('a', 1, '}'), add('a', 2, '}')],
      [{ at: 0, session: 's', path: 'a', addedLineHashes: [lineHash('}')] }],
      [],
      () => null
    )
    expect(result).toEqual({ session: 's', lines: { a: [[1, 1]] }, aiLines: 1, humanLines: 1 })
  })
  it('a blank line goes with the line above; checkpoints of untouched paths are kept', () => {
    const other = { at: 0, session: 's', path: 'b', addedLineHashes: ['x'] }
    const { result, keep } = attributeLines(
      [add('a', 1, 'x'), add('a', 2, ''), add('a', 5, 'y')],
      [{ at: 0, session: 's', path: 'a', addedLineHashes: [lineHash('x')] }, other],
      [],
      () => null
    )
    expect(result.lines).toEqual({ a: [[1, 2]] })
    expect(keep).toEqual([other])
  })
})

describe('helpers', () => {
  it('addedLinesOfDiff numbers added lines in the new file', () => {
    const diff = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,0 +2,2 @@\n+p\n+q\n@@ -9 +11 @@\n-r\n+s\n'
    expect(addedLinesOfDiff(diff)).toEqual([
      { path: 'x', line: 2, text: 'p' },
      { path: 'x', line: 3, text: 'q' },
      { path: 'x', line: 11, text: 's' }
    ])
  })
  it('rangesOf folds runs', () => {
    expect(rangesOf([5, 1, 2, 3, 9, 3])).toEqual([[1, 3], [5, 5], [9, 9]])
  })
})
