import { describe, expect, it, vi } from 'vitest'
import { memoByIdentity } from './memoByIdentity'

describe('memoByIdentity', () => {
  it('returns the same result object for the same input identity', () => {
    const fn = vi.fn((rows: readonly number[]) => ({ n: rows.length }))
    const memo = memoByIdentity(fn)
    const rows = [1, 2]
    expect(memo(rows)).toBe(memo(rows))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('recomputes for a new input, even an equal one', () => {
    const fn = vi.fn((rows: readonly number[]) => ({ n: rows.length }))
    const memo = memoByIdentity(fn)
    const first = memo([1])
    expect(memo([1])).not.toBe(first)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('compares every argument', () => {
    const fn = vi.fn((rows: readonly number[], hide: boolean) => ({ n: rows.length, hide }))
    const memo = memoByIdentity(fn)
    const rows = [1]
    expect(memo(rows, true)).toBe(memo(rows, true))
    expect(memo(rows, false).hide).toBe(false)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
