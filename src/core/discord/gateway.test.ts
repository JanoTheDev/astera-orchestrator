import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscordGateway, GATEWAY_INTENTS, GATEWAY_URL, type GatewaySocket, type GatewayState } from './gateway'

const TOKEN = 'MTIz.secret-bot-token.xyz'

class FakeSocket implements GatewaySocket {
  static all: FakeSocket[] = []
  onopen: GatewaySocket['onopen'] = null
  onmessage: GatewaySocket['onmessage'] = null
  onclose: GatewaySocket['onclose'] = null
  onerror: GatewaySocket['onerror'] = null
  sent: Array<{ op: number; d?: unknown }> = []
  closedWith: number | null = null
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000
  }
  // server side
  push(p: { op: number; d?: unknown; s?: number; t?: string }): void {
    this.onmessage?.({ data: JSON.stringify(p) })
  }
  serverClose(code: number): void {
    this.onclose?.({ code })
  }
  ops(): number[] {
    return this.sent.map((p) => p.op)
  }
}

const last = (): FakeSocket => FakeSocket.all[FakeSocket.all.length - 1]
const hello = (ws: FakeSocket, interval = 40_000): void => ws.push({ op: 10, d: { heartbeat_interval: interval } })
const ready = (ws: FakeSocket, s = 1): void =>
  ws.push({
    op: 0,
    s,
    t: 'READY',
    d: { session_id: 'sess', resume_gateway_url: 'wss://resume.discord.gg', user: { id: 'bot1' } }
  })

function setup() {
  const states: Array<[GatewayState, string | undefined]> = []
  const dispatches: Array<[string, unknown]> = []
  const gw = new DiscordGateway({
    token: TOKEN,
    WebSocketCtor: FakeSocket,
    random: () => 0.5,
    onDispatch: (t, d) => dispatches.push([t, d]),
    onState: (s, r) => states.push([s, r])
  })
  return { gw, states, dispatches }
}

beforeEach(() => {
  FakeSocket.all = []
  vi.useFakeTimers()
})
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

describe('DiscordGateway', () => {
  it('identifies after HELLO with the three intents and keeps READY', async () => {
    const { gw, states, dispatches } = setup()
    await gw.start()
    expect(last().url).toBe(GATEWAY_URL)
    hello(last())
    expect(last().sent[0]).toMatchObject({
      op: 2,
      d: { token: TOKEN, intents: (1 << 0) | (1 << 9) | (1 << 15) }
    })
    expect(GATEWAY_INTENTS).toBe(33281)
    ready(last())
    expect(gw.botUserId).toBe('bot1')
    expect(states.map((s) => s[0])).toEqual(['connecting', 'ready'])
    expect(dispatches[0][0]).toBe('READY')
    last().push({ op: 0, s: 2, t: 'MESSAGE_CREATE', d: { content: 'hi' } })
    expect(dispatches[1]).toEqual(['MESSAGE_CREATE', { content: 'hi' }])
    await gw.stop()
    expect(states[states.length - 1][0]).toBe('stopped')
  })

  it('heartbeats with jitter first, then at the interval with the last sequence', async () => {
    const { gw } = setup()
    await gw.start()
    const ws = last()
    hello(ws, 40_000)
    ready(ws, 5)
    vi.advanceTimersByTime(19_999)
    expect(ws.ops()).toEqual([2])
    vi.advanceTimersByTime(1)
    expect(ws.sent[1]).toEqual({ op: 1, d: 5 })
    ws.push({ op: 11 })
    vi.advanceTimersByTime(40_000)
    expect(ws.ops()).toEqual([2, 1, 1])
    ws.push({ op: 11 })
    ws.push({ op: 1 }) // the server asks for a beat now
    expect(ws.ops()).toEqual([2, 1, 1, 1])
    await gw.stop()
  })

  it('a missing ACK is a zombie: closes 4000 and resumes on the resume url', async () => {
    const { gw, states } = setup()
    await gw.start()
    const ws = last()
    hello(ws, 40_000)
    ready(ws, 7)
    vi.advanceTimersByTime(20_000) // first beat, never acked
    vi.advanceTimersByTime(40_000)
    expect(ws.closedWith).toBe(4000)
    expect(states[states.length - 1]).toEqual(['reconnecting', 'heartbeat not acknowledged'])
    vi.advanceTimersByTime(1_000) // reconnectDelayMs(0)
    const next = last()
    expect(next).not.toBe(ws)
    expect(next.url).toBe('wss://resume.discord.gg/?v=10&encoding=json')
    hello(next)
    expect(next.sent[0]).toEqual({ op: 6, d: { token: TOKEN, session_id: 'sess', seq: 7 } })
    next.push({ op: 0, s: 8, t: 'RESUMED', d: {} })
    expect(states[states.length - 1][0]).toBe('ready')
    await gw.stop()
  })

  it('RECONNECT (op 7) resumes', async () => {
    const { gw } = setup()
    await gw.start()
    hello(last())
    ready(last(), 3)
    last().push({ op: 7 })
    vi.advanceTimersByTime(1_000)
    hello(last())
    expect(last().sent[0].op).toBe(6)
    await gw.stop()
  })

  it('INVALID_SESSION resumes when resumable and identifies anew when not', async () => {
    const { gw } = setup()
    await gw.start()
    hello(last())
    ready(last(), 3)
    last().push({ op: 9, d: true })
    vi.advanceTimersByTime(1_000)
    hello(last())
    expect(last().sent[0].op).toBe(6)
    last().push({ op: 9, d: false })
    vi.advanceTimersByTime(2_000) // second consecutive failure waits twice as long
    expect(last().url).toBe(GATEWAY_URL)
    hello(last())
    expect(last().sent[0].op).toBe(2)
    await gw.stop()
  })

  it('backs off on repeated closes and resets the backoff after READY', async () => {
    const { gw } = setup()
    await gw.start()
    last().serverClose(1006)
    vi.advanceTimersByTime(999)
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(2)
    last().serverClose(1006)
    vi.advanceTimersByTime(1_999)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(3)
    hello(last())
    ready(last())
    last().serverClose(1006)
    vi.advanceTimersByTime(1_000)
    expect(FakeSocket.all).toHaveLength(4)
    await gw.stop()
  })

  it('close 4007/4009 identifies anew', async () => {
    const { gw } = setup()
    await gw.start()
    hello(last())
    ready(last())
    last().serverClose(4009)
    vi.advanceTimersByTime(1_000)
    expect(last().url).toBe(GATEWAY_URL)
    hello(last())
    expect(last().sent[0].op).toBe(2)
    await gw.stop()
  })

  it.each([4004, 4013, 4014])('fatal close %i stops with a reason instead of looping', async (code) => {
    const { gw, states } = setup()
    await gw.start()
    hello(last())
    last().serverClose(code)
    const [state, reason] = states[states.length - 1]
    expect(state).toBe('failed')
    expect(reason).toContain(String(code))
    vi.advanceTimersByTime(10 * 60_000)
    expect(FakeSocket.all).toHaveLength(1)
    await gw.stop() // already stopped: a no-op
  })

  it('names the Message Content intent on 4014', async () => {
    const { gw, states } = setup()
    await gw.start()
    last().serverClose(4014)
    expect(states[states.length - 1][1]).toMatch(/Message Content intent/)
    await gw.stop()
  })

  it('stop ends every timer and ignores the late close event', async () => {
    const { gw, states } = setup()
    await gw.start()
    const ws = last()
    hello(ws)
    await gw.stop()
    expect(ws.closedWith).toBe(1000)
    ws.serverClose(1000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(states[states.length - 1][0]).toBe('stopped')
  })

  it('stop during a pending reconnect cancels it', async () => {
    const { gw } = setup()
    await gw.start()
    last().serverClose(1006)
    await gw.stop()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('start and stop never reject, even when the socket cannot be built', async () => {
    const states: GatewayState[] = []
    const gw = new DiscordGateway({
      token: TOKEN,
      WebSocketCtor: class {
        constructor() {
          throw new Error(`bad url with ${TOKEN}`)
        }
      } as never,
      onDispatch: () => {
        throw new Error('consumer bug')
      },
      onState: (s) => states.push(s)
    })
    await expect(gw.start()).resolves.toBeUndefined()
    expect(states).toContain('reconnecting')
    await expect(gw.stop()).resolves.toBeUndefined()
  })

  it('a throwing onDispatch does not break the connection', async () => {
    const gw = new DiscordGateway({
      token: TOKEN,
      WebSocketCtor: FakeSocket,
      onDispatch: () => {
        throw new Error('consumer bug')
      }
    })
    await gw.start()
    hello(last())
    ready(last())
    expect(gw.botUserId).toBe('bot1')
    await gw.stop()
  })

  it('never puts the token in a state reason or a log line', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')]
    try {
      const { gw, states } = setup()
      await gw.start()
      hello(last())
      ready(last())
      last().push({ op: 9, d: false })
      vi.advanceTimersByTime(1_000)
      hello(last())
      last().serverClose(4004)
      await gw.stop()
      const text = [JSON.stringify(states), ...spies.flatMap((s) => s.mock.calls.flat().map(String))].join('\n')
      expect(text).not.toContain(TOKEN)
    } finally {
      for (const s of spies) s.mockRestore()
    }
  })
})
