import { beforeEach, describe, expect, it } from 'vitest'
import type { HistoryEntry, ProjectSummary } from '../../../core/types'
import {
  cachedPage, cachedProjects, forgetHistoryCache, mergePage, mergeProjects, pageKey, projectsKey,
  rememberExpanded, rememberPage, rememberProjects, rememberedExpanded
} from './historyCache'

const e = (id: string): HistoryEntry => ({ id }) as HistoryEntry
const p = (projectPath: string): ProjectSummary => ({ projectPath }) as ProjectSummary

beforeEach(forgetHistoryCache)

describe('history read cache', () => {
  it('returns nothing before the first answer, then the cached window first and the fresh one after', () => {
    const key = projectsKey('', false)
    expect(cachedProjects(key)).toBeUndefined()
    rememberProjects(key, { projects: [p('/a')], total: 1 })
    expect(cachedProjects(key)?.projects.map((x) => x.projectPath)).toEqual(['/a'])
    rememberProjects(key, { projects: [p('/a'), p('/b')], total: 2 })
    expect(cachedProjects(key)?.total).toBe(2)
  })

  it('keeps accounts, scopes and projects apart', () => {
    expect(projectsKey('x', false)).not.toBe(projectsKey('y', false))
    expect(projectsKey('', false)).not.toBe(projectsKey('', true))
    rememberPage(pageKey('x', '/a'), { entries: [e('1')], total: 1 })
    expect(cachedPage(pageKey('y', '/a'))).toBeUndefined()
    expect(cachedPage(pageKey('x', '/a'))?.entries).toHaveLength(1)
  })

  it('remembers the expanded projects as a copy', () => {
    const s = new Set(['/a'])
    rememberExpanded(s)
    s.add('/b')
    expect([...rememberedExpanded()]).toEqual(['/a'])
  })
})

describe('paging merge', () => {
  it('appends only entries not already shown', () => {
    expect(mergePage([e('1'), e('2')], [e('2'), e('3')]).map((x) => x.id)).toEqual(['1', '2', '3'])
    expect(mergeProjects([p('/a')], [p('/a'), p('/b')]).map((x) => x.projectPath)).toEqual(['/a', '/b'])
  })
})
