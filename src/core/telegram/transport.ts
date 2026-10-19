// Owns the Telegram Bot API protocol only: core/connections/notifier.ts holds the notification content and
// the session concepts; this file knows "where the text goes and how". The bot token is part of the request
// URL, so no URL, fetch error message or response body ever reaches a log or an error — only status codes,
// Telegram's numeric error_code and a short description with the token cut out of it.
import { ConnectionPostError, type ConnectionTransport } from '../connections/transport'
import { splitForTelegram } from './format'

const API = 'https://api.telegram.org'
const REQUEST_TIMEOUT_MS = 10_000

/** A Bot API call that failed. `reason` is safe to log. */
export class TelegramApiError extends Error {
  constructor(
    readonly reason: string,
    /** The HTTP status, or 0 when the request never got an answer. */
    readonly status: number,
    /** Telegram's description, token removed and cut short; empty when it gave none. */
    readonly description: string,
    /** Seconds Telegram asks us to wait (429), or null. */
    readonly retryAfter: number | null
  ) {
    super(`telegram ${reason}`)
    this.name = 'TelegramApiError'
  }
}

export interface CallOptions {
  /** Ends the call at once (a pending long poll on stop). */
  signal?: AbortSignal
  timeoutMs?: number
}

/** One Bot API method call; resolves to its `result`. Never exposes the token (see the header). */
export async function telegramCall<T>(
  fetchFn: typeof fetch,
  token: string,
  method: string,
  params: Record<string, unknown>,
  opts: CallOptions = {}
): Promise<T> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const onAbort = (): void => ac.abort()
  if (opts.signal?.aborted) ac.abort()
  else opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    let res: Response
    try {
      res = await fetchFn(`${API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: ac.signal
      })
    } catch (err) {
      // err.message can carry the URL, which holds the token — keep only the name
      throw new TelegramApiError(err instanceof Error ? err.name : 'unknown', 0, '', null)
    }
    let body: {
      ok?: boolean
      result?: T
      error_code?: number
      description?: string
      parameters?: { retry_after?: number }
    } = {}
    try {
      body = (await res.json()) as typeof body
    } catch {
      /* an HTML error page from a proxy: the status alone describes it */
    }
    if (res.ok && body.ok !== false) return body.result as T
    const description = typeof body.description === 'string' ? body.description.split(token).join('').slice(0, 80) : ''
    const retryAfter = typeof body.parameters?.retry_after === 'number' ? body.parameters.retry_after : null
    const parts = [`status=${res.status}`]
    if (typeof body.error_code === 'number') parts.push(`code=${body.error_code}`)
    if (retryAfter !== null) parts.push(`retry_after=${retryAfter}`)
    if (description) parts.push(`"${description}"`)
    throw new TelegramApiError(parts.join(' '), res.status, description, retryAfter)
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** A 400 about entities or markup — the one failure a plain-text retry can cure. */
function isParseError(err: TelegramApiError): boolean {
  return err.status === 400 && /parse|entit/i.test(err.description)
}

/** Posts into the owner's chat with the bot. Every message after the root is a reply to it, which is what
 *  Telegram shows as a thread; the stringified message id is the notifier's thread id. */
export class TelegramTransport implements ConnectionTransport {
  readonly supportsThreads = true

  constructor(
    private token: string,
    private chatId: string,
    private fetchFn: typeof fetch
  ) {}

  async post(text: string, threadId?: string): Promise<string | null> {
    let first: string | null = null
    for (const chunk of splitForTelegram(text)) {
      const replyTo = threadId ?? first
      const base = {
        chat_id: this.chatId,
        ...(replyTo ? { reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true } } : {})
      }
      const id = await this.send({ ...base, text: chunk.html, parse_mode: 'HTML' }, { ...base, text: chunk.plain })
      first ??= id
    }
    return first
  }

  private async send(html: Record<string, unknown>, plain: Record<string, unknown>): Promise<string> {
    try {
      return await this.sendMessage(html)
    } catch (err) {
      // A notice must never be lost to formatting: one retry without parse_mode.
      if (err instanceof TelegramApiError && isParseError(err)) {
        try {
          return await this.sendMessage(plain)
        } catch (retryErr) {
          throw this.postError(retryErr)
        }
      }
      throw this.postError(err)
    }
  }

  private async sendMessage(params: Record<string, unknown>): Promise<string> {
    const sent = await telegramCall<{ message_id?: number }>(this.fetchFn, this.token, 'sendMessage', params)
    if (typeof sent?.message_id !== 'number') throw new TelegramApiError('no message_id', 200, '', null)
    return String(sent.message_id)
  }

  private postError(err: unknown): ConnectionPostError {
    return new ConnectionPostError(err instanceof TelegramApiError ? err.reason : err instanceof Error ? err.name : 'unknown')
  }
}
