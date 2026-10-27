import { describe, expect, it } from 'vitest'
import { codeReviewPrompt, codeReviewTitle } from './reviewPrompt'

const pr = { kind: 'pr', number: 12, title: 'Add retry', url: 'https://github.com/o/r/pull/12', base: 'main', head: 'feat/retry' } as const
const branch = { kind: 'branch', base: 'main', head: 'feat/x' } as const

describe('codeReviewPrompt', () => {
  it('names the gh and git commands of a PR without checking it out', () => {
    const p = codeReviewPrompt(pr)
    for (const s of ['gh pr view 12 --json title,body,files,baseRefName,headRefName', 'gh pr diff 12', 'git fetch origin pull/12/head', 'git show FETCH_HEAD:<path>', 'Never check out'])
      expect(p).toContain(s)
  })
  it('names the git commands of a branch diff', () => {
    const p = codeReviewPrompt(branch)
    for (const s of ['git diff main...feat/x', 'git log main..feat/x', 'git show feat/x:<path>']) expect(p).toContain(s)
  })
  it('asks for summary, walkthrough, severity-grouped file:line findings and a verdict', () => {
    const p = codeReviewPrompt(branch)
    for (const s of ['Summary', 'Walkthrough', 'critical, major, minor, nit', '`file:line`', 'suggested fix', 'Verdict']) expect(p).toContain(s)
  })
  it('is read-only and posts only on request', () => {
    expect(codeReviewPrompt(branch)).toContain('change no file and commit nothing')
    const p = codeReviewPrompt(pr)
    expect(p).toContain('Post nothing to GitHub unless the person asks')
    expect(p).toContain('gh pr review 12 --comment --body-file -')
    expect(codeReviewPrompt(branch)).not.toContain('gh pr review')
  })
})

describe('codeReviewTitle', () => {
  it('formats PR and branch titles', () => {
    expect(codeReviewTitle(pr)).toBe('Review: PR #12 Add retry')
    expect(codeReviewTitle({ kind: 'pr', number: 3 })).toBe('Review: PR #3')
    expect(codeReviewTitle(branch)).toBe('Review: feat/x')
    expect(codeReviewTitle({ ...branch, title: 'Retry plan' })).toBe('Review: Retry plan')
  })
})
