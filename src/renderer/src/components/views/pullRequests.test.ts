import { describe, it, expect } from 'vitest'
import type { RepoPr } from '../../../../core/github/types'
import { canMerge, filterPrs, prRowView } from './pullRequests'

const pr = (over: Partial<RepoPr> = {}): RepoPr => ({
  number: 7,
  title: 'Add login page',
  author: 'ada',
  head: 'feat/login',
  base: 'main',
  isDraft: false,
  url: 'https://github.com/o/r/pull/7',
  updatedAt: '2026-10-27T10:00:00Z',
  additions: 10,
  deletions: 2,
  checks: 'passing',
  ...over
})

describe('filterPrs', () => {
  const list = [pr(), pr({ number: 8, title: 'Fix crash', author: 'bob', head: 'fix/crash' })]
  it('returns everything for a blank query', () => expect(filterPrs(list, '  ')).toHaveLength(2))
  it.each([
    ['login', [7]],
    ['BOB', [8]],
    ['fix/crash', [8]],
    ['#7', [7]],
    ['main', [7, 8]],
    ['ada crash', []]
  ])('matches %s on title, author, branch or number, all words required', (q, numbers) =>
    expect(filterPrs(list, q).map((p) => p.number)).toEqual(numbers))
})

describe('prRowView', () => {
  const now = Date.parse('2026-10-27T10:05:00Z')
  it('builds title, meta and age', () => {
    const v = prRowView(pr(), now)
    expect(v.title).toBe('#7 Add login page')
    expect(v.meta).toBe('ada · feat/login → main')
    expect(v.ageMs).toBe(5 * 60_000)
    expect(v.checks).toEqual({ key: 'github.badge.checks.passing', tone: 'ok' })
  })
  it('drops an unknown author and missing checks', () => {
    const v = prRowView(pr({ author: '', checks: null }), now)
    expect(v.meta).toBe('feat/login → main')
    expect(v.checks).toBeNull()
  })
  it('maps failing and pending checks to tones', () => {
    expect(prRowView(pr({ checks: 'failing' }), now).checks?.tone).toBe('danger')
    expect(prRowView(pr({ checks: 'pending' }), now).checks?.tone).toBe('warn')
  })
  it('reads a bad or future date as age 0', () => {
    expect(prRowView(pr({ updatedAt: 'nope' }), now).ageMs).toBe(0)
    expect(prRowView(pr({ updatedAt: '2027-01-01T00:00:00Z' }), now).ageMs).toBe(0)
  })
})

describe('canMerge', () => {
  it('is off for drafts and while a merge runs', () => {
    expect(canMerge({ isDraft: false }, false)).toBe(true)
    expect(canMerge({ isDraft: true }, false)).toBe(false)
    expect(canMerge({ isDraft: false }, true)).toBe(false)
  })
})
