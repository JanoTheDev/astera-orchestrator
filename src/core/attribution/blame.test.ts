// W8-A: blame on a real temp repository with human, AI, line-level and bad-note commits.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitSync, makeRepo } from '../worktrees/testRepo'
import { writeNote, type AttributionNote } from './note'
import { blameFile, lineKind, parseBlamePorcelain } from './blame'

const AI: AttributionNote = { v: 1, tool: 'astera', job: 'j', task: 't', session: 's', agent: 'codex', model: 'gpt-5', account: 'a', role: 'worker' }

async function append(repo: string, text: string): Promise<string> {
  await fs.appendFile(path.join(repo, 'f.ts'), text, 'utf8')
  gitSync(repo, ['commit', '-am', 'more'])
  return gitSync(repo, ['rev-parse', 'HEAD'])
}

describe('blameFile', () => {
  it('tells human, AI, line-level and unknown lines apart', async () => {
    const repo = await makeRepo()
    await fs.writeFile(path.join(repo, 'f.ts'), 'h1\nh2\n', 'utf8')
    gitSync(repo, ['add', 'f.ts'])
    gitSync(repo, ['commit', '-m', 'human, no note'])
    const ai = await append(repo, 'a3\na4\n')
    await writeNote(repo, ai, AI)
    const mixed = await append(repo, 'a5\nh6\n')
    await writeNote(repo, mixed, { ...AI, lines: { 'f.ts': [[5, 5]] } })
    const bad = await append(repo, 'u7\n')
    gitSync(repo, ['notes', '--ref', 'refs/notes/astera', 'add', '-m', '{broken', bad])

    const lines = await blameFile(repo, 'f.ts')

    expect(lines?.map((l) => [l.line, l.content, l.kind])).toEqual([
      [1, 'h1', 'human'],
      [2, 'h2', 'human'],
      [3, 'a3', 'ai'],
      [4, 'a4', 'ai'],
      [5, 'a5', 'ai'],
      [6, 'h6', 'human'],
      [7, 'u7', 'unknown']
    ])
    expect(lines?.[2].note).toMatchObject({ agent: 'codex', model: 'gpt-5' })
    expect((await blameFile(repo, 'f.ts', { line: 3 }))?.map((l) => l.sha)).toEqual([ai])
    expect(await blameFile(repo, 'missing.ts')).toBeNull()
  })
})

describe('lineKind', () => {
  it('reads mixed ranges, and a human note as human', () => {
    expect(lineKind({ ...AI, lines: {}, mixed: { p: [[2, 3]] } }, 'p', 3)).toBe('mixed')
    expect(lineKind({ ...AI, human: true }, 'p', 1)).toBe('human')
    expect(lineKind('unknown', 'p', 1)).toBe('unknown')
  })

  it('parses porcelain groups that repeat a commit without its header', () => {
    const sha = 'a'.repeat(40)
    const out = parseBlamePorcelain([`${sha} 1 1 2`, 'author x', 'filename p.ts', '\tone', `${sha} 2 2`, 'filename p.ts', '\ttwo'].join('\n'))
    expect(out.map((l) => [l.finalLine, l.path, l.content])).toEqual([
      [1, 'p.ts', 'one'],
      [2, 'p.ts', 'two']
    ])
  })
})
