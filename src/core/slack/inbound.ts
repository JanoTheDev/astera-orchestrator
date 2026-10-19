// The pure decisions and conversions that turn a Slack thread reply into session input.
//
// Everything that touches the SDK (@slack/socket-mode) is core/slack/inbox.ts's job, and what a reply turns into
// (the PTY bytes, a chat turn, choice keys) is core/connections/input.ts's; only "should this
// message be injected" lives here — that question is where this
// feature's risk is concentrated (infinite loops, the wrong channel, newline handling), and being pure
// functions they can all be tested without a real connection.
import { MAX_INJECT_CHARS } from '../connections/input'

/** Only the fields we look at on a Slack message event. Kept narrow so it is not tied to the SDK types. */
export interface InboundMessage {
  channel?: unknown
  text?: unknown
  thread_ts?: unknown
  ts?: unknown
  bot_id?: unknown
  subtype?: unknown
  /** Who sent it. Slack's UI calls this value the "Member ID" (profile → ⋯ → Copy member ID) and
   *  sends it in this `user` field — that is the pairing the memberId setting is compared against. */
  user?: unknown
}

export type InboundDecision =
  | { kind: 'inject'; threadTs: string; text: string }
  | { kind: 'ignore'; reason: IgnoreReason; threadTs?: string }

export type IgnoreReason =
  | 'bot-message' // posted by the bot itself — cuts the notify → receive → inject infinite loop
  | 'other-channel' // not the configured channel
  | 'member-id-unset' // no Member ID is configured — everything is blocked until one is (see classifyInbound)
  | 'not-allowed-user' // someone other than the configured Member ID
  | 'not-thread-reply' // not a thread reply, so which session it belongs to cannot be determined
  | 'subtype' // an edit, a delete and so on — not something the user actually said (file_share and thread_broadcast are exceptions — allowed)
  | 'empty-text'
  | 'too-long' // over MAX_INJECT_CHARS — rejected rather than truncated and sent (a partial command is more dangerous)

/** Cases where a subtype is present but the message is still something the user just said — these are
 *  not ignored.
 *  file_share: a reply sent along with a file, a screenshot for instance (it carries the text too).
 *  thread_broadcast: a thread reply sent with the "also send to channel" option — still a reply in that
 *  thread. */
const ALLOWED_SUBTYPES = new Set(['file_share', 'thread_broadcast'])

/**
 * Decides whether to inject this message. Why the ignore reason comes back as a value: it has to be in
 * the log for the user to learn "why isn't my reply landing", and each reason can be pinned down by a
 * test.
 *
 * `channelId` is the configured channel. If the bot is invited to other channels too, those channels'
 * messages arrive as events as well; they do get filtered indirectly by not being in the thread
 * mapping — but they are cut off here first. The control belongs in an explicit check rather than in
 * "it is not in the mapping, so it is safe as a consequence".
 *
 * `memberId` is the one Slack Member ID allowed to drive the session. The channel check alone is not a
 * permission boundary: anyone invited to that channel could reply in a thread and push input into
 * someone else's session. **A missing memberId blocks everything** rather than allowing everyone —
 * the safe direction for a value whose whole purpose is a permission check. It is passed as a required
 * parameter for the same reason: made optional, a caller that forgot the argument would silently fall
 * back to allowing the entire channel.
 */
export function classifyInbound(
  msg: InboundMessage,
  channelId: string,
  memberId: string | null
): InboundDecision {
  // The bot check comes first — cutting it off before any other condition is what leaves no loop risk
  if (typeof msg.bot_id === 'string' && msg.bot_id !== '') return { kind: 'ignore', reason: 'bot-message' }
  if (msg.channel !== channelId) return { kind: 'ignore', reason: 'other-channel' }
  // A message event with a subtype is mostly an edit (message_changed), a delete, a channel join and so
  // on. It is not something the user just typed, and an edit event's text sometimes carries the previous
  // content, so injecting it produces nonsense input. file_share and thread_broadcast are the
  // exceptions — both are replies the user really did send at that moment.
  if (
    typeof msg.subtype === 'string' &&
    msg.subtype !== '' &&
    !ALLOWED_SUBTYPES.has(msg.subtype)
  ) {
    return { kind: 'ignore', reason: 'subtype' }
  }
  // The sender check. It sits *after* the subtype check and *before* everything below, and both halves
  // of that position are deliberate.
  //
  // After subtype: an edit event (message_changed) carries its author in `message.user`, so the
  // top-level `user` is empty. Checked earlier, every edit would be logged as not-allowed-user and the
  // existing reason would stop meaning what it says.
  //
  // Before the thread and text checks: `too-long` is the only ignore path that posts a note back into
  // the thread. Were the sender check below it, anyone in the channel could make the bot answer them
  // with a reply over MAX_INJECT_CHARS.
  //
  // Unset and mismatched are separate reasons because the log is the only diagnosis surface here —
  // unset says "go set it", while mismatched carries the rejected id so a typo in one's own Member ID
  // can be fixed from that value. Trimmed on both sides; case is not normalised (Slack IDs are always
  // upper case, and a typo is diagnosed from the logged id).
  const allowed = memberId !== null ? memberId.trim() : ''
  if (allowed === '') return { kind: 'ignore', reason: 'member-id-unset' }
  const sender = typeof msg.user === 'string' ? msg.user.trim() : ''
  if (sender !== allowed) return { kind: 'ignore', reason: 'not-allowed-user' }
  const threadTs = typeof msg.thread_ts === 'string' ? msg.thread_ts : null
  // No thread_ts means it was written straight into the channel, and a thread_ts equal to ts means it is
  // the thread root itself — neither is a reply
  if (!threadTs || threadTs === msg.ts) return { kind: 'ignore', reason: 'not-thread-reply' }
  const rawText = typeof msg.text === 'string' ? msg.text : ''
  const text = unescapeSlackText(rawText).trim()
  if (text === '') return { kind: 'ignore', reason: 'empty-text' }
  if (text.length > MAX_INJECT_CHARS) return { kind: 'ignore', reason: 'too-long', threadTs }
  return { kind: 'inject', threadTs, text }
}

/**
 * Turns the notation Slack encodes for mrkdwn back into the text a human actually typed
 * — without this, `npm run build && npm test` arrives as
 * `npm run build &amp;&amp; npm test`, and `<https://x|docs>` gets injected with that syntax intact.
 *
 * The order matters:
 * 1) Links and mentions (`<url|label>`, `<@U123>`, `<#C123|channel>`) are unwrapped first. Every
 *    `<...>` still alive in the raw text at this point is Slack link syntax — a `<` or `>` the user
 *    actually typed is already sent escaped by Slack as `&lt;`/`&gt;`, so it does not match this regex.
 *    Unescaping the entities first would make the `&lt;@fake&gt;` of a user who literally wrote
 *    `<@fake>` get misread as a mention here.
 * 2) `&lt;` and `&gt;` are unescaped.
 * 3) `&amp;` is unescaped last — doing it first would take the `&amp;lt;` that arrives when a user
 *    literally wrote `&lt;` and, with the order reversed, double-decode it through `&lt;` all the way
 *    to `<`.
 */
function unescapeSlackText(text: string): string {
  const withLinks = text.replace(/<([^<>]+)>/g, (_match: string, inner: string) => {
    const pipeIdx = inner.indexOf('|')
    return pipeIdx === -1 ? inner : inner.slice(pipeIdx + 1)
  })
  return withLinks.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
