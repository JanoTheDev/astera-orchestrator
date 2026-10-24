import { describe, expect, it } from 'vitest'
import { createRefreshGate } from './refreshGate'

describe('devices refresh gate', () => {
  it('two shows in a row start one refresh', () => {
    const g = createRefreshGate(() => 0)
    expect(g.begin(false)).toBe(true)
    expect(g.begin(false)).toBe(false)
  })
  it('a show right after a finished refresh is skipped, a later one runs', () => {
    let t = 0
    const g = createRefreshGate(() => t, 1000)
    g.begin(false)
    g.end()
    t = 999
    expect(g.begin(false)).toBe(false)
    t = 1000
    expect(g.begin(false)).toBe(true)
  })
  it('a forced refresh runs while one is in flight', () => {
    const g = createRefreshGate(() => 0)
    g.begin(false)
    expect(g.begin(true)).toBe(true)
  })
})
