// The session thread kept in the session's note (Slack in the Host, spec S5). Each connection keeps its
// thread under its own pair of note keys (Slack: `slackThreadTs`, `slackChannel`, in Slack's threadNote.ts):
// whoever owns the connection writes them (plan ruling P9), and these helpers are the only readers, so a
// restart, a roll or an ownership handover resumes the same root instead of posting a second one.

/** A connection's note keys: the thread root's message id, then the channel (chat) it was posted in. */
export type NoteKeys = readonly [thread: string, channel: string]

export interface NotedThread {
  ts: string
  channel: string
}

/** The thread a session's note names under `keys`, or null. */
export function notedThreadOf(restore: Record<string, unknown>, keys: NoteKeys): NotedThread | null {
  const ts = restore[keys[0]]
  const channel = restore[keys[1]]
  return typeof ts === 'string' && typeof channel === 'string' ? { ts, channel } : null
}

/** The note patch for a thread, or the one that drops it (both keys null). */
export function threadNotePatch(t: NotedThread | null, keys: NoteKeys): Record<string, string | null> {
  return { [keys[0]]: t ? t.ts : null, [keys[1]]: t ? t.channel : null }
}

/** Telegram's note keys: the root message's id and the chat it was posted in. Kept here rather than in
 *  core/telegram so CONNECTION_NOTE_KEYS below names every connection without importing one. */
export const TELEGRAM_NOTE_KEYS = ['telegramMessageId', 'telegramChat'] as const

/** Discord's note keys: the thread's id (which is its root message's id) and the server it is in. */
export const DISCORD_NOTE_KEYS = ['discordThreadId', 'discordChannel'] as const

/** Every connection's note keys, so a step that carries a session's threads onward (a chat roll,
 *  core/chat/manager.ts) carries each connection's without importing any connection. A new connection's
 *  keys join this list. Slack's pair must equal THREAD_NOTE_KEYS in core/slack/threadNote.ts (tested). */
export const CONNECTION_NOTE_KEYS: readonly NoteKeys[] = [
  ['slackThreadTs', 'slackChannel'],
  TELEGRAM_NOTE_KEYS,
  DISCORD_NOTE_KEYS
]
