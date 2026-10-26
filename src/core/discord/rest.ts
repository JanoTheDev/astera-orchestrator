// A small fetch-based client for the Discord REST API (v10): JSON in and out, rate limits honoured, and only
// the calls the Discord connection needs. It is not a generic SDK and adds no dependency. The bot token goes
// into the Authorization header only: no URL, fetch error message or response body ever reaches a log or an
// error — errors carry the HTTP status and Discord's numeric error code, nothing else.
import { ConnectionPostError } from '../connections/transport'

export const DISCORD_API = 'https://discord.com/api/v10'
const USER_AGENT = 'DiscordBot (https://github.com/JanoTheDev/astera-orchestrator, 1)'
const REQUEST_TIMEOUT_MS = 15_000
/** Retries after a 429, and the most they may wait together. */
const MAX_RETRIES = 3
const MAX_RETRY_WAIT_MS = 60_000

/** A Discord API call that failed. Its message is safe to log: only the status and Discord's code. */
export class DiscordApiError extends ConnectionPostError {
  constructor(
    /** The HTTP status, or 0 when the request never got an answer. */
    readonly status: number,
    /** Discord's numeric error code (e.g. 50013 missing permissions), or null when it gave none. */
    readonly code: number | null
  ) {
    super(code === null ? `status=${status}` : `status=${status} code=${code}`)
    this.name = 'DiscordApiError'
  }
}

export const ChannelType = {
  GUILD_TEXT: 0,
  GUILD_CATEGORY: 4,
  PUBLIC_THREAD: 11,
  PRIVATE_THREAD: 12
} as const

export interface DiscordUser {
  id: string
  username: string
  bot?: boolean
}
export interface DiscordApplication {
  id: string
  name: string
}
export interface DiscordChannel {
  id: string
  type: number
  name?: string
  parent_id?: string | null
  topic?: string | null
  position?: number
}
export interface DiscordMessage {
  id: string
  channel_id: string
  content: string
}
export interface AllowedMentions {
  parse: Array<'users' | 'roles' | 'everyone'>
  users?: string[]
}
export interface MessageBody {
  content?: string
  embeds?: unknown[]
  components?: unknown[]
  /** Defaults to { parse: [] }: text from a session (`@everyone`, `<@id>`) never pings anyone. */
  allowed_mentions?: AllowedMentions
}
export interface ChannelCreate {
  name: string
  type: number
  parent_id?: string
  topic?: string
  position?: number
}
export interface InteractionResponse {
  type: number
  data?: MessageBody & Record<string, unknown>
}

export interface DiscordRestOptions {
  token: string
  fetchFn?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface RequestOptions {
  /** Shown in the server's audit log (X-Audit-Log-Reason). */
  reason?: string
}

const NO_PINGS: AllowedMentions = { parse: [] }
const noPings = <T extends MessageBody>(body: T): T => ({ allowed_mentions: NO_PINGS, ...body })

/** The rate limit bucket of a call: Discord buckets by method, route and its first ("major") id, so every
 *  later id (a message, an interaction token) is folded away. */
function bucketOf(method: string, route: string): string {
  let seen = 0
  return `${method} ${route
    .split('/')
    .map((seg) => (/^\d{15,}$/.test(seg) && seen++ > 0 ? ':id' : seg))
    .join('/')}`
}

function retryAfterMs(res: Response, body: { retry_after?: unknown }): number {
  const fromBody = typeof body.retry_after === 'number' ? body.retry_after : NaN
  const fromHeader = Number(res.headers.get('Retry-After'))
  const seconds = Number.isFinite(fromBody) ? fromBody : Number.isFinite(fromHeader) ? fromHeader : 1
  return Math.max(0, seconds * 1000)
}

export function discordRest(opts: DiscordRestOptions) {
  const fetchFn = opts.fetchFn ?? fetch
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  /** When each exhausted bucket opens again (epoch ms). */
  const blockedUntil = new Map<string, number>()

  async function send(method: string, route: string, body: unknown, reason?: string): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bot ${opts.token}`, 'User-Agent': USER_AGENT }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(reason)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetchFn(`${DISCORD_API}${route}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ac.signal
      })
    } catch {
      // a fetch error is never passed on: its message or cause could carry request details
      throw new DiscordApiError(0, null)
    } finally {
      clearTimeout(timer)
    }
  }

  async function request<T>(method: string, route: string, body?: unknown, ro: RequestOptions = {}): Promise<T> {
    const bucket = bucketOf(method, route)
    let waited = 0
    for (let attempt = 0; ; attempt++) {
      const until = blockedUntil.get(bucket)
      if (until !== undefined) {
        blockedUntil.delete(bucket)
        if (until > now()) await sleep(Math.min(until - now(), MAX_RETRY_WAIT_MS))
      }
      const res = await send(method, route, body, ro.reason)
      if (res.headers.get('X-RateLimit-Remaining') === '0') {
        const resetAfter = Number(res.headers.get('X-RateLimit-Reset-After'))
        if (Number.isFinite(resetAfter)) blockedUntil.set(bucket, now() + resetAfter * 1000)
      }
      let json: Record<string, unknown> = {}
      if (res.status !== 204) {
        try {
          json = ((await res.json()) ?? {}) as Record<string, unknown>
        } catch {
          /* an HTML error page from a proxy: the status alone describes it */
        }
      }
      if (res.ok) return (res.status === 204 ? undefined : json) as T
      const code = typeof json.code === 'number' ? json.code : null
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const wait = retryAfterMs(res, json)
        if (waited + wait <= MAX_RETRY_WAIT_MS) {
          waited += wait
          await sleep(wait)
          continue
        }
      }
      throw new DiscordApiError(res.status, code)
    }
  }

  return {
    request,
    me: () => request<DiscordUser>('GET', '/users/@me'),
    application: () => request<DiscordApplication>('GET', '/applications/@me'),
    guildChannels: (guildId: string) => request<DiscordChannel[]>('GET', `/guilds/${guildId}/channels`),
    createChannel: (guildId: string, ch: ChannelCreate, ro?: RequestOptions) =>
      request<DiscordChannel>('POST', `/guilds/${guildId}/channels`, ch, ro),
    editChannel: (id: string, patch: Partial<ChannelCreate>, ro?: RequestOptions) =>
      request<DiscordChannel>('PATCH', `/channels/${id}`, patch, ro),
    deleteChannel: (id: string, ro?: RequestOptions) => request<DiscordChannel>('DELETE', `/channels/${id}`, undefined, ro),
    postMessage: (channelId: string, msg: MessageBody) =>
      request<DiscordMessage>('POST', `/channels/${channelId}/messages`, noPings(msg)),
    editMessage: (channelId: string, messageId: string, msg: MessageBody) =>
      request<DiscordMessage>('PATCH', `/channels/${channelId}/messages/${messageId}`, noPings(msg)),
    deleteMessage: (channelId: string, messageId: string) =>
      request<void>('DELETE', `/channels/${channelId}/messages/${messageId}`),
    pinMessage: (channelId: string, messageId: string) =>
      request<void>('PUT', `/channels/${channelId}/pins/${messageId}`),
    startThread: (channelId: string, messageId: string, t: { name: string; auto_archive_duration: number }) =>
      request<DiscordChannel>('POST', `/channels/${channelId}/messages/${messageId}/threads`, t),
    startThreadWithoutMessage: (channelId: string, t: { name: string; type: number }) =>
      request<DiscordChannel>('POST', `/channels/${channelId}/threads`, t),
    bulkOverwriteGuildCommands: (appId: string, guildId: string, commands: unknown[]) =>
      request<unknown[]>('PUT', `/applications/${appId}/guilds/${guildId}/commands`, commands),
    interactionCallback: (id: string, token: string, res: InteractionResponse) =>
      request<void>(
        'POST',
        `/interactions/${id}/${token}/callback`,
        res.data ? { ...res, data: noPings(res.data) } : res
      ),
    editOriginalInteraction: (appId: string, token: string, msg: MessageBody) =>
      request<DiscordMessage>('PATCH', `/webhooks/${appId}/${token}/messages/@original`, noPings(msg))
  }
}

export type DiscordRest = ReturnType<typeof discordRest>
