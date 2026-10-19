// Slack's session thread note (spec S5): the keys `slackThreadTs` and `slackChannel` already stored in
// session notes, read and written through the shared helpers in core/connections/threadNote.ts. The keys
// must never change, or every noted thread is forgotten and each session opens a second root.
import { notedThreadOf as notedUnder, threadNotePatch as patchUnder, type NotedThread } from '../connections/threadNote'

/** The note keys Slack's thread is kept under. */
export const THREAD_NOTE_KEYS = ['slackThreadTs', 'slackChannel'] as const

/** The Slack thread a session's note names, or null. */
export const notedThreadOf = (restore: Record<string, unknown>): NotedThread | null => notedUnder(restore, THREAD_NOTE_KEYS)

/** The note patch for a Slack thread, or the one that drops it (both keys null). */
export const threadNotePatch = (t: NotedThread | null): Record<string, string | null> => patchUnder(t, THREAD_NOTE_KEYS)
