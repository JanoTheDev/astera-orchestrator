import { describe, expect, it } from 'vitest'
import { MAX_INJECT_CHARS } from '../connections/input'
import { classifyInbound, type InboundMessage } from './inbound'

const CHAT = '42'
const ME = '777'
const START = 1_700_000_000

const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({
  message_id: 500,
  date: START + 5,
  text: 'go on',
  chat: { id: 42 },
  from: { id: 777, is_bot: false },
  reply_to_message: { message_id: 11 },
  ...over
})

describe('classifyInbound', () => {
  it('accepts a reply from the allowed user in the configured chat', () => {
    expect(classifyInbound(msg(), CHAT, ME, START)).toEqual({ kind: 'inject', replyTo: '11', text: 'go on' })
  })

  it('trims the text and compares ids as strings (numbers on the wire)', () => {
    expect(classifyInbound(msg({ text: '  hi \n' }), ' 42 ', ' 777 ', START)).toEqual({ kind: 'inject', replyTo: '11', text: 'hi' })
  })

  it('ignores another chat', () => {
    expect(classifyInbound(msg({ chat: { id: 43 } }), CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'other-chat' })
  })

  it('ignores another user', () => {
    expect(classifyInbound(msg({ from: { id: 1, is_bot: false } }), CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'not-allowed-user' })
  })

  it('blocks everything when no user id is configured', () => {
    for (const unset of [null, '', '  ']) {
      expect(classifyInbound(msg(), CHAT, unset, START)).toEqual({ kind: 'ignore', reason: 'user-id-unset' })
    }
  })

  it('ignores a bot, even the allowed id', () => {
    expect(classifyInbound(msg({ from: { id: 777, is_bot: true } }), CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'bot-message' })
  })

  it('ignores a message with no text', () => {
    expect(classifyInbound(msg({ text: undefined }), CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'empty-text' })
    expect(classifyInbound(msg({ text: '  ' }), CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'empty-text' })
  })

  it('ignores a message older than the inbox start', () => {
    expect(classifyInbound(msg({ date: START - 1 }), CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'stale' })
    expect(classifyInbound(msg({ date: undefined }), CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'stale' })
    expect(classifyInbound(msg({ date: START }), CHAT, ME, START).kind).toBe('inject')
  })

  it('answers a message that is not a reply with a note to that message', () => {
    expect(classifyInbound(msg({ reply_to_message: undefined }), CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'not-reply', noteTo: '500' })
  })

  it('rejects over-long text instead of truncating it', () => {
    expect(classifyInbound(msg({ text: 'x'.repeat(MAX_INJECT_CHARS + 1) }), CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'too-long', noteTo: '500' })
  })

  it('never offers a note to a stranger', () => {
    const stranger = msg({ from: { id: 1 }, reply_to_message: undefined, text: 'x'.repeat(MAX_INJECT_CHARS + 1) })
    expect(classifyInbound(stranger, CHAT, ME, START)).toEqual({ kind: 'ignore', reason: 'not-allowed-user' })
  })
})
