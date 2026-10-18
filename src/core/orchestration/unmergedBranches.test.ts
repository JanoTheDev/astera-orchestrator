import { describe, it, expect } from 'vitest'
import path from 'node:path'
import type { GitResult } from '../worktrees/git'
import { emptyState } from './state'
import { buildPlannerBrief } from './handover'
import { noRemoteNote, recordedPlanBranches, unmergedPlanBranches } from './unmergedBranches'
import type { Job, JobRun, Project } from './types'

const folder = path.resolve(path.sep, 'work', 'shop')
const project = { id: 'p1', path: folder, name: 'shop', addedAt: '', defaultBranch: 'main' } as Project
const state = {
  ...emptyState(),
  projects: [project],
  jobs: [{ id: 'j1', cwd: folder, projectId: 'p1' } as Job, { id: 'j2', cwd: folder, projectId: 'p1' } as Job],
  runs: [
    { id: 'r1', jobId: 'j1', pr: { at: '', note: 'n', branch: 'plan-one' } } as JobRun,
    { id: 'r2', jobId: 'j2', pr: { at: '', url: 'https://x/pull/1' } } as JobRun
  ]
}
const gitSays = (merged: string[], missing: string[] = []) =>
  (async (args: string[]): Promise<GitResult> => {
    const ref = args.find((a) => a.startsWith('refs/heads/'))?.slice('refs/heads/'.length) ?? ''
    if (args[0] === 'rev-parse') return { ok: !missing.includes(ref), stdout: '', stderr: '' }
    return { ok: merged.includes(ref), stdout: '', stderr: '' }
  }) as never

describe('unmerged plan branches (W8-G #101)', () => {
  it('lists the branches no-remote plans left their work on, not a plan that opened a PR', () => {
    expect(recordedPlanBranches(state, project)).toEqual(['plan-one'])
  })

  it('drops a branch that was merged or deleted, and keeps one that is not merged', async () => {
    expect((await unmergedPlanBranches(state, project, gitSays([]))).branches).toEqual(['plan-one'])
    expect((await unmergedPlanBranches(state, project, gitSays(['plan-one']))).branches).toEqual([])
    expect((await unmergedPlanBranches(state, project, gitSays([], ['plan-one']))).branches).toEqual([])
  })

  it('tells the planner to plan on the default branch and to list the branches in existing.md', () => {
    const a = { jobId: 'j', objective: 'o', repoRoot: folder, accountId: 'a', concurrency: 1 }
    expect(buildPlannerBrief(a)).not.toContain('UNMERGED PLAN BRANCHES')
    const brief = buildPlannerBrief({ ...a, unmergedBranches: ['plan-one'], defaultBranch: 'main' })
    expect(brief).toContain('- plan-one')
    expect(brief).toContain('Plan the work on the default branch (main); this branch is not merged')
    expect(brief).toContain('`existing.md`')
  })

  it('says how to merge the branch in the no-remote notice', () => {
    expect(noRemoteNote('plan-one', folder)).toContain(`\`git merge plan-one\` in ${folder}`)
  })
})
