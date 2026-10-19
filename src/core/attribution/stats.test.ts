// W8-A: stats use git-ai's field names; the PR's "AI attribution" block ends with the Wave 8 trailers.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitSync, makeRepo } from '../worktrees/testRepo'
import { writeNote, type AttributionNote } from './note'
import { attributionBlock, commitStats, rangeShas, statsOf } from './stats'

const AI: AttributionNote = { v: 1, tool: 'astera', job: 'job_1', task: 'tsk_1', session: 's', agent: 'claude', model: 'opus', account: 'a', role: 'worker' }

describe('stats', () => {
  it('has the git-ai field names', () => {
    expect(Object.keys(commitStats([], null))).toEqual(
      expect.arrayContaining(['human_additions', 'ai_additions', 'ai_accepted', 'git_diff_added_lines', 'git_diff_deleted_lines', 'tool_model_breakdown'])
    )
  })

  it('splits a line-level note and counts a bad note as unknown', () => {
    const files = [{ path: 'a.ts', added: 5, deleted: 1 }]
    expect(commitStats(files, { ...AI, lines: { 'a.ts': [[1, 2]] }, mixed: { 'a.ts': [[3, 3]] } })).toMatchObject({
      ai_additions: 2,
      mixed_additions: 1,
      human_additions: 2,
      git_diff_added_lines: 5,
      git_diff_deleted_lines: 1,
      tool_model_breakdown: { 'claude::opus': { ai_additions: 2, ai_accepted: 2 } }
    })
    expect(commitStats(files, 'unknown')).toMatchObject({ unknown_additions: 5, ai_additions: 0, human_additions: 0 })
  })

  it('counts a range of commits, and builds the PR block with the trailers last', async () => {
    const repo = await makeRepo()
    const base = gitSync(repo, ['rev-parse', 'HEAD'])
    await fs.writeFile(path.join(repo, 'a.txt'), '1\n2\n3\n', 'utf8')
    gitSync(repo, ['add', 'a.txt'])
    gitSync(repo, ['commit', '-m', 'ai'])
    const ai = gitSync(repo, ['rev-parse', 'HEAD'])
    await writeNote(repo, ai, AI)
    await fs.writeFile(path.join(repo, 'b.txt'), 'x\n', 'utf8')
    gitSync(repo, ['add', 'b.txt'])
    gitSync(repo, ['commit', '-m', 'human'])
    const human = gitSync(repo, ['rev-parse', 'HEAD'])

    const shas = await rangeShas(repo, `${base}..HEAD`)
    expect(shas).toEqual([human, ai])
    expect(await rangeShas(repo, undefined)).toEqual([human])
    const s = await statsOf(repo, shas!)
    expect(s).toMatchObject({ ai_additions: 3, ai_accepted: 3, human_additions: 1, git_diff_added_lines: 4, tool_model_breakdown: { 'claude::opus': { ai_additions: 3 } } })

    const block = await attributionBlock(repo, 'job_1', [
      { id: 'tsk_1', title: 'Make a', commits: [ai] },
      { id: 'tsk_2', title: 'Make b', commits: [human] },
      { id: 'tsk_3', title: 'Nothing', commits: [] }
    ])
    expect(block).toContain('## AI attribution')
    expect(block).toContain('| Make a | claude/opus | 1 | 3 | 0 |')
    expect(block).toContain('| Make b | human | 1 | 0 | 1 |')
    expect(block.split('\n\n').pop()?.split('\n')).toEqual(['Astera-Job: job_1', 'Astera-Task: tsk_1', 'Astera-Task: tsk_2', 'AI-Agent: claude/opus'])
    expect(await attributionBlock(repo, 'job_1', [])).toBe('')
  })
})
