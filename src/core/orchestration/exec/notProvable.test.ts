import { describe, expect, it } from 'vitest'
import type { ReviewIssue } from '../types'
import {
  acceptedNotProvable,
  environmentOnlyIssues,
  isNotProvableAnswer,
  missingToolOf,
  NOT_PROVABLE_ANSWER_HEAD,
  notProvableReviewAnswer
} from './notProvable'

describe('missingToolOf', () => {
  it.each([
    ['bash: flock: command not found', 'bash: flock: command not found'],
    ['zsh: command not found: apt-get', 'zsh: command not found: apt-get'],
    ['sh: 1: flock: not found', 'sh: 1: flock: not found'],
    ['/bin/sh: 2: ./build.sh: not found', '/bin/sh: 2: ./build.sh: not found'],
    ['flock: not found', 'flock: not found'],
    ["'flock' is not recognized as an internal or external command,", "'flock' is not recognized as an internal or external command,"],
    [
      "flock : The term 'flock' is not recognized as the name of a cmdlet, function, script file, or operable program.",
      "flock : The term 'flock' is not recognized as the name of a cmdlet, function, script file, or operable program."
    ],
    ['Error: spawn bash ENOENT', 'Error: spawn bash ENOENT'],
    ['The e2e suite is Linux-only.', 'The e2e suite is Linux-only.'],
    ['scripts/sign.sh requires macOS (codesign).', 'scripts/sign.sh requires macOS (codesign).'],
    ['The installer test only runs on Linux.', 'The installer test only runs on Linux.'],
    ['The FUSE mount is not supported on Windows.', 'The FUSE mount is not supported on Windows.']
  ])('reads %j as a missing tool or OS', (line, note) => {
    expect(missingToolOf(`Implemented the lock.\n${line}\nEverything else passes.`)).toBe(note)
  })

  it('reads Windows line endings', () => {
    expect(missingToolOf("Built it.\r\n'make' is not recognized as an internal or external command,\r\noperable program or batch file.")).toBe(
      "'make' is not recognized as an internal or external command,"
    )
  })

  it.each([
    'Tests failed: 3 of 40 in src/lock.test.ts',
    "Error: Cannot find module './lock'",
    'error: not found',
    'ENOENT: no such file or directory, open C:\\work\\config.json',
    'File not found: D:\\p\\src\\index.ts',
    'test: not found',
    'The build is broken on Linux and Windows alike.',
    ''
  ])('does not read %j as a missing tool', (text) => {
    expect(missingToolOf(text)).toBeNull()
  })

  it('keeps a long line short', () => {
    const note = missingToolOf(`bash: flock: command not found ${'x'.repeat(400)}`)
    expect(note?.length).toBe(300)
    expect(note?.endsWith('...')).toBe(true)
  })
})

describe('acceptedNotProvable', () => {
  it('writes the decision choice', () => {
    expect(acceptedNotProvable('T3 · Lock the store', 'flock: not found')).toBe('accepted T3 · Lock the store: not provable here: flock: not found')
  })
})

describe('environmentOnlyIssues', () => {
  const issue = (over: Partial<ReviewIssue>): ReviewIssue => ({ id: 'i', severity: 'high', blocking: true, title: 't', description: '', ...over })

  it('takes blocking issues that all need an environment', () => {
    const issues = [issue({ title: 'dev server not run', needs: 'environment' }), issue({ title: 'no device', needs: 'environment' }), issue({ blocking: false, title: 'nit' })]
    expect(environmentOnlyIssues({ reviewIssues: issues })?.map((i) => i.title)).toEqual(['dev server not run', 'no device'])
  })

  it.each([
    ['a code blocker beside it', [issue({ needs: 'environment' }), issue({ title: 'bug' })]],
    ['a scope blocker beside it', [issue({ needs: 'environment' }), issue({ needs: 'scope' })]],
    ['only a non-blocking environment note', [issue({ blocking: false, needs: 'environment' })]],
    ['no issues', []]
  ])('is null with %s', (_name, issues) => {
    expect(environmentOnlyIssues({ reviewIssues: issues })).toBeNull()
  })

  it('is null for no Task', () => {
    expect(environmentOnlyIssues(undefined)).toBeNull()
  })
})

describe('notProvableReviewAnswer', () => {
  it('names the issues, drops that proof and tells the worker to report --not-provable', () => {
    const a = notProvableReviewAnswer([{ title: 'next dev not run' }, { title: 'no iOS simulator' }])
    expect(a.startsWith(`${NOT_PROVABLE_ANSWER_HEAD} next dev not run; no iOS simulator.`)).toBe(true)
    expect(a).toContain('its absence is not a finding')
    expect(a).toContain('--not-provable')
    expect(isNotProvableAnswer(a)).toBe(true)
    expect(isNotProvableAnswer('retry-once')).toBe(false)
    expect(isNotProvableAnswer(undefined)).toBe(false)
  })
})
