import { describe, it, expect } from 'vitest'
import type { BranchPushState, WorktreeListItem } from '../../../../core/types'
import { basesByRepo, cachedPushStates, mergePushState, queryPushStates, SCM_OVERVIEW_KEY, type PushStates } from './scmCache'
import { createReadCache } from '../../lib/readCache'

const wt = (repoPath: string, baseRef: string): WorktreeListItem => ({ repoPath, baseRef }) as WorktreeListItem
const st = (ahead: number): BranchPushState => ({ ahead }) as BranchPushState

describe('basesByRepo', () => {
  it('groups the distinct base refs per repo', () => {
    const m = basesByRepo([wt('/a', 'main'), wt('/a', 'main'), wt('/a', 'dev'), wt('/b', 'main')])
    expect(m.get('/a')).toEqual(['main', 'dev'])
    expect(m.get('/b')).toEqual(['main'])
  })
})

describe('mergePushState', () => {
  it('replaces one repo and keeps the others', () => {
    const prev: PushStates = { '/a': { main: { x: st(1) } }, '/b': { main: { y: st(2) } } }
    const next = mergePushState(prev, '/a', { main: { x: st(3) } })
    expect(next['/a'].main.x).toEqual(st(3))
    expect(next['/b']).toBe(prev['/b'])
  })
})

describe('queryPushStates', () => {
  it('asks all repos at once and publishes each answer as it arrives', async () => {
    const asked: string[] = []
    const resolvers = new Map<string, (v: PushStates[string]) => void>()
    const query = (repo: string): Promise<PushStates[string]> => {
      asked.push(repo)
      return new Promise((res) => resolvers.set(repo, res))
    }
    const seen: string[][] = []
    const done = queryPushStates([wt('/slow', 'main'), wt('/fast', 'main')], query, (all) => seen.push(Object.keys(all)))
    expect(asked).toEqual(['/slow', '/fast']) // both started before either answered
    resolvers.get('/fast')!({ main: { f: st(1) } })
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toEqual([['/fast']]) // the fast repo shows without the slow one
    resolvers.get('/slow')!({ main: { s: st(1) } })
    await done
    expect(seen.at(-1)!.sort()).toEqual(['/fast', '/slow'])
    expect(Object.keys(cachedPushStates()).sort()).toEqual(['/fast', '/slow'])
  })

  it('a failing repo keeps its last state and does not stop the others', async () => {
    const seen: PushStates[] = []
    await queryPushStates(
      [wt('/bad', 'main'), wt('/good', 'main')],
      (repo) => (repo === '/bad' ? Promise.reject(new Error('x')) : Promise.resolve({ main: {} })),
      (all) => seen.push(all)
    )
    expect(Object.keys(seen.at(-1)!)).toContain('/good')
  })
})

describe('overview cache', () => {
  it('survives a remount: the second read finds the first answer', async () => {
    const cache = createReadCache()
    let calls = 0
    await cache.read(SCM_OVERVIEW_KEY, async () => (++calls, [1]))
    expect(cache.get(SCM_OVERVIEW_KEY).data).toEqual([1])
    expect(cache.get(SCM_OVERVIEW_KEY).stale).toBe(false)
    await cache.read(SCM_OVERVIEW_KEY, async () => (++calls, [2]))
    expect(calls).toBe(1)
  })
})
