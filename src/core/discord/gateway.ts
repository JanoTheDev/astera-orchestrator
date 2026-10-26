// The Discord Gateway (v10, JSON) over the global WebSocket: identify, heartbeat, resume and reconnect, and
// nothing about what the events mean — every dispatch goes to one onDispatch callback. It never logs, and
// the bot token is only ever sent inside IDENTIFY/RESUME: no state reason or error carries it. Fatal close
// codes (a bad token, intents the bot may not use) stop it with a reason instead of reconnecting forever.
import { reconnectDelayMs } from '../connections/backoff'

export const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json'
const GATEWAY_QUERY = '?v=10&encoding=json'

/** GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT. */
export const GATEWAY_INTENTS = (1 << 0) | (1 << 9) | (1 << 15)

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11
} as const

/** Close codes after which reconnecting cannot help: the owner has to change something first. */
const FATAL_CLOSE: Record<number, string> = {
  4004: 'authentication failed: the bot token is wrong',
  4010: 'invalid shard',
  4011: 'sharding required',
  4012: 'invalid API version',
  4013: 'invalid intents',
  4014: 'intents not allowed: turn on the Message Content intent for the bot in the developer portal'
}
/** Close codes after which the session cannot be resumed: identify again. */
const NEW_SESSION_CLOSE = new Set([4007, 4009])
/** Our own close code for a connection we drop but want to resume (not 1000/1001, which end the session). */
const RESUME_CLOSE = 4000

export type GatewayState = 'connecting' | 'ready' | 'reconnecting' | 'stopped' | 'failed'

/** The part of the WebSocket API the Gateway uses, so tests can inject a fake. */
export interface GatewaySocket {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
  onerror: ((ev: unknown) => void) | null
  send(data: string): void
  close(code?: number): void
}
export type GatewaySocketCtor = new (url: string) => GatewaySocket

export interface DiscordGatewayOptions {
  token: string
  onDispatch: (type: string, data: unknown) => void
  onState?: (state: GatewayState, reason?: string) => void
  WebSocketCtor?: GatewaySocketCtor
  /** In [0, 1): the jitter of the first heartbeat. */
  random?: () => number
}

interface Payload {
  op: number
  d?: unknown
  s?: number | null
  t?: string | null
}

export class DiscordGateway {
  private ws: GatewaySocket | null = null
  private running = false
  private seq: number | null = null
  private sessionId: string | null = null
  private resumeUrl: string | null = null
  private acked = true
  private attempt = 0
  private firstBeat: ReturnType<typeof setTimeout> | null = null
  private beats: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** The bot's own user id, from READY. */
  botUserId: string | null = null

  constructor(private readonly opts: DiscordGatewayOptions) {}

  /** Connects; resolves at once (READY arrives through onState). Never rejects. */
  async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.connect()
  }

  /** Closes the connection and ends every timer. Never rejects. */
  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false
    this.teardown(1000)
    this.emit('stopped')
  }

  private emit(state: GatewayState, reason?: string): void {
    try {
      this.opts.onState?.(state, reason)
    } catch {
      /* a throwing listener must not break the connection */
    }
  }

  private connect(): void {
    this.reconnectTimer = null
    const resuming = this.sessionId !== null && this.seq !== null
    const url = resuming && this.resumeUrl ? `${this.resumeUrl.replace(/\/?(\?.*)?$/, '')}/${GATEWAY_QUERY}` : GATEWAY_URL
    const Ctor = this.opts.WebSocketCtor ?? (globalThis as { WebSocket?: GatewaySocketCtor }).WebSocket
    if (!Ctor) return this.fail('no WebSocket in this runtime')
    this.emit('connecting')
    let ws: GatewaySocket
    try {
      ws = new Ctor(url)
    } catch {
      return this.reconnect('connect failed')
    }
    this.ws = ws
    this.acked = true
    ws.onmessage = (ev) => this.onMessage(ev.data)
    ws.onclose = (ev) => this.onClose(ev.code)
    ws.onerror = () => {
      /* a close event follows */
    }
  }

  private onMessage(data: unknown): void {
    let p: Payload
    try {
      p = JSON.parse(String(data)) as Payload
    } catch {
      return
    }
    if (typeof p.s === 'number') this.seq = p.s
    switch (p.op) {
      case OP.HELLO:
        return this.onHello((p.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval)
      case OP.HEARTBEAT_ACK:
        this.acked = true
        return
      case OP.HEARTBEAT:
        return this.send({ op: OP.HEARTBEAT, d: this.seq })
      case OP.RECONNECT:
        return this.reconnect('reconnect requested')
      case OP.INVALID_SESSION:
        if (p.d !== true) this.forgetSession()
        return this.reconnect('invalid session')
      case OP.DISPATCH:
        return this.onDispatch(p.t ?? '', p.d)
    }
  }

  private onHello(interval: number | undefined): void {
    if (typeof interval !== 'number' || interval <= 0) return this.reconnect('bad hello')
    this.clearHeartbeat()
    const rand = this.opts.random ?? Math.random
    this.firstBeat = setTimeout(() => {
      this.firstBeat = null
      this.beat()
      this.beats = setInterval(() => this.beat(), interval)
    }, Math.floor(interval * rand()))
    if (this.sessionId !== null && this.seq !== null) {
      this.send({ op: OP.RESUME, d: { token: this.opts.token, session_id: this.sessionId, seq: this.seq } })
    } else {
      this.send({
        op: OP.IDENTIFY,
        d: {
          token: this.opts.token,
          intents: GATEWAY_INTENTS,
          properties: { os: process.platform, browser: 'astera', device: 'astera' }
        }
      })
    }
  }

  private beat(): void {
    // no ACK since the last beat: the connection is a zombie — drop it and resume
    if (!this.acked) return this.reconnect('heartbeat not acknowledged')
    this.acked = false
    this.send({ op: OP.HEARTBEAT, d: this.seq })
  }

  private onDispatch(type: string, data: unknown): void {
    if (type === 'READY') {
      const d = data as { session_id?: string; resume_gateway_url?: string; user?: { id?: string } }
      this.sessionId = d.session_id ?? null
      this.resumeUrl = d.resume_gateway_url ?? null
      this.botUserId = d.user?.id ?? null
    }
    if (type === 'READY' || type === 'RESUMED') {
      this.attempt = 0
      this.emit('ready')
    }
    try {
      this.opts.onDispatch(type, data)
    } catch {
      /* a throwing consumer must not break the connection */
    }
  }

  private onClose(code: number): void {
    if (!this.running) return
    const fatal = FATAL_CLOSE[code]
    if (fatal) return this.fail(`${fatal} (close ${code})`)
    if (NEW_SESSION_CLOSE.has(code)) this.forgetSession()
    this.reconnect(`closed ${code}`)
  }

  private send(p: Payload): void {
    try {
      this.ws?.send(JSON.stringify(p))
    } catch {
      /* the socket is closing; its close event drives the reconnect */
    }
  }

  private forgetSession(): void {
    this.sessionId = null
    this.resumeUrl = null
    this.seq = null
  }

  private clearHeartbeat(): void {
    if (this.firstBeat) clearTimeout(this.firstBeat)
    if (this.beats) clearInterval(this.beats)
    this.firstBeat = null
    this.beats = null
  }

  /** Detaches and closes the socket and ends every timer. */
  private teardown(code: number): void {
    this.clearHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const ws = this.ws
    this.ws = null
    if (!ws) return
    ws.onmessage = ws.onclose = ws.onerror = ws.onopen = null
    try {
      ws.close(code)
    } catch {
      /* already closed */
    }
  }

  /** Drops the connection (keeping the session for a resume) and connects again after the backoff. */
  private reconnect(reason: string): void {
    if (!this.running) return
    this.teardown(RESUME_CLOSE)
    this.emit('reconnecting', reason)
    this.reconnectTimer = setTimeout(() => this.connect(), reconnectDelayMs(this.attempt++))
  }

  private fail(reason: string): void {
    this.running = false
    this.teardown(1000)
    this.emit('failed', reason)
  }
}
