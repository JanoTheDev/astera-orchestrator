import { describe, it, expect } from 'vitest'
import { notedThreadOf, threadNotePatch, CONNECTION_NOTE_KEYS, DISCORD_NOTE_KEYS, type NoteKeys } from './threadNote'
import { THREAD_NOTE_KEYS as SLACK_KEYS } from '../slack/threadNote'

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

describe('CONNECTION_NOTE_KEYS', () => {
  it("carries Slack's pair exactly as core/slack names it", () => {
    expect(CONNECTION_NOTE_KEYS).toContainEqual([...SLACK_KEYS])
  })

  it("carries Discord's pair", () => {
    expect(CONNECTION_NOTE_KEYS).toContainEqual(DISCORD_NOTE_KEYS)
  })
})
