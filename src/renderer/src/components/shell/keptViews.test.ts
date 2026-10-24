import { describe, it, expect } from 'vitest'
import { keepViews } from './keptViews'

describe('keepViews', () => {
  it('starts with the visited view', () => {
    expect(keepViews([], 'agents')).toEqual(['agents'])
  })

  it('moves a revisited view to the front without duplicating it', () => {
    expect(keepViews(['plans', 'agents', 'scm'], 'agents')).toEqual(['agents', 'plans', 'scm'])
  })

  it('evicts the least recently used view beyond the limit', () => {
    expect(keepViews(['scm', 'explorer', 'plans', 'agents'], 'run')).toEqual(['run', 'scm', 'explorer', 'plans'])
  })

  it('honours a custom limit and never drops the current view', () => {
    expect(keepViews(['a', 'b'] as never[], 'agents', 1)).toEqual(['agents'])
  })
})
