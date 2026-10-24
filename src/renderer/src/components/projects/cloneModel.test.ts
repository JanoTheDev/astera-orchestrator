import { describe, expect, it } from 'vitest'
import { canClone, cloneProblem, defaultClonePath, repoNameOf } from './cloneModel'

describe('cloneModel', () => {
  it('names the repository from https, ssh and scp-style URLs', () => {
    expect(repoNameOf('https://github.com/o/app.git')).toBe('app')
    expect(repoNameOf('git@github.com:o/app')).toBe('app')
    expect(repoNameOf('https://github.com/o/app/')).toBe('app')
  })

  it('defaults the destination under ~/astera-projects', () => {
    expect(defaultClonePath('https://github.com/o/app.git', '/home/a/')).toBe('/home/a/astera-projects/app')
    expect(defaultClonePath('https://host', '/h')).toBe('/h/astera-projects/host')
  })

  it('refuses a URL that is not a git URL, and a relative destination', () => {
    expect(cloneProblem('--upload-pack=x', '')).toBe('onboarding.clone.invalidUrl')
    expect(cloneProblem('just words', '')).toBe('onboarding.clone.invalidUrl')
    expect(cloneProblem('https://github.com/o/app', 'rel/dir')).toBe('onboarding.clone.invalidDest')
    expect(cloneProblem('https://github.com/o/app', '/abs/dir')).toBeNull()
    expect(cloneProblem('git@github.com:o/app', '')).toBeNull()
  })

  it('enables Clone only for a valid URL while idle', () => {
    expect(canClone('', '', false)).toBe(false)
    expect(canClone('nope', '', false)).toBe(false)
    expect(canClone('https://github.com/o/app', '', true)).toBe(false)
    expect(canClone('https://github.com/o/app', '', false)).toBe(true)
  })
})
