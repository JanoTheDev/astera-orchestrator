import { describe, expect, it } from 'vitest'
import { previewEntryIdOf } from './sessionPreview'

const d = (sessionId: string, startedAt: string, nativeSessionId?: string, accountId = 'acc') => ({
  sessionId,
  accountId,
  startedAt,
  ...(nativeSessionId ? { nativeSessionId } : {})
})

describe('previewEntryIdOf', () => {
  it('is the History entry id of the session dispatch native id', () => {
    expect(previewEntryIdOf('s1', [d('s2', '1', 'n2'), d('s1', '1', 'n1', 'a1')])).toBe('a1:n1')
  })
  it('takes the latest dispatch that learned a native id', () => {
    expect(previewEntryIdOf('s1', [d('s1', '2', 'late'), d('s1', '1', 'early'), d('s1', '3')])).toBe('acc:late')
  })
  it('is null without a native id or without a dispatch (planner, coordinator)', () => {
    expect(previewEntryIdOf('s1', [d('s1', '1')])).toBeNull()
    expect(previewEntryIdOf('coord', [d('s1', '1', 'n1')])).toBeNull()
  })
})
