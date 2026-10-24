import { describe, it, expect } from 'vitest'
import { fileStateOf, nextGitStatus, rememberFileState } from './useGitStatus'

describe('nextGitStatus', () => {
  const prev = { '/r/a.ts': 'modified' as const }

  // git.status answers null when git failed or timed out. The badges are kept — clearing them would
  // flicker and claim a clean tree — but they are marked stale so the explorer can say so.
  it('an unknown answer (null) keeps the last badges and marks them stale', () => {
    expect(nextGitStatus(prev, null)).toEqual({ fileState: prev, stale: true })
  })

  it('a real answer replaces the badges and clears stale', () => {
    const map = { '/r/b.ts': 'new' as const }
    expect(nextGitStatus(prev, map)).toEqual({ fileState: map, stale: false })
  })

  // Second pass R2-8: every watcher batch asked git again and the answer always replaced the map, so the explorer
  // drew again with nothing changed while an agent wrote files. The same badges keep the same object.
  it('an answer with the same badges keeps the map it had', () => {
    expect(nextGitStatus(prev, { '/r/a.ts': 'modified' }).fileState).toBe(prev)
  })

  it('an empty answer is a clean tree, not unknown', () => {
    expect(nextGitStatus(prev, {})).toEqual({ fileState: {}, stale: false })
  })
})

describe('per-root file state', () => {
  it('switching root A -> B -> A shows the cached state of A at once', () => {
    const a = { '/a/x.ts': 'modified' as const }
    rememberFileState('/a', a)
    expect(fileStateOf('/b')).toEqual({}) // never seen: empty, not A's
    rememberFileState('/b', { '/b/y.ts': 'new' as const })
    expect(fileStateOf('/b')).toEqual({ '/b/y.ts': 'new' })
    expect(fileStateOf('/a')).toBe(a)
  })

  it('no root has no badges', () => {
    expect(fileStateOf(null)).toEqual({})
  })

  it('keeps the newest 16 roots', () => {
    for (let i = 0; i < 17; i++) rememberFileState(`/cap${i}`, { [`/cap${i}/f`]: 'new' })
    expect(fileStateOf('/cap0')).toEqual({})
    expect(fileStateOf('/cap16')).toEqual({ '/cap16/f': 'new' })
  })
})
