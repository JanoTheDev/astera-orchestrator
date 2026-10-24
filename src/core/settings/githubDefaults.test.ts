import { describe, it, expect } from 'vitest'
import { GITHUB_DEFAULTS, githubDefaultsOf, githubDefaultsRefusal } from './githubDefaults'

describe('githubDefaultsOf', () => {
  it('defaults to no repository, private', () => {
    expect(GITHUB_DEFAULTS).toEqual({ createGithubRepo: false, visibility: 'private' })
    for (const v of [undefined, null, 'yes', 7, [], {}]) expect(githubDefaultsOf(v)).toEqual(GITHUB_DEFAULTS)
  })
  it('keeps a well-formed value and narrows the rest field by field', () => {
    expect(githubDefaultsOf({ createGithubRepo: true, visibility: 'public' })).toEqual({ createGithubRepo: true, visibility: 'public' })
    expect(githubDefaultsOf({ createGithubRepo: 'true', visibility: 'internal' })).toEqual(GITHUB_DEFAULTS)
  })
})

describe('githubDefaultsRefusal', () => {
  it('accepts both fields well-formed', () => {
    expect(githubDefaultsRefusal({ createGithubRepo: false, visibility: 'public' })).toBeNull()
  })
  it('refuses anything else with a reason', () => {
    for (const v of [null, 'x', {}, { createGithubRepo: 1, visibility: 'private' }, { createGithubRepo: true }, { createGithubRepo: true, visibility: 'internal' }])
      expect(githubDefaultsRefusal(v)).toEqual(expect.any(String))
  })
})
