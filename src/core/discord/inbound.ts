// The pure decision of whether a Discord message (a Gateway MESSAGE_CREATE) is a reply for a session (said in
// its thread) or something else (said anywhere else in the server), mirroring core/telegram/inbound.ts. What an
// accepted reply turns into is core/connections/input.ts and replies.ts; the Gateway is inbox.ts. Kept pure so
// the checks that carry the risk (the wrong server, the wrong person, the bot's own echo) are all tested.
import { MAX_INJECT_CHARS } from '../connections/input'

/** Only the fields we look at on a Discord message. Unknown on purpose: it comes off the wire. */
export interface InboundMessage {
  id?: unknown
  channel_id?: unknown
  guild_id?: unknown
  content?: unknown
  webhook_id?: unknown
  author?: { id?: unknown; bot?: unknown }
}

export type IgnoreReason =
  | 'bot-message' // from a bot or a webhook — cuts the notify -> receive -> inject loop
  | 'own-message'
  | 'other-guild'
  | 'user-id-unset' // no user id is configured — everything is blocked until one is
  | 'not-allowed-user'
  | 'empty-text'
  | 'too-long' // over MAX_INJECT_CHARS — rejected rather than truncated and sent

export type InboundDecision =
  /** Said in a session's thread: `target` is the thread (its root's id), where a note about it goes too. */
  | { kind: 'reply'; target: string; text: string }
  /** Said outside every session thread: the extra listener's, else the Astera console's. */
  | { kind: 'other'; text: string; channelId: string }
  | {
      kind: 'ignore'
      reason: IgnoreReason
      /** The sender, for the log line of a not-allowed user (a Discord user id is not secret). */
      userId?: string
      /** The channel, when a note may answer it. */
      noteTo?: string
    }

const idOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * `guildId` and `userId` are the configured values; **a missing userId blocks everything** rather than
 * allowing the whole server (a required parameter, so a caller cannot forget it). `botUserId` is the bot's
 * own id (from READY), and `isSessionThread` says whether a channel is one of our session threads.
 *
 * The sender checks come before the check that posts a note back (too-long), so a stranger can never make
 * the bot answer them.
 */
export function classifyInbound(
  msg: InboundMessage,
  guildId: string,
  userId: string | null,
  botUserId: string | null,
  isSessionThread: (channelId: string) => boolean
): InboundDecision {
  const author = idOf(msg.author?.id)
  if (msg.author?.bot === true || msg.webhook_id != null) return { kind: 'ignore', reason: 'bot-message' }
  if (author !== null && author === botUserId) return { kind: 'ignore', reason: 'own-message' }
  if (idOf(msg.guild_id) !== guildId.trim()) return { kind: 'ignore', reason: 'other-guild' }
  const allowed = userId?.trim() ?? ''
  if (allowed === '') return { kind: 'ignore', reason: 'user-id-unset' }
  if (author !== allowed) return { kind: 'ignore', reason: 'not-allowed-user', userId: author ?? 'unknown' }
  const channelId = idOf(msg.channel_id)
  const text = typeof msg.content === 'string' ? msg.content.trim() : ''
  if (text === '' || channelId === null) return { kind: 'ignore', reason: 'empty-text' }
  if (text.length > MAX_INJECT_CHARS) return { kind: 'ignore', reason: 'too-long', noteTo: channelId }
  if (isSessionThread(channelId)) return { kind: 'reply', target: channelId, text }
  return { kind: 'other', text, channelId }
}
