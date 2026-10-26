// Owns where the notifier's text goes in Discord (core/connections/notifier.ts holds what it says). A session's
// root goes to a text channel and a thread is started from it; Discord gives a thread started from a message
// that message's id as its channel id, so the root's id IS the thread's id, and a post into the thread is a
// post to that channel. Errors are rest.ts's DiscordApiError (a ConnectionPostError): status and code only,
// never the token.
import { ConnectionPostError, type ConnectionTransport } from '../connections/transport'
import { ChannelType, DiscordApiError, type DiscordChannel, type DiscordMessage, type DiscordRest } from './rest'
import { toDiscordText } from './format'

/** The category and channel the default root channel lives in, created by the bot when missing. */
export const ASTERA_CATEGORY = 'Astera'
export const SESSIONS_CHANNEL = 'sessions'
/** Discord's cap on a thread name. */
const THREAD_NAME_MAX = 100
/** A week: the longest a thread stays open with nothing said; a post into an archived one reopens it. */
const AUTO_ARCHIVE_MIN = 10080
/** Discord's "Unknown Channel": the cached channel was deleted. */
const UNKNOWN_CHANNEL = 10003

/** The channel a session's root goes to; null for the default #sessions. */
export type RootChannel = (sessionId?: string) => Promise<string | null>

/** The thread's name: the root's first line, cut to Discord's cap. */
function threadNameOf(text: string): string {
  const name = Array.from(text.split('\n')[0].trim()).slice(0, THREAD_NAME_MAX).join('')
  return name || 'session'
}

export class DiscordTransport implements ConnectionTransport {
  readonly supportsThreads = true
  /** The #sessions channel's id, looked up (or created) once and kept; dropped when Discord says it is gone. */
  private sessions: Promise<string> | null = null

  constructor(
    private rest: DiscordRest,
    private guildId: string,
    private rootChannel: RootChannel = async () => null
  ) {}

  async post(text: string, threadId?: string, ctx?: { sessionId?: string }): Promise<string | null> {
    const content = toDiscordText(text)
    if (threadId) return (await this.rest.postMessage(threadId, { content })).id
    const custom = await this.rootChannel(ctx?.sessionId).catch((err: unknown) => {
      throw err instanceof ConnectionPostError ? err : new ConnectionPostError('root channel unresolved')
    })
    const channel = custom ?? (await this.sessionsChannel())
    let msg: DiscordMessage
    try {
      msg = await this.rest.postMessage(channel, { content })
    } catch (err) {
      if (!custom && err instanceof DiscordApiError && err.code === UNKNOWN_CHANNEL) this.sessions = null
      throw err
    }
    // Only a session's root opens a thread; a notice or a channel-level fallback stays a plain message.
    if (!ctx) return msg.id
    const thread = await this.rest.startThread(channel, msg.id, { name: threadNameOf(text), auto_archive_duration: AUTO_ARCHIVE_MIN })
    return thread.id
  }

  private sessionsChannel(): Promise<string> {
    this.sessions ??= this.findOrCreateSessions().catch((err: unknown) => {
      this.sessions = null
      throw err
    })
    return this.sessions
  }

  /** #sessions under the Astera category, looked up by name first, each created only when missing. */
  private async findOrCreateSessions(): Promise<string> {
    const all = await this.rest.guildChannels(this.guildId)
    const named = (c: DiscordChannel, type: number, name: string): boolean => c.type === type && c.name?.toLowerCase() === name.toLowerCase()
    const reason = 'Astera session threads'
    const category =
      all.find((c) => named(c, ChannelType.GUILD_CATEGORY, ASTERA_CATEGORY)) ??
      (await this.rest.createChannel(this.guildId, { name: ASTERA_CATEGORY, type: ChannelType.GUILD_CATEGORY }, { reason }))
    const sessions =
      all.find((c) => named(c, ChannelType.GUILD_TEXT, SESSIONS_CHANNEL) && c.parent_id === category.id) ??
      (await this.rest.createChannel(this.guildId, { name: SESSIONS_CHANNEL, type: ChannelType.GUILD_TEXT, parent_id: category.id }, { reason }))
    return sessions.id
  }
}
