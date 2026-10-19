// Slack thread reply intake. Receives message events over Socket Mode, keeps the ones classifyInbound
// allows, and hands each to the shared reply router (core/connections/replies.ts), which routes it to the
// matching session.
//
// Why Socket Mode: this is a desktop app on the user's PC, so it has no public URL. The Events API
// is Slack calling us, which needs a public endpoint; Socket Mode instead has the app open an
// outbound WebSocket to Slack and receive events over it — no port forwarding, tunnel or
// certificate at all.
//
// Classification lives in core/slack/inbound.ts and conversion in core/connections/input.ts (pure
// functions); this file only does the SDK wiring. The app token is never written to the log.
// Lives in core since Slack in the Host (Task 1), so the Host runs the same notifier the app does.
import { classifyInbound, type InboundMessage } from './inbound'
import { MAX_INJECT_CHARS } from '../connections/input'
import { RecentIds, ReplyRouter, type ReplyRouterDeps } from '../connections/replies'
import { botErrorReason } from './transport'
import { t } from '../i18n'

const PROCESSED_TS_LIMIT = 500 // suppresses redelivery from a failed ack — capped so it cannot grow forever

/** The first reconnect waits this long, and each failure after it doubles the wait (final review C1). A
 *  healthy socket is recycled by Slack every few hours ("disconnect" with a refresh reason), so the first
 *  wait stays short. */
export const RECONNECT_BASE_MS = 1_000
/** The longest wait between two reconnects: an outage of an hour costs at most five minutes of intake after
 *  it ends, and a Host left running for days never gives up. */
export const RECONNECT_CAP_MS = 5 * 60_000
/** The wait before the reconnect that follows `attempt` consecutive failures (0 for the first). */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_CAP_MS, RECONNECT_BASE_MS * 2 ** Math.min(Math.max(0, attempt), 30))
}
/** The options of the WebClient inside every socket-mode client, which only calls apps.connections.open
 *  (reconnect e2e). Left alone, the SDK gives it `{ retries: 100, factor: 1.3 }` with no ceiling and no
 *  timeout, so an HTTP error or a network error was retried inside start() with waits that grow past an hour:
 *  the backoff below and its cap never ran, and a stop could not end that loop, so a replaced client kept
 *  calling with the old token. With no retries of its own, start() rejects at once and every retry is ours.
 *  The timeout ends a request nobody answers, which would otherwise hold the start forever. */
export const SOCKET_WEB_CLIENT_OPTIONS: { timeout: number; retryConfig: { retries: number } } = {
  timeout: 10_000,
  retryConfig: { retries: 0 }
}
/** The start errors a retry cannot fix: the token was refused, or the app or workspace is gone. The same
 *  list as the SDK's UnrecoverableSocketModeStartError. Retrying those only hammers Slack, so the inbox
 *  stops until the config is applied again (a settings save, or the Host's slack-reload). A network error
 *  is never on this list: it is retried however long it lasts. */
const FATAL_START_ERRORS: ReadonlySet<string> = new Set([
  'not_authed',
  'invalid_auth',
  'account_inactive',
  'user_removed_from_team',
  'team_disabled'
])
function isFatalStartError(err: unknown): boolean {
  const code = (err as { data?: { error?: unknown } } | null)?.data?.error
  return typeof code === 'string' && FATAL_START_ERRORS.has(code)
}

/** What the reply router needs (core/connections/replies.ts), plus what only Slack's intake reads. */
export interface SlackInboxDeps extends ReplyRouterDeps {
  /** The channel whose replies we accept. If the bot is invited to other channels too, their events
   *  are dropped */
  channelId: string
  /** The one Slack Member ID allowed to drive sessions — anyone else's reply is dropped. Taken as a
   *  getter rather than a value, by the same convention as lang, and here it is not merely a
   *  convention: the socket is rebuilt on an appToken+channelId key (SlackInboxController), so a save
   *  that changes only this value never reconnects. Held as a value, that change would never reach the
   *  live socket. null means unconfigured, which blocks everything (classifyInbound). */
  memberId: () => string | null
  /** Is this ts a message we posted (ConnectionNotifier.isOwnMessage) — the second line of defense against
   *  an infinite loop. Even if some path leaves the bot_id check empty, a ts we wrote is filtered out. */
  isOwnMessage(ts: string): boolean
}

/** Only the surface of SocketModeClient we actually use. Kept narrow so tests can inject a fake
 *  without the SDK. */
export interface SocketClient {
  on(event: string, listener: (arg: never) => void): unknown
  start(): Promise<unknown>
  disconnect(): Promise<void>
}

/** message event payload — the SDK emits events_api as `emit(event.type, { ack, event, body })`.
 *  Without an ack() call, Slack redelivers the same event. */
interface MessageEnvelope {
  ack: () => Promise<void>
  event?: InboundMessage
}

export class SlackInbox {
  private client: SocketClient | null = null
  // If a failed ack makes Slack redeliver the same envelope, this event arrives again — remember the
  // ts we handled and skip every repeat.
  private processedTs = new RecentIds(PROCESSED_TS_LIMIT)
  private readonly router: ReplyRouter
  // Reconnection is ours, not the SDK's (final review C1). The SDK's auto-reconnect called its own start()
  // from a timer and dropped the promise, so a reconnect that failed for good (invalid_auth after a token
  // was regenerated, account_inactive, or its network retries used up) was an unhandled rejection, which
  // ends node.exe and every session the Host holds. Both SDK constructors now pass
  // `autoReconnectEnabled: false`, and every start below ends in a catch.
  private nextClient: (() => SocketClient) | null = null
  private stopped = false
  private halt = false
  private attempt = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private deps: SlackInboxDeps) {
    this.router = new ReplyRouter(deps, 'slack')
  }

  /** Opens the connection and keeps it open. A failure is only logged — even with no intake, notification
   *  sending (REST) must keep working. With `nextClient`, a drop or a failed start builds a fresh client
   *  after a backoff (reconnectDelayMs), until `stop` or a start error no retry can fix (`halted`). Never
   *  rejects. */
  async start(client: SocketClient, nextClient?: () => SocketClient): Promise<void> {
    this.stopped = false
    this.halt = false
    this.attempt = 0
    this.nextClient = nextClient ?? null
    await this.connect(client)
  }

  /** The last start was refused for good (FATAL_START_ERRORS): nothing retries until the config is applied
   *  again. */
  halted(): boolean {
    return this.halt
  }

  private log(m: string): void {
    try {
      this.deps.log(m)
    } catch {
      /* a log line never throws */
    }
  }

  private async connect(client: SocketClient): Promise<void> {
    this.client = client
    // Every listener and the start's outcome check this: a client this inbox has since stopped or replaced
    // speaks for nobody. Without it, a start that resolved after a stop kept a socket whose messages still
    // reached this inbox (the zombie of final review C1).
    const current = (): boolean => this.client === client && !this.stopped
    // R3 (Slack in the Host): a route that throws is logged here by error name only (a message could carry
    // reply text) and never escapes the socket's emit.
    client.on('message', ((env: MessageEnvelope) => {
      if (!current()) return
      this.handleMessage(env).catch((err: unknown) => {
        this.log(`slack inbound failed(${err instanceof Error ? err.name : 'unknown'})`)
      })
    }) as never)
    client.on('disconnected', (() => {
      if (!current()) return
      this.log('slack socket disconnected')
      this.scheduleRetry()
    }) as never)
    client.on('connected', (() => {
      if (!current()) return
      this.attempt = 0
      this.log('slack socket connected')
    }) as never)
    try {
      await client.start()
    } catch (err) {
      if (!current()) return // stopped or replaced while it was starting: nothing to retry
      // botErrorReason pulls only err.name, err.code and err.data?.error — err.message is never used
      // because the app token can be mixed into it (transport.ts; the docs point at invalid_auth
      // and the like as what to look for)
      const reason = botErrorReason(err)
      if (isFatalStartError(err)) {
        this.halt = true
        this.log(`slack socket start failed(${reason}): Slack refused the app token or the app, not retrying until the Slack settings are applied again`)
        return
      }
      this.log(`slack socket start failed(${reason})`)
      this.scheduleRetry()
      return
    }
    if (!current()) {
      // It opened after a stop (or after being replaced): close what it opened.
      this.closeQuietly(client)
      return
    }
    this.attempt = 0
  }

  /** One pending retry at most: a failed start both rejects and emits `disconnected`. */
  private scheduleRetry(): void {
    if (this.stopped || this.halt || this.retryTimer !== null || this.nextClient === null) return
    const ms = reconnectDelayMs(this.attempt)
    this.attempt++
    this.log(`slack socket reconnecting in ${Math.round(ms / 1000)} s (attempt ${this.attempt})`)
    const timer = setTimeout(() => {
      this.retryTimer = null
      if (this.stopped || this.halt || this.nextClient === null) return
      let next: SocketClient
      try {
        next = this.nextClient()
      } catch (err) {
        this.log(`slack socket could not be built(${botErrorReason(err)})`)
        this.scheduleRetry()
        return
      }
      this.connect(next).catch((err: unknown) => this.log(`slack socket reconnect failed(${botErrorReason(err)})`))
    }, ms)
    ;(timer as { unref?: () => void }).unref?.()
    this.retryTimer = timer
  }

  private closeQuietly(client: SocketClient): void {
    try {
      client.disconnect().catch(() => {
        /* a disconnect failure must not block anything */
      })
    } catch {
      /* the same */
    }
  }

  /** Closes the socket, and cancels a pending retry: nothing opens after a stop. */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    const client = this.client
    this.client = null
    if (!client) return
    try {
      await client.disconnect()
    } catch {
      /* a disconnect failure must not block app quit */
    }
  }

  /** Handles one event. ack is always sent first, regardless of the verdict — even a message we
   *  ignore gets redelivered forever if it is not acked. */
  private async handleMessage(env: MessageEnvelope): Promise<void> {
    try {
      await env.ack()
    } catch {
      /* a failed ack only leads to redelivery; nothing to do here — processedTs filters the repeat */
    }
    const event = env.event ?? {}
    const ts = typeof event.ts === 'string' ? event.ts : null
    // Second line of loop defense — even if some path skips the bot_id check, events arriving with a
    // ts we posted are ignored. It sits ahead of classifyInbound's bot_id check because it is an
    // independent defense that must hold whether or not bot_id is present.
    if (ts && this.deps.isOwnMessage(ts)) return
    if (ts) {
      if (this.processedTs.has(ts)) {
        this.deps.log(`slack inbound ignored(duplicate-ts) ts=${ts}`)
        return
      }
      this.processedTs.add(ts)
    }
    const decision = classifyInbound(event, this.deps.channelId, this.deps.memberId())
    if (decision.kind === 'ignore') {
      // The bot's own messages come back on every notification and would flood the log — those alone
      // are dropped quietly
      if (decision.reason !== 'bot-message') {
        // The rejected sender is appended, for not-allowed-user only. It is the entire diagnosis path
        // for that case: nothing is posted into the thread (a stranger must never make the bot answer
        // them), so the log is the only place a refused reply shows up — and when the refusal was the
        // owner's own typo, the id printed here is exactly the value to paste into the Member ID field.
        const who =
          decision.reason === 'not-allowed-user' && typeof event.user === 'string'
            ? ` user=${event.user}`
            : ''
        this.deps.log(`slack inbound ignored(${decision.reason})${who}`)
      }
      if (decision.reason === 'too-long' && decision.threadTs) {
        await this.deps.postNote(
          decision.threadTs,
          t(this.deps.lang(), 'slack.inbox.tooLong', { max: MAX_INJECT_CHARS })
        )
      }
      return
    }
    await this.router.route({ target: decision.threadTs, text: decision.text, noteTo: decision.threadTs })
  }
}

/** Pulls the target for the inbound socket (channel and app token) out of the config. All three are
 *  required for bot-mode intake — without botToken+channelId the notifier does not treat it as bot
 *  mode either (slackTransportOf in connect.ts), and without appToken Socket Mode cannot be opened at all. */
export interface InboxTarget {
  channelId: string
  appToken: string
}

export function inboxTargetFor(cfg: {
  appToken: string | null
  botToken: string | null
  channelId: string | null
}): InboxTarget | null {
  if (!cfg.appToken || !cfg.botToken || !cfg.channelId) return null
  return { channelId: cfg.channelId, appToken: cfg.appToken }
}

export interface SlackInboxControllerDeps {
  /** Once the channel is settled, builds SlackInboxDeps for that channel. memberId arrives as a getter
   *  rather than a value so a save that changes only the allowed member reaches the live socket without
   *  a reconnect — see the field of the same name on SlackInboxDeps. */
  makeDeps(channelId: string, memberId: () => string | null): SlackInboxDeps
  createClient(appToken: string): SocketClient
  /** While the app is quitting, do not open a new socket (the race where the config load promise
   *  resolves after before-quit). */
  isQuitting(): boolean
}

/**
 * Safely rebuilds the inbound socket whenever settings change.
 *
 * Before this, the socket was created once at app start and never touched again — turning bot mode
 * off (clearing the token and channel) left the socket attached to the old channel, and even though
 * ConnectionNotifier.replaceTransport emptied threadIndex, the socket itself kept receiving that channel's
 * events and kept injecting into live sessions until the next restart. Changing only the channel had
 * the same shape: notifications went to the new channel while injection still only arrived from
 * replies on the old one.
 *
 * apply calls are serialized through a queue — if the config load at startup overlaps a save from the
 * settings screen (a race), the order can invert and the newest settings get overwritten by older
 * settings that were processed first.
 *
 * Applying the same settings again (for example a save that only changes webhookUrl) does not
 * reconnect — tearing the socket down and reopening it on every save is wasteful, and it opens a
 * short window with no intake in between.
 */
export class SlackInboxController {
  private current: SlackInbox | null = null
  private currentKey: string | null = null
  private pending: Promise<void> = Promise.resolve()
  // The Member ID of the last applied config. Deliberately kept out of currentKey: this value has
  // nothing to do with the socket, so a change to it must not tear the connection down. The getter
  // handed to makeDeps reads this field, so a live socket picks the new value up on its next event.
  private memberId: string | null = null

  constructor(private deps: SlackInboxControllerDeps) {}

  apply(cfg: {
    appToken: string | null
    botToken: string | null
    channelId: string | null
    memberId: string | null
  }): Promise<void> {
    this.pending = this.pending.then(() => this.applyNow(cfg))
    return this.pending
  }

  stop(): Promise<void> {
    this.pending = this.pending.then(() => this.teardown())
    return this.pending
  }

  private async applyNow(cfg: {
    appToken: string | null
    botToken: string | null
    channelId: string | null
    memberId: string | null
  }): Promise<void> {
    // Recorded before the unchanged-key early return below. Placed after it, a save that touched only
    // the Member ID would return without ever storing the new value — which is the whole failure this
    // getter arrangement exists to avoid.
    this.memberId = cfg.memberId
    const target = inboxTargetFor(cfg)
    // A space cannot appear in either a token or a channel ID, so it is safe as a separator
    const key = target ? `${target.appToken} ${target.channelId}` : null
    // No change: do not reconnect. The one exception is an inbox that Slack refused for good (invalid_auth
    // and the like): applying the config again is what retries it (final review C1).
    if (key === this.currentKey && !(this.current?.halted() ?? false)) return
    await this.teardown()
    if (!target || this.deps.isQuitting()) return
    const inbox = new SlackInbox(this.deps.makeDeps(target.channelId, () => this.memberId))
    this.current = inbox
    this.currentKey = key
    const appToken = target.appToken
    // Not awaited: a start can sit in the SDK's network retries for as long as an outage lasts, and a stop
    // queued behind it would wait that long while the socket it should close opens. The inbox closes a
    // start that resolves after its stop, and start never rejects.
    void inbox
      .start(this.deps.createClient(appToken), () => this.deps.createClient(appToken))
      .catch(() => {
        /* start never rejects; this only keeps a surprise from becoming an unhandled rejection */
      })
  }

  private async teardown(): Promise<void> {
    const old = this.current
    this.current = null
    this.currentKey = null
    if (old) await old.stop()
  }
}
