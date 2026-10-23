// W9-C: the plan section a plan page opens on. T7: the Tasks board and the Plans list are gone (the Plans tree's rows are
// plan/planTree.test.ts's).
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }))

const { storedSection } = await import('./PlansPage')

describe('storedSection (the plan section remembered per plan)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reads the last section used, maps old names, and is Overview without storage', () => {
    const store = new Map<string, string>([['cm.planSection.j1', 'journal'], ['cm.planSection.j2', 'board']])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    expect(storedSection('j1')).toBe('journal')
    expect(storedSection('j2')).toBe('waves')
    expect(storedSection('j3')).toBe('overview')
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(storedSection('j1')).toBe('overview')
  })
})
