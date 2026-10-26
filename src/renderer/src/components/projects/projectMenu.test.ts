import { describe, expect, it } from 'vitest'
import { PROJECT_CHIP, projectActions, projectStateOf } from './projectMenu'

describe('project state', () => {
  it('a missing folder wins over any git answer', () => {
    expect(projectStateOf({ exists: false, repo: 'unknown' })).toBe('missing')
    expect(projectStateOf({ exists: false, repo: 'none' })).toBe('missing')
  })
  it('a folder that is no repository reads notGit; an unknown answer or an unasked one is no verdict', () => {
    expect(projectStateOf({ exists: true, repo: 'none' })).toBe('notGit')
    expect(projectStateOf({ exists: true, repo: 'repo' })).toBe('ok')
    expect(projectStateOf({ exists: true, repo: 'unknown' })).toBe('ok')
    expect(projectStateOf({ exists: undefined, repo: undefined })).toBe('ok')
  })
  it('each unhealthy state has a chip with a word and an icon', () => {
    for (const k of ['missing', 'notGit'] as const) expect(PROJECT_CHIP[k].key).toMatch(/^project\.state\./)
    expect(PROJECT_CHIP.missing.icon).not.toBe(PROJECT_CHIP.notGit.icon)
  })
})

describe('project row actions', () => {
  const ids = (a: ReturnType<typeof projectActions>): string[] => a.map((x) => x.id)
  it('offers Open, Open in new window, Settings, Reveal and Remove', () => {
    const a = projectActions({ state: 'ok', canWindow: true, tools: true })
    expect(ids(a)).toEqual(['open', 'window', 'settings', 'reveal', 'remove'])
    expect(a.some((x) => x.disabled)).toBe(false)
  })
  it('drops the window item where windows do not exist, and disables Settings and Remove without project tools', () => {
    const a = projectActions({ state: 'ok', canWindow: false, tools: false })
    expect(ids(a)).toEqual(['open', 'settings', 'reveal', 'remove'])
    expect(a.filter((x) => x.disabled).map((x) => x.id)).toEqual(['settings', 'remove'])
  })
  it('a missing folder cannot be revealed but can be removed', () => {
    const a = projectActions({ state: 'missing', canWindow: true, tools: true })
    expect(a.find((x) => x.id === 'reveal')?.disabled).toBe(true)
    expect(a.find((x) => x.id === 'remove')?.disabled).toBeUndefined()
  })
})
