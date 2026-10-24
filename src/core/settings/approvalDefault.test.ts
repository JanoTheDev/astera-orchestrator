// The approval setting's global default as the app's store and the Host narrow it.
import { describe, expect, it } from 'vitest'
import { approvalDefaultOf } from './approvalDefault'

describe('approval default', () => {
  it('one of the three modes, else none', () => {
    for (const m of ['ask', 'start', 'hands-off'] as const) expect(approvalDefaultOf(m)).toBe(m)
    for (const v of [undefined, '', 'on', true, 1]) expect(approvalDefaultOf(v)).toBeUndefined()
  })
})
