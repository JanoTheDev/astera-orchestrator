// The pure decision of whether a Telegram message is a command for a session. What an accepted reply turns
// into is core/connections/input.ts and replies.ts; the polling is inbox.ts. Kept pure so the checks that
// carry the risk (the wrong chat, the wrong person, the bot's own echo, an old message) are all tested.
import { MAX_INJECT_CHARS } from '../connections/input'

/** Only the fields we look at on a Telegram message. Kept narrow, and unknown on purpose: it comes off the wire. */
export interface InboundMessage {
  message_id?: unknown
  date?: unknown
  text?: unknown
  chat?: { id?: unknown }
  from?: { id?: unknown; is_bot?: unknown }
  reply_to_message?: { message_id?: unknown }
}

export type IgnoreReason =
  | 'bot-message' // from a bot — cuts the notify -> receive -> inject loop
  | 'other-chat'
  | 'user-id-unset' // no user id is configured — everything is blocked until one is
  | 'not-allowed-user'
  | 'stale' // sent before the inbox started: an old command must not run now
  | 'empty-text'
  | 'not-reply' // which session it belongs to cannot be told (the owner is told how to reply)
  | 'too-long' // over MAX_INJECT_CHARS — rejected rather than truncated and sent

export type InboundDecision =
  | { kind: 'inject'; replyTo: string; text: string }
  | { kind: 'ignore'; reason: IgnoreReason; /** the user's message id, when a note may answer it */ noteTo?: string }

const idOf = (v: unknown): string | null => (typeof v === 'number' || typeof v === 'string') && `${v}` !== '' ? `${v}` : null

/**
 * `chatId` and `userId` are the configured values; **a missing userId blocks everything** rather than
 * allowing the whole chat (a required parameter, so a caller cannot forget it). `startedAtSec` is when the
 * inbox started, in Unix seconds like Telegram's `date`.
 *
 * The sender checks come before the checks that post a note back (not-reply, too-long), so a stranger can
 * never make the bot answer them.
 */
export function classifyInbound(
  msg: InboundMessage,
  chatId: string,
  userId: string | null,
  startedAtSec: number
): InboundDecision {
  if (msg.from?.is_bot === true) return { kind: 'ignore', reason: 'bot-message' }
  if (idOf(msg.chat?.id) !== chatId.trim()) return { kind: 'ignore', reason: 'other-chat' }
  const allowed = userId?.trim() ?? ''
  if (allowed === '') return { kind: 'ignore', reason: 'user-id-unset' }
  if (idOf(msg.from?.id) !== allowed) return { kind: 'ignore', reason: 'not-allowed-user' }
  if (typeof msg.date !== 'number' || msg.date < startedAtSec) return { kind: 'ignore', reason: 'stale' }
  const text = typeof msg.text === 'string' ? msg.text.trim() : ''
  if (text === '') return { kind: 'ignore', reason: 'empty-text' }
  const noteTo = idOf(msg.message_id) ?? undefined
  const replyTo = idOf(msg.reply_to_message?.message_id)
  if (!replyTo) return { kind: 'ignore', reason: 'not-reply', noteTo }
  if (text.length > MAX_INJECT_CHARS) return { kind: 'ignore', reason: 'too-long', noteTo }
  return { kind: 'inject', replyTo, text }
}
