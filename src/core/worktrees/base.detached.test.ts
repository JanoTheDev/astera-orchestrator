import { describe, expect, it } from 'vitest'
import { isDetachedHeadError, workerBaseFailure } from './base'

describe('isDetachedHeadError', () => {
  it('matches the detached-HEAD failure, thrown or inside a refused body', () => {
    const msg = workerBaseFailure({ repoPath: 'C:\repo', repoReachable: true, onBranch: false })!
    expect(isDetachedHeadError(`Error: ${msg}`)).toBe(true)
    expect(isDetachedHeadError(JSON.stringify({ error: msg }))).toBe(true)
  })
  it('does not match a missing repository', () => {
    const msg = workerBaseFailure({ repoPath: 'C:\repo', repoReachable: false, onBranch: false })!
    expect(isDetachedHeadError(msg)).toBe(false)
  })
})
