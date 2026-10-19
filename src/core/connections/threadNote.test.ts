import { describe, it, expect } from 'vitest'
import { notedThreadOf, threadNotePatch, type NoteKeys } from './threadNote'

const KEYS: NoteKeys = ['xThread', 'xChat']

describe('threadNote (spec S5)', () => {
  it('reads a thread only when both keys are strings', () => {
    expect(notedThreadOf({ xThread: '1.2', xChat: 'C1' }, KEYS)).toEqual({ ts: '1.2', channel: 'C1' })
    for (const r of [{}, { xThread: '1.2' }, { xThread: null, xChat: null }, { xThread: 1, xChat: 'C1' }, { slackThreadTs: '1.2', slackChannel: 'C1' }])
      expect(notedThreadOf(r, KEYS)).toBeNull()
  })
  it('patches both keys, or drops both', () => {
    expect(threadNotePatch({ ts: '1.2', channel: 'C1' }, KEYS)).toEqual({ xThread: '1.2', xChat: 'C1' })
    expect(threadNotePatch(null, KEYS)).toEqual({ xThread: null, xChat: null })
  })
})
