// W8-A: the note format on real temp repositories: round trip, a bad or foreign note reads as unknown, the config.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { gitSync, makeRepo } from '../worktrees/testRepo'
import { ensureNotesConfig, forgetNotesConfig, NOTES_FETCH_REFSPEC, parseNote, readNote, trailersOf, writeNote, type AttributionNote } from './note'

const NOTE: AttributionNote = {
  v: 1,
  tool: 'astera',
  job: 'job_1',
  task: 'tsk_1',
  session: 'sess_1',
  agent: 'claude',
  model: 'opus',
  account: 'acc_1',
  role: 'worker'
}

afterEach(() => forgetNotesConfig())

describe('parseNote', () => {
  it('reads a contract note and refuses anything else', () => {
    expect(parseNote(JSON.stringify(NOTE))).toEqual(NOTE)
    expect(parseNote(JSON.stringify({ ...NOTE, lines: { 'a.ts': [[1, 3]] } }))?.lines).toEqual({ 'a.ts': [[1, 3]] })
    for (const bad of [
      'not json',
      '{"v":1}',
      JSON.stringify({ ...NOTE, tool: 'git-ai' }),
      JSON.stringify({ ...NOTE, v: 2 }),
      JSON.stringify({ ...NOTE, agent: 'gpt' }),
      JSON.stringify({ ...NOTE, human: false }),
      JSON.stringify({ ...NOTE, lines: { 'a.ts': [[3, 1]] } }),
      JSON.stringify({ ...NOTE, lines: { 'a.ts': [1, 3] } }),
      'null'
    ])
      expect(parseNote(bad)).toBeNull()
  })
})

describe('readNote / writeNote', () => {
  it('round-trips a note, reads no note as null and a foreign or bad note as unknown, never throwing', async () => {
    const repo = await makeRepo()
    const sha = gitSync(repo, ['rev-parse', 'HEAD'])
    expect(await readNote(repo, sha)).toBeNull()
    expect(await writeNote(repo, sha, NOTE)).toBe(true)
    expect(await readNote(repo, sha)).toEqual(NOTE)
    gitSync(repo, ['notes', '--ref', 'refs/notes/astera', 'add', '-f', '-m', 'written by another tool', sha])
    expect(await readNote(repo, sha)).toBe('unknown')
    gitSync(repo, ['notes', '--ref', 'refs/notes/astera', 'add', '-f', '-m', '{"v":1,"tool":"astera"}', sha])
    expect(await readNote(repo, sha)).toBe('unknown')
    expect(await readNote(path.join(repo, 'no-such-dir'), sha)).toBe('unknown')
  })

  it('trailers name the Job, the Task and agent/model', () => {
    expect(trailersOf(NOTE)).toEqual(['Astera-Job: job_1', 'Astera-Task: tsk_1', 'AI-Agent: claude/opus'])
  })
})

describe('ensureNotesConfig', () => {
  it('sets the three notes keys and the fetch refspec once, keeping a person’s own rewriteRef', async () => {
    const repo = await makeRepo()
    const bare = path.join(await fs.mkdtemp(path.join(path.dirname(repo), 'origin-')), 'o.git')
    gitSync(path.dirname(bare), ['init', '--bare', bare])
    gitSync(repo, ['remote', 'add', 'origin', bare])
    gitSync(repo, ['config', '--add', 'notes.rewriteRef', 'refs/notes/commits'])
    expect(await ensureNotesConfig(repo)).toBe(true)
    forgetNotesConfig()
    expect(await ensureNotesConfig(repo)).toBe(true)
    expect(gitSync(repo, ['config', '--get-all', 'notes.rewriteRef']).split('\n')).toEqual(['refs/notes/commits', 'refs/notes/astera'])
    expect(gitSync(repo, ['config', 'notes.rewrite.amend'])).toBe('true')
    expect(gitSync(repo, ['config', 'notes.rewrite.rebase'])).toBe('true')
    expect(gitSync(repo, ['config', '--get-all', 'remote.origin.fetch']).split('\n').filter((l) => l === NOTES_FETCH_REFSPEC)).toHaveLength(1)
  })
})
