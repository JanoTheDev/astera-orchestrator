// T19: the bell and the status bar count unread cards with one selector; opening an item marks that item read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBellState, markRead, resetBellStore, setRead } from './bellStore'
import { bellItems, unreadCount } from './bellView'
import type { NeedCard } from './inboxView'

const card = (key: string): NeedCard => ({ key }) as NeedCard

describe('needs-you count', () => {
  const mem = new Map<string, string>()
  beforeEach(() => {
    mem.clear()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) })
    resetBellStore()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetBellStore()
  })

  it('the bell badge count is the status bar count', () => {
    const needs = [card('a'), card('b'), card('c')]
    expect(bellItems(needs, [], new Set(['b'])).unread).toBe(unreadCount(needs, new Set(['b'])))
    expect(unreadCount(needs, new Set(['b']))).toBe(2)
  })

  it('opening an item marks only that item read, and it persists', () => {
    const needs = [card('a'), card('b')]
    expect(unreadCount(needs, getBellState().read)).toBe(2)
    markRead('a')
    expect(unreadCount(needs, getBellState().read)).toBe(1)
    resetBellStore()
    expect(getBellState().read.has('a')).toBe(true)
    expect(getBellState().read.has('b')).toBe(false)
  })

  it('Mark all read replaces the set', () => {
    setRead(['a', 'b'])
    expect(unreadCount([card('a'), card('b'), card('c')], getBellState().read)).toBe(1)
  })
})
