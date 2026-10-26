import { describe, expect, it } from 'vitest'
import { MAX_INJECT_CHARS } from '../connections/input'
import { classifyInbound, type InboundMessage } from './inbound'

const GUILD = '100'
const USER = '777'
const BOT = '999'
const THREAD = '500'
const isThread = (id: string): boolean => id === THREAD

const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  id: '1',
  channel_id: THREAD,
  guild_id: GUILD,
  content: 'go on',
  author: { id: USER },
  ...over
})
const classify = (m: InboundMessage, userId: string | null = USER) => classifyInbound(m, GUILD, userId, BOT, isThread)

describe('classifyInbound (Discord)', () => {
  it("routes the owner's message in a session thread to that thread", () => {
    expect(classify(msg())).toEqual({ kind: 'reply', target: THREAD, text: 'go on' })
  })

  it('hands a message outside every session thread on as other', () => {
    expect(classify(msg({ channel_id: '42' }))).toEqual({ kind: 'other', text: 'go on', channelId: '42' })
  })

  it('ignores bots, webhooks and our own messages', () => {
    expect(classify(msg({ author: { id: '5', bot: true } }))).toMatchObject({ reason: 'bot-message' })
    expect(classify(msg({ webhook_id: '8' }))).toMatchObject({ reason: 'bot-message' })
    expect(classify(msg({ author: { id: BOT } }))).toMatchObject({ reason: 'own-message' })
  })

  it('ignores another server', () => {
    expect(classify(msg({ guild_id: '101' }))).toMatchObject({ kind: 'ignore', reason: 'other-guild' })
    expect(classify(msg({ guild_id: undefined }))).toMatchObject({ kind: 'ignore', reason: 'other-guild' })
  })

  it('blocks everyone while no user id is set', () => {
    expect(classify(msg(), null)).toEqual({ kind: 'ignore', reason: 'user-id-unset' })
    expect(classify(msg(), '  ')).toEqual({ kind: 'ignore', reason: 'user-id-unset' })
  })

  it('ignores another user, naming them for the log, and never offers a note', () => {
    expect(classify(msg({ author: { id: '123' }, content: 'x'.repeat(MAX_INJECT_CHARS + 1) }))).toEqual({
      kind: 'ignore',
      reason: 'not-allowed-user',
      userId: '123'
    })
  })

  it('refuses empty text quietly and too long text with a note', () => {
    expect(classify(msg({ content: '  ' }))).toEqual({ kind: 'ignore', reason: 'empty-text' })
    expect(classify(msg({ content: 'x'.repeat(MAX_INJECT_CHARS + 1) }))).toEqual({ kind: 'ignore', reason: 'too-long', noteTo: THREAD })
  })
})
