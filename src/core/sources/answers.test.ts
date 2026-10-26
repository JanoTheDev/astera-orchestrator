// What a job source answers, as the Host takes it (Phase 4 J7): the shapes it accepts, the limits it cuts to, and the
// sentence it refuses with. The plugin is trusted code; the ticket inside its answer was written by someone else.
import { describe, it, expect } from 'vitest'
import { itemDetail, itemsPage, jobContext, SOURCE_EVIDENCE_TOTAL_MAX } from './answers'
import type { JobSourcePage } from '../../../packages/plugin-sdk/src/index'

// Plugin Phase 4 J1: what the plugin SDK types a provider to answer is what the Host checks, field for field
describe('the plugin SDK’s job-source types', () => {
  it('are the shapes the Host takes', () => {
    const page: JobSourcePage = { items: [{ id: 'A', title: 't', status: 's', url: 'https://linear.app/a/A', summary: 'x' }], nextCursor: 'c' }
    expect(itemsPage(page)).toEqual({ ok: true, cut: false, value: page })
  })
})

describe('itemsPage (J7)', () => {
  it('keeps an item’s fields, drops a url that is not http or https, and passes the cursor', () => {
    expect(
      itemsPage({ items: [{ id: 'ENG-1', title: 'Fix it', status: 'Todo', url: 'javascript:alert(1)', summary: 's', extra: 1 }], nextCursor: 'c2' })
    ).toEqual({ ok: true, cut: false, value: { items: [{ id: 'ENG-1', title: 'Fix it', status: 'Todo', summary: 's' }], nextCursor: 'c2' } })
    expect(itemsPage({ items: [{ id: 'A-1', title: 't', url: 'https://linear.app/a/A-1' }] })).toEqual({
      ok: true,
      cut: false,
      value: { items: [{ id: 'A-1', title: 't', url: 'https://linear.app/a/A-1' }] }
    })
  })

  // Review Focus 1
  it('cuts a page to 100 items and long texts to their limits, and says it cut', () => {
    const huge = 't'.repeat(1_000_000)
    const r = itemsPage({ items: Array.from({ length: 5_000 }, (_, i) => ({ id: `I-${i}`, title: huge, summary: huge })) })
    if (!r.ok) throw new Error(r.problem)
    expect(r.cut).toBe(true)
    expect(r.value.items).toHaveLength(100)
    expect(r.value.items[0].title).toBe(`${'t'.repeat(299)}…`)
    expect(Array.from(r.value.items[0].summary!)).toHaveLength(1_000)
  })

  it('counts characters, so 250 emoji are a title within 300', () => {
    const r = itemsPage({ items: [{ id: 'E', title: '😀'.repeat(250) }] })
    expect(r.ok && r.value.items[0].title).toBe('😀'.repeat(250))
    expect(r.ok && r.cut).toBe(false)
  })

  it('refuses a page that is not one, naming what is wrong', () => {
    expect(itemsPage(null)).toEqual({ ok: false, problem: 'not an object with items' })
    expect(itemsPage({ items: 'x' })).toEqual({ ok: false, problem: 'not an object with items' })
    expect(itemsPage({ items: [{ title: 'no id' }] })).toEqual({ ok: false, problem: 'item 0 has no id' })
    expect(itemsPage({ items: [{ id: 'x'.repeat(201), title: 't' }] })).toEqual({ ok: false, problem: 'item 0 has an id longer than 200 characters' })
    expect(itemsPage({ items: [{ id: 'a' }] })).toEqual({ ok: false, problem: 'item 0 has no title' })
    // The 4a review's M3: an item listed is one a person can pick, so its id holds no control character
    expect(itemsPage({ items: [{ id: 'a\nb', title: 't' }] })).toEqual({ ok: false, problem: 'item 0 has a control character in its id' })
    expect(itemsPage({ items: [], nextCursor: 'c'.repeat(2_001) })).toEqual({ ok: false, problem: 'its nextCursor is longer than 2000 characters' })
    expect(itemsPage({ items: [], nextCursor: 7 })).toEqual({ ok: false, problem: 'its nextCursor is not text' })
  })
})

describe('itemDetail (J7)', () => {
  it('keeps the item, its body and up to 50 fields of text, cut to their limits', () => {
    const fields = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}`, `v${i}`]))
    const r = itemDetail({ id: 'ENG-1', title: 'Fix', body: 'b'.repeat(25_000), fields: { ...fields, n: 3, long: 'v'.repeat(2_000) } })
    if (!r.ok) throw new Error(r.problem)
    expect(r.cut).toBe(true)
    expect(Array.from(r.value.body!)).toHaveLength(20_000)
    expect(Object.keys(r.value.fields!)).toHaveLength(50)
    expect(r.value.fields!.n).toBeUndefined()
  })

  it('refuses one with no id or title', () => {
    expect(itemDetail({ title: 't' })).toEqual({ ok: false, problem: 'it has no id' })
    expect(itemDetail('x')).toEqual({ ok: false, problem: 'not an object' })
  })
})

describe('jobContext (J7)', () => {
  it('needs an objective and a label', () => {
    expect(jobContext({ sourceLabel: 'L' })).toEqual({ ok: false, problem: 'it has no objective' })
    expect(jobContext({ objective: '  ', sourceLabel: 'L' })).toEqual({ ok: false, problem: 'it has no objective' })
    expect(jobContext({ objective: 'o' })).toEqual({ ok: false, problem: 'it has no sourceLabel' })
  })

  it('cuts evidence to 20 entries and 100,000 characters in all, and keeps the url, metadata and label', () => {
    const r = jobContext({
      objective: 'o',
      sourceLabel: 'Linear ENG-1',
      sourceUrl: 'https://linear.app/x/ENG-1',
      evidence: Array.from({ length: 30 }, (_, i) => ({ label: `e${i}`, content: 'c'.repeat(10_000) })),
      metadata: { team: 'ENG', n: 1 }
    })
    if (!r.ok) throw new Error(r.problem)
    expect(r.cut).toBe(true)
    expect(r.value.evidence).toHaveLength(10)
    expect(r.value.evidence!.reduce((n, e) => n + e.content.length, 0)).toBe(SOURCE_EVIDENCE_TOTAL_MAX)
    expect(r.value).toMatchObject({ sourceLabel: 'Linear ENG-1', sourceUrl: 'https://linear.app/x/ENG-1', metadata: { team: 'ENG' } })
  })

  // The 4a review's I1: the total counts characters, as each entry's limit does, and never goes below nothing
  it('counts the 100,000 in characters, so emoji evidence stays within it and each entry within 20,000', () => {
    const r = jobContext({
      objective: 'o',
      sourceLabel: 'L',
      evidence: Array.from({ length: 8 }, (_, i) => ({ label: `e${i}`, content: '😀'.repeat(100_000) }))
    })
    if (!r.ok) throw new Error(r.problem)
    expect(r.cut).toBe(true)
    const sizes = r.value.evidence!.map((e) => Array.from(e.content).length)
    expect(sizes).toEqual([20_000, 20_000, 20_000, 20_000, 20_000])
  })

  // The 4a review's M4: the address the Host passes on is the one the URL parser read, within 2,048 characters
  it('passes a source url as the parser reads it, and drops one longer than 2,048 characters', () => {
    const r = jobContext({ objective: 'o', sourceLabel: 'L', sourceUrl: 'HTTPS://Linear.app/x/\nENG 1' })
    expect(r.ok && r.value.sourceUrl).toBe('https://linear.app/x/ENG%201')
    const long = jobContext({ objective: 'o', sourceLabel: 'L', sourceUrl: `https://x.dev/${'a'.repeat(2_048)}` })
    expect(long.ok && long.value.sourceUrl).toBeUndefined()
    const item = itemsPage({ items: [{ id: 'A', title: 't', url: 'https://x.dev/\tb' }] })
    expect(item.ok && item.value.items[0].url).toBe('https://x.dev/b')
  })

  it('drops evidence that is not a label and text, and a source url that is not http or https', () => {
    const r = jobContext({ objective: 'o', sourceLabel: 'L', sourceUrl: 'file:///etc/passwd', evidence: [{ label: 'x' }, 'y', { label: 'B', content: 'c' }] })
    if (!r.ok) throw new Error(r.problem)
    expect(r.value.sourceUrl).toBeUndefined()
    expect(r.value.evidence).toEqual([{ label: 'B', content: 'c' }])
  })
})
