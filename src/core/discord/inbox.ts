// Discord reply intake, mirroring core/telegram/inbox.ts. One Gateway connection (gateway.ts) per profile: its
// MESSAGE_CREATE events go through classifyInbound, and an allowed reply in a session thread goes to the shared
// reply router (core/connections/replies.ts), which routes it to the matching session. Every dispatch this
// file does not consume (an interaction, the owner's message outside a session thread, the guild events) is
// offered to one extra listener first, so the plan workspace rides this same Gateway.
//
// Classification lives in inbound.ts and conversion in core/connections/input.ts (pure functions); this file
// only drives the Gateway. The bot token goes into IDENTIFY only and never reaches a log line.
import { MAX_INJECT_CHARS } from '../connections/input'
import { ReplyRouter, type ReplyRouterDeps } from '../connections/replies'
import { t } from '../i18n'
import { DiscordGateway, type GatewaySocketCtor, type GatewayState } from './gateway'
import { classifyInbound, type InboundMessage } from './inbound'

export interface DiscordInboxDeps extends ReplyRouterDeps {
  botToken: string
  /** The server whose messages we accept. */
  guildId: string
  /** The one Discord user id allowed to drive sessions. A getter, like Telegram's: the Gateway is rebuilt on
   *  token + server only, so a save that changes just this must still reach the live one. null blocks everything. */
  userId: () => string | null
  /** Is this message id one we posted (ConnectionNotifier.isOwnMessage) — second line of loop defence. A
   *  thread's id is its root's, so it also tells a session thread whose session has ended. */
  isOwnMessage(id: string): boolean
  /** The text for a message outside a session thread when no console is wired (t('discord.inbox.replyHint')). */
  replyHint(): string
  /** The owner's message outside every session thread, sent to the Astera console, whose answer the wiring
   *  posts back in `channelId`. Absent, the owner gets the reply hint instead. */
  console?(text: string, channelId: string): Promise<void>
  /** Every dispatch this inbox does not consume; true means it was handled (no console, no hint). */
  onDispatch?(type: string, data: unknown): boolean
  WebSocketCtor?: GatewaySocketCtor
}

const idOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export class DiscordInbox {
  private readonly router: ReplyRouter
  private readonly gateway: DiscordGateway
  private halt = false
  /** Messages are handled one at a time, in the order Discord sent them. */
  private chain: Promise<void> = Promise.resolve()

  constructor(private deps: DiscordInboxDeps) {
    this.router = new ReplyRouter(deps, 'discord')
    this.gateway = new DiscordGateway({
      token: deps.botToken,
      onDispatch: (type, data) => this.onDispatch(type, data),
      onState: (state, reason) => this.onState(state, reason),
      ...(deps.WebSocketCtor ? { WebSocketCtor: deps.WebSocketCtor } : {})
    })
  }

  /** Connects and returns at once. A failure is only logged — sending must keep working without intake. */
  start(): void {
    this.halt = false
    void this.gateway.start()
  }

  /** The Gateway stopped for good (a bad token, an intent the bot may not use): nothing retries until the
   *  config is applied again. */
  halted(): boolean {
    return this.halt
  }

  /** Closes the Gateway and waits for the message in hand. Never rejects. */
  async stop(): Promise<void> {
    await this.gateway.stop()
    await this.chain
  }

  private log(m: string): void {
    try {
      this.deps.log(m)
    } catch {
      /* a log line never throws */
    }
  }

  private onState(state: GatewayState, reason: string | undefined): void {
    if (state === 'failed') {
      this.halt = true
      this.log(`discord gateway stopped (${reason ?? 'unknown'}): not retrying until the Discord settings are applied again`)
    } else if (state === 'reconnecting') this.log(`discord gateway reconnecting (${reason ?? 'unknown'})`)
  }

  private onDispatch(type: string, data: unknown): void {
    if (type !== 'MESSAGE_CREATE') {
      this.offer(type, data)
      return
    }
    // A route that throws is logged by error name only (a message could carry reply text) and never ends intake.
    this.chain = this.chain
      .then(() => this.handleMessage(data))
      .catch((err: unknown) => this.log(`discord inbound failed(${err instanceof Error ? err.name : 'unknown'})`))
  }

  /** Hands a dispatch to the extra listener; whether it took it. */
  private offer(type: string, data: unknown): boolean {
    try {
      return this.deps.onDispatch?.(type, data) === true
    } catch (err) {
      this.log(`discord dispatch listener failed(${err instanceof Error ? err.name : 'unknown'}) type=${type}`)
      return false
    }
  }

  private async handleMessage(data: unknown): Promise<void> {
    const msg = (data ?? {}) as InboundMessage
    const id = idOf(msg.id)
    if (id && this.deps.isOwnMessage(id)) return
    const isSessionThread = (ch: string): boolean => this.deps.resolveSession(ch) !== null || this.deps.isOwnMessage(ch)
    const d = classifyInbound(msg, this.deps.guildId, this.deps.userId(), this.gateway.botUserId, isSessionThread)
    if (d.kind === 'ignore') {
      // The bot's own echoes would flood the log.
      if (d.reason === 'not-allowed-user') this.log(`discord inbound ignored(not-allowed-user ${d.userId})`)
      else if (d.reason !== 'bot-message' && d.reason !== 'own-message') this.log(`discord inbound ignored(${d.reason})`)
      if (d.noteTo && d.reason === 'too-long') {
        await this.deps.postNote(d.noteTo, t(this.deps.lang(), 'slack.inbox.tooLong', { max: MAX_INJECT_CHARS }))
      }
      return
    }
    if (d.kind === 'other') {
      if (this.offer('MESSAGE_CREATE', data)) return
      if (this.deps.console) await this.deps.console(d.text, d.channelId)
      else await this.deps.postNote(d.channelId, this.deps.replyHint())
      return
    }
    await this.router.route({ target: d.target, text: d.text, noteTo: d.target })
  }
}

export interface DiscordInboxControllerDeps {
  /** Builds the inbox's deps once token and server are settled; the user id arrives as a getter. */
  makeDeps(userId: () => string | null): Omit<DiscordInboxDeps, 'botToken' | 'guildId' | 'userId'>
  /** While the app is quitting, do not connect. */
  isQuitting(): boolean
}

/** Rebuilds the Gateway when the settings change: only a new token or server reconnects (a save of the user
 *  id alone must not open a gap in intake). apply calls are serialised so an older save can never overwrite a
 *  newer one; turning the config off or changing it closes the old Gateway first. */
export class DiscordInboxController {
  private current: DiscordInbox | null = null
  private currentKey: string | null = null
  private pending: Promise<void> = Promise.resolve()
  // Kept out of currentKey on purpose (Telegram's reason): the getter handed to makeDeps reads this field.
  private userId: string | null = null

  constructor(private deps: DiscordInboxControllerDeps) {}

  apply(cfg: { botToken: string | null; guildId: string | null; userId: string | null }): Promise<void> {
    this.pending = this.pending.then(() => this.applyNow(cfg))
    return this.pending
  }

  stop(): Promise<void> {
    this.pending = this.pending.then(() => this.teardown())
    return this.pending
  }

  private async applyNow(cfg: { botToken: string | null; guildId: string | null; userId: string | null }): Promise<void> {
    this.userId = cfg.userId
    // A space cannot appear in a token or a server id, so it is safe as a separator
    const key = cfg.botToken && cfg.guildId ? `${cfg.botToken} ${cfg.guildId}` : null
    // Unchanged: no reconnect — except for a Gateway Discord refused for good, which applying again retries.
    if (key === this.currentKey && !(this.current?.halted() ?? false)) return
    await this.teardown()
    if (!key || this.deps.isQuitting()) return
    const inbox = new DiscordInbox({
      ...this.deps.makeDeps(() => this.userId),
      botToken: cfg.botToken!,
      guildId: cfg.guildId!,
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
