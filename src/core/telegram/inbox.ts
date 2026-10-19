// Telegram reply intake. Long-polls getUpdates, keeps the messages classifyInbound allows, and hands each to
// the shared reply router (core/connections/replies.ts), which routes it to the matching session.
//
// Why long polling: this is a desktop app with no public URL, so a webhook is out; getUpdates is an
// outbound request that Telegram holds open until a message arrives. Only one poller may use a token at a
// time (409 otherwise).
//
// Classification lives in inbound.ts and conversion in core/connections/input.ts (pure functions); this file
// only does the polling. The bot token is part of the request URL and never reaches a log line.
import { reconnectDelayMs } from '../connections/backoff'
import { MAX_INJECT_CHARS } from '../connections/input'
import { RecentIds, ReplyRouter, type ReplyRouterDeps } from '../connections/replies'
import { t } from '../i18n'
import { classifyInbound, type InboundMessage } from './inbound'
import { TelegramApiError, telegramCall } from './transport'

const LONG_POLL_S = 50
// Telegram answers an idle poll after LONG_POLL_S; the request timeout only has to outlast that.
const POLL_TIMEOUT_MS = (LONG_POLL_S + 15) * 1000
const PROCESSED_LIMIT = 500

export interface TelegramInboxDeps extends ReplyRouterDeps {
  botToken: string
  /** The chat whose messages we accept (the owner's private chat with the bot). */
  chatId: string
  /** The one Telegram user id allowed to drive sessions. A getter, like Slack's memberId: the poller is
   *  rebuilt on token + chat only, so a save that changes just this must still reach the live poller. null
   *  blocks everything. */
  userId: () => string | null
  /** Is this message id one we posted (ConnectionNotifier.isOwnMessage) — second line of loop defence. */
  isOwnMessage(id: string): boolean
  /** The text for a message that is not a reply; the wiring passes t('telegram.inbox.replyHint'). */
  replyHint(): string
  fetchFn?: typeof fetch
  now?: () => number
}

interface Update {
  update_id: number
  message?: InboundMessage
}

export class TelegramInbox {
  private readonly router: ReplyRouter
  private readonly processed = new RecentIds(PROCESSED_LIMIT)
  private readonly fetchFn: typeof fetch
  private offset: number | undefined
  private stopped = false
  private halt = false
  private startedAtSec = 0
  private abort: AbortController | null = null
  private wake: (() => void) | null = null
  private loop: Promise<void> = Promise.resolve()

  constructor(private deps: TelegramInboxDeps) {
    this.router = new ReplyRouter(deps, 'telegram')
    this.fetchFn = deps.fetchFn ?? fetch
  }

  /** Starts polling and returns at once. A failure is only logged — notification sending must keep working
   *  without intake. Never rejects. */
  start(): void {
    this.stopped = false
    this.halt = false
    this.startedAtSec = Math.floor((this.deps.now?.() ?? Date.now()) / 1000)
    this.loop = this.poll().catch((err: unknown) => this.log(`telegram poll crashed(${err instanceof Error ? err.name : 'unknown'})`))
  }

  /** Telegram refused the token (401/404): nothing retries until the config is applied again. */
  halted(): boolean {
    return this.halt
  }

  /** Ends a pending poll or backoff at once. Never rejects. */
  async stop(): Promise<void> {
    this.stopped = true
    this.abort?.abort()
    this.wake?.()
    await this.loop
  }

  private log(m: string): void {
    try {
      this.deps.log(m)
    } catch {
      /* a log line never throws */
    }
  }

  private async poll(): Promise<void> {
    let attempt = 0
    while (!this.stopped && !this.halt) {
      const ac = (this.abort = new AbortController())
      try {
        const updates = await telegramCall<Update[]>(
          this.fetchFn,
          this.deps.botToken,
          'getUpdates',
          { timeout: LONG_POLL_S, allowed_updates: ['message'], ...(this.offset !== undefined ? { offset: this.offset } : {}) },
          { signal: ac.signal, timeoutMs: POLL_TIMEOUT_MS }
        )
        if (this.stopped) return
        attempt = 0
        for (const u of updates) {
          this.offset = u.update_id + 1
          await this.handle(u)
        }
      } catch (err) {
        if (this.stopped) return
        const reason = err instanceof TelegramApiError ? err.reason : err instanceof Error ? err.name : 'unknown'
        if (err instanceof TelegramApiError && (err.status === 401 || err.status === 404)) {
          this.halt = true
          this.log(`telegram poll failed(${reason}): Telegram refused the bot token, not retrying until the Telegram settings are applied again`)
          return
        }
        const ms = err instanceof TelegramApiError && err.retryAfter !== null ? Math.max(err.retryAfter * 1000, reconnectDelayMs(attempt)) : reconnectDelayMs(attempt)
        this.log(
          err instanceof TelegramApiError && err.status === 409
            ? `telegram poll conflict(${reason}): another client polls this bot token, retrying in ${Math.round(ms / 1000)} s`
            : `telegram poll failed(${reason}), retrying in ${Math.round(ms / 1000)} s`
        )
        attempt++
        await this.sleep(ms)
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      ;(timer as { unref?: () => void }).unref?.()
      const self = this
      function done(): void {
        clearTimeout(timer)
        self.wake = null
        resolve()
      }
      this.wake = done
    })
  }

  /** One update. A route that throws is logged by error name only (a message could carry reply text) and
   *  never ends the poll. */
  private async handle(u: Update): Promise<void> {
    try {
      await this.handleMessage(u.message ?? {})
    } catch (err) {
      this.log(`telegram inbound failed(${err instanceof Error ? err.name : 'unknown'})`)
    }
  }

  private async handleMessage(msg: InboundMessage): Promise<void> {
    const id = typeof msg.message_id === 'number' ? String(msg.message_id) : null
    if (id && this.deps.isOwnMessage(id)) return
    if (id) {
      if (this.processed.has(id)) return
      this.processed.add(id)
    }
    const d = classifyInbound(msg, this.deps.chatId, this.deps.userId(), this.startedAtSec)
    if (d.kind === 'ignore') {
      // The bot's own echoes would flood the log; stale ones are history, not news.
      if (d.reason !== 'bot-message' && d.reason !== 'stale') this.log(`telegram inbound ignored(${d.reason})`)
      if (d.noteTo && d.reason === 'not-reply') await this.deps.postNote(d.noteTo, this.deps.replyHint())
      if (d.noteTo && d.reason === 'too-long') {
        await this.deps.postNote(d.noteTo, t(this.deps.lang(), 'slack.inbox.tooLong', { max: MAX_INJECT_CHARS }))
      }
      return
    }
    await this.router.route({ target: d.replyTo, text: d.text, noteTo: d.replyTo })
  }
}

export interface TelegramInboxControllerDeps {
  /** Builds the inbox's deps once token and chat are settled; the user id arrives as a getter (see
   *  TelegramInboxDeps.userId). */
  makeDeps(userId: () => string | null): Omit<TelegramInboxDeps, 'botToken' | 'chatId' | 'userId'>
  /** While the app is quitting, do not start a poller. */
  isQuitting(): boolean
}

/** Rebuilds the poller when the settings change: only a new token or chat restarts it (a save of the user id
 *  alone must not open a gap in intake). apply calls are serialised so an older save can never overwrite a
 *  newer one; turning the config off or changing it stops the old poller first. */
export class TelegramInboxController {
  private current: TelegramInbox | null = null
  private currentKey: string | null = null
  private pending: Promise<void> = Promise.resolve()
  // Kept out of currentKey on purpose: it has nothing to do with the poll, and the getter handed to
  // makeDeps reads this field. Recorded before the unchanged-key return, or such a save would never land.
  private userId: string | null = null

  constructor(private deps: TelegramInboxControllerDeps) {}

  apply(cfg: { botToken: string | null; chatId: string | null; userId: string | null }): Promise<void> {
    this.pending = this.pending.then(() => this.applyNow(cfg))
    return this.pending
  }

  stop(): Promise<void> {
    this.pending = this.pending.then(() => this.teardown())
    return this.pending
  }

  private async applyNow(cfg: { botToken: string | null; chatId: string | null; userId: string | null }): Promise<void> {
    this.userId = cfg.userId
    // A space cannot appear in a token or a chat id, so it is safe as a separator
    const key = cfg.botToken && cfg.chatId ? `${cfg.botToken} ${cfg.chatId}` : null
    // Unchanged: no restart — except for a poller Telegram refused for good, which applying again retries.
    if (key === this.currentKey && !(this.current?.halted() ?? false)) return
    await this.teardown()
    if (!key || this.deps.isQuitting()) return
    const inbox = new TelegramInbox({
      ...this.deps.makeDeps(() => this.userId),
      botToken: cfg.botToken!,
      chatId: cfg.chatId!,
      userId: () => this.userId
    })
    this.current = inbox
    this.currentKey = key
    inbox.start()
  }

  private async teardown(): Promise<void> {
    const old = this.current
    this.current = null
    this.currentKey = null
    if (old) await old.stop()
  }
}
