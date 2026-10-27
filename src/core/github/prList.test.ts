import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { GhResult } from './gh'
import { listOpenPrs, parseOpenPrs, PR_OPEN_LIST_ARGS } from './prList'

const fixture = readFileSync(new URL('./fixtures/pr-open-list.json', import.meta.url), 'utf8')

describe('parseOpenPrs', () => {
  it('sorts by updatedAt, newest first', () => {
    expect(parseOpenPrs(fixture)?.map((p) => p.number)).toEqual([9, 6, 4])
  })
  it('keeps drafts and maps every field', () => {
    const [draft] = parseOpenPrs(fixture)!
    expect(draft).toEqual({
      number: 9, title: 'draft work', author: 'bob', head: 'feat/draft', base: 'main', isDraft: true,
      url: 'https://github.com/o/r/pull/9', updatedAt: '2026-10-20T08:30:00Z', additions: 120, deletions: 40, checks: 'failing'
    })
  })
  it('tolerates missing fields', () => {
    const sparse = parseOpenPrs(fixture)!.find((p) => p.number === 6)!
    expect(sparse).toMatchObject({ author: '', base: '', additions: 0, deletions: 0, isDraft: false, checks: null })
    expect(sparse).not.toHaveProperty('reviewDecision')
  })
  it('reports the review decision when there is one', () => {
    expect(parseOpenPrs(fixture)!.find((p) => p.number === 4)?.reviewDecision).toBe('APPROVED')
  })
  it('skips a malformed row, keeps the rest', () => {
    expect(parseOpenPrs(JSON.stringify([null, { number: 'x' }, { number: 1, title: 't', url: 'u' }]))).toHaveLength(1)
  })
  it('returns null for bad JSON or a non-array', () => {
    expect(parseOpenPrs('nope')).toBeNull()
    expect(parseOpenPrs('{}')).toBeNull()
  })
})

describe('listOpenPrs', () => {
  const res = (over: Partial<GhResult>): GhResult => ({ ok: true, stdout: '', stderr: '', ...over })
  it('runs the open-list argv in the cwd', async () => {
    let seen: [string[], string] | undefined
    const r = await listOpenPrs(async (a, c) => ((seen = [a, c]), res({ stdout: '[]' })), '/repo')
    expect(r).toEqual({ ok: true, prs: [] })
    expect(seen).toEqual([PR_OPEN_LIST_ARGS, '/repo'])
  })
  it('classifies gh failures', async () => {
    const kind = async (over: Partial<GhResult>): Promise<unknown> => (await listOpenPrs(async () => res({ ok: false, ...over }), '/r') as { kind?: string }).kind
    expect(await kind({ spawnError: 'ENOENT' })).toBe('not-installed')
    expect(await kind({ stderr: 'To get started with GitHub CLI, please run:  gh auth login' })).toBe('not-authenticated')
    expect(await kind({ stderr: 'no git remotes found' })).toBe('no-remote')
    expect(await kind({ stderr: 'boom' })).toBe('error')
  })
  it('fails on non-JSON output', async () => {
    expect(await listOpenPrs(async () => res({ stdout: 'x' }), '/r')).toMatchObject({ ok: false, kind: 'error' })
  })
})
