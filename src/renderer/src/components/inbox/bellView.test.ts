// T9: the bell's pure half (bellView.ts).
import { describe, expect, it } from 'vitest'
import type { WorkspaceProject } from '../../state/workspaceTree'
import type { HandledLine, NeedCard } from './inboxView'
import { BELL_NEEDS_MAX, BELL_READ_KEY, badgeOf, bellActionOf, bellItems, loadRead, markAllRead, offersAllProjects, saveRead } from './bellView'

const card = (n: number, over: Partial<NeedCard> = {}): NeedCard => ({ key: `k${n}`, kind: 'question', at: `2026-10-18T09:${String(n).padStart(2, '0')}:00Z`, jobId: 'j1', projectName: 'p', planName: 'L', ...over })
const line = (n: number): HandledLine => ({ id: `e${n}`, at: '2026-10-18T09:00:00Z', text: `t${n}`, who: '', tone: 'ok' })
const project = (id: string): WorkspaceProject => ({ id, name: id, path: `/${id}`, plans: [] }) as unknown as WorkspaceProject

describe('bell badge', () => {
  it('is hidden at 0, the count up to 9, then 9+', () => {
    expect(badgeOf(0)).toBeNull()
    expect(badgeOf(1)).toBe('1')
    expect(badgeOf(9)).toBe('9')
    expect(badgeOf(10)).toBe('9+')
  })

  it('counts every unread "needs you" card, also past the shown eight', () => {
    const needs = Array.from({ length: 12 }, (_, i) => card(i))
    expect(bellItems(needs, [], new Set()).unread).toBe(12)
    expect(bellItems(needs, [], new Set(['k0', 'k1'])).unread).toBe(10)
    expect(bellItems([], [], new Set()).unread).toBe(0)
  })
})

describe('bell items', () => {
  it('lists the newest eight cards first and at most five handled lines', () => {
    const needs = Array.from({ length: 12 }, (_, i) => card(i)) // oldest first, as needsOf orders them
    const items = bellItems(needs, Array.from({ length: 9 }, (_, i) => line(i)), new Set())
    expect(items.needs).toHaveLength(BELL_NEEDS_MAX)
    expect(items.needs[0]?.key).toBe('k11')
    expect(items.recent.map((l) => l.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
  })

  it('a card offers Approve, Open or Answer by its kind', () => {
    expect(bellActionOf(card(1, { kind: 'approval' }))).toBe('approve')
    expect(bellActionOf(card(1, { kind: 'permission' }))).toBe('open')
    expect(bellActionOf(card(1, { kind: 'waiting' }))).toBe('open')
    expect(bellActionOf(card(1, { kind: 'question' }))).toBe('answer')
    expect(bellActionOf(card(1, { kind: 'escalation' }))).toBe('answer')
    expect(bellActionOf(card(1, { kind: 'gate' }))).toBe('answer')
  })

  it('offers "All projects" only with more than one project (Other does not count)', () => {
    expect(offersAllProjects([project('a')])).toBe(false)
    expect(offersAllProjects([project('a'), project('other')])).toBe(false)
    expect(offersAllProjects([project('a'), project('b')])).toBe(true)
  })
})

describe('read marks', () => {
  it('Mark all read keeps exactly what is listed, and round-trips through storage', () => {
    const keys = markAllRead([card(1), card(2)], [line(1)])
    expect(keys).toEqual(['k1', 'k2', 'e1'])
    const held = new Map<string, string>()
    const storage = { getItem: (k: string) => held.get(k) ?? null, setItem: (k: string, v: string) => void held.set(k, v) }
    saveRead(keys, storage)
    expect(held.has(BELL_READ_KEY)).toBe(true)
    expect([...loadRead(storage)]).toEqual(keys)
  })

  it('a broken or missing stored value reads as nothing read', () => {
    expect(loadRead({ getItem: () => 'not json' }).size).toBe(0)
    expect(loadRead({ getItem: () => '{"a":1}' }).size).toBe(0)
    expect(loadRead(undefined).size).toBe(0)
  })
})
