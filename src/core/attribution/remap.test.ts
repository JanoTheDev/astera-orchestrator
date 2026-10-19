// W8-A: the squash remap on a real temp repository. GitHub's squash is simulated with `git merge --squash` and a new
// commit, its rebase with cherry-picks (which keep author, author date and subject, as GitHub's rebase merge does).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { gitSync, makeRepo } from '../worktrees/testRepo'
import { readNote, writeNote, type AttributionNote } from './note'
import { addedRanges, remapMerged, squashNote } from './remap'
import { statsOf } from './stats'

const AI: AttributionNote = { v: 1, tool: 'astera', job: 'job_1', task: 'tsk_1', session: 's', agent: 'claude', model: 'opus', account: 'a', role: 'worker' }

async function commit(repo: string, file: string, text: string): Promise<string> {
  await fs.writeFile(path.join(repo, file), text, 'utf8')
  gitSync(repo, ['add', file])
  gitSync(repo, ['commit', '-m', `add ${file}`])
  return gitSync(repo, ['rev-parse', 'HEAD'])
}

/** main, and a `feat` branch with an AI commit (a.txt, 3 lines) and a human one (b.txt, 2 lines). */
async function branch(): Promise<{ repo: string; ai: string; human: string }> {
  const repo = await makeRepo()
  gitSync(repo, ['checkout', '-b', 'feat'])
  const ai = await commit(repo, 'a.txt', '1\n2\n3\n')
  const human = await commit(repo, 'b.txt', 'x\ny\n')
  await writeNote(repo, ai, AI)
  await writeNote(repo, human, { ...AI, human: true })
  gitSync(repo, ['checkout', 'main'])
  return { repo, ai, human }
}

describe('addedRanges', () => {
  it('reads the added ranges per path from git diff -U0', () => {
    const diff = ['diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -0,0 +1,3 @@', '+x', '@@ -5 +8 @@', '-o', '+n', '@@ -9,2 +11,0 @@', '+++ /dev/null'].join('\n')
    expect(addedRanges(diff)).toEqual({ a: [[1, 3], [8, 8]] })
  })
})

describe('squashNote', () => {
  it('marks a path from more than one kind of source mixed', () => {
    const note = squashNote(
      [
        { note: AI, paths: ['shared.ts'] },
        { note: null, paths: ['shared.ts'] }
      ],
      { 'shared.ts': [[1, 4]] }
    )
    expect(note).toMatchObject({ task: 'tsk_1', lines: {}, mixed: { 'shared.ts': [[1, 4]] } })
  })

  it('names nobody when no old commit was the agent’s', () => {
    expect(squashNote([{ note: null, paths: ['a'] }], { a: [[1, 1]] })).toBeNull()
  })
})

describe('remapMerged', () => {
  it('a squash: the note lands on the new commit, lines merged by path, stats equal before and after, once', async () => {
    const { repo, ai, human } = await branch()
    gitSync(repo, ['merge', '--squash', 'feat'])
    gitSync(repo, ['commit', '-m', 'Feat (#1)'])
    const squash = gitSync(repo, ['rev-parse', 'HEAD'])

    const r = await remapMerged({ cwd: repo, mergeCommit: squash, originals: [ai, human] })

    expect(r).toEqual({ kind: 'squash', noted: [squash] })
    expect(await readNote(repo, squash)).toEqual({ ...AI, lines: { 'a.txt': [[1, 3]] } })
    expect(await statsOf(repo, [squash])).toEqual(await statsOf(repo, [ai, human]))
    expect(await remapMerged({ cwd: repo, mergeCommit: squash, originals: [ai, human] })).toEqual({ kind: 'squash', noted: [] })
  })

  it('a merge commit leaves the old commits as they are and writes nothing', async () => {
    const { repo, ai, human } = await branch()
    gitSync(repo, ['merge', '--no-ff', '--no-edit', 'feat'])
    const merge = gitSync(repo, ['rev-parse', 'HEAD'])
    expect(await remapMerged({ cwd: repo, mergeCommit: merge, originals: [ai, human] })).toEqual({ kind: 'merge', noted: [] })
    expect(await readNote(repo, merge)).toBeNull()
  })

  it('a rebase: each new commit gets its old one’s note', async () => {
    const { repo, ai, human } = await branch()
    await commit(repo, 'main.txt', 'moved on\n')
    gitSync(repo, ['cherry-pick', ai, human])
    const tip = gitSync(repo, ['rev-parse', 'HEAD'])
    const first = gitSync(repo, ['rev-parse', 'HEAD~1'])
    const r = await remapMerged({ cwd: repo, mergeCommit: tip, originals: [ai, human] })
    expect(r.kind).toBe('rebase')
    expect(await readNote(repo, first)).toEqual(AI)
    expect(await readNote(repo, tip)).toEqual({ ...AI, human: true })
  })
})
