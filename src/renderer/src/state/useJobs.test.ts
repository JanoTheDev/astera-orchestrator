import { describe, expect, it } from 'vitest'
import { stickyAfterGone, stickyProbes } from './useJobs'

// The focus probe must ask about the in-memory root too: scopeRoot's effect overwrites the stored key, so storage can
// name a live folder while the in-memory root names a deleted one.
describe('stickyProbes', () => {
  it('asks about the in-memory root even when storage holds another folder', () => {
    expect(stickyProbes('/tmp/scope', '/tmp/gone')).toEqual(['/tmp/scope', '/tmp/gone'])
  })

  it('asks once when both name the same folder, and skips the empty ones', () => {
    expect(stickyProbes('/tmp/p', '/tmp/p')).toEqual(['/tmp/p'])
    expect(stickyProbes(null, null)).toEqual([])
  })
})

describe('stickyAfterGone', () => {
  it('drops the in-memory root when its folder is gone', () => {
    expect(stickyAfterGone('/tmp/gone', '/tmp/gone')).toBeNull()
  })

  it('keeps a live in-memory root when another folder is the gone one', () => {
    expect(stickyAfterGone('/tmp/live', '/tmp/gone')).toBe('/tmp/live')
  })
})
