import { describe, it, expect } from 'vitest'
import { notedThreadOf, threadNotePatch } from './threadNote'

describe('Slack threadNote (spec S5)', () => {
  it('keeps the note keys slackThreadTs and slackChannel', () => {
    expect(notedThreadOf({ slackThreadTs: '1.2', slackChannel: 'C1' })).toEqual({ ts: '1.2', channel: 'C1' })
    expect(notedThreadOf({ slackThreadTs: '1.2' })).toBeNull()
    expect(threadNotePatch({ ts: '1.2', channel: 'C1' })).toEqual({ slackThreadTs: '1.2', slackChannel: 'C1' })
    expect(threadNotePatch(null)).toEqual({ slackThreadTs: null, slackChannel: null })
  })
})
