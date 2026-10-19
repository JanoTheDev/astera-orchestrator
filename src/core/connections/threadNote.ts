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
