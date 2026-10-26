import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discordConnection } from './discordConnection'
import type { ConsoleRoute, ReplyRoutes } from './telegramConnection'
import type { GatewaySocket } from '../core/discord/gateway'
import { DISCORD_API } from '../core/discord/rest'
import { DISCORD_TEXT_MAX } from '../core/discord/format'
import type { SessionInfo } from '../core/types'

const TOKEN = 'MTIz.secret-bot-token.xyz'
const CFG = { botToken: TOKEN, guildId: '100', userId: '777', plans: true }
const SESSIONS = '300'

class FakeSocket implements GatewaySocket {
  static all: FakeSocket[] = []
  onopen: GatewaySocket['onopen'] = null
  onmessage: GatewaySocket['onmessage'] = null
  onclose: GatewaySocket['onclose'] = null
  onerror: GatewaySocket['onerror'] = null
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  send(): void {}
  close(): void {}
  push(p: { op: number; d?: unknown; s?: number; t?: string }): void {
    this.onmessage?.({ data: JSON.stringify(p) })
  }
  open(): void {
    this.push({ op: 10, d: { heartbeat_interval: 3_600_000 } })
    this.push({ op: 0, s: 1, t: 'READY', d: { session_id: 's', user: { id: '999' } } })
  }
  dispatch(t: string, d: unknown): void {
    this.push({ op: 0, s: 2, t, d })
  }
}
const ws = (): FakeSocket => FakeSocket.all.at(-1)!
const message = (channel_id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: String(Math.random()).slice(2),
  channel_id,
  guild_id: '100',
  content: 'status?',
  author: { id: '777' },
  ...over
})
const info: SessionInfo = { id: 's-1', accountId: 'acc-1', cwd: '/proj', status: 'running', title: 'proj', slackNotify: true }

beforeEach(() => {
  FakeSocket.all = []
})

/** A guild that already holds Astera/#sessions; every message post is recorded and answered with a new id. */
function rig(o: { console?: ConsoleRoute; onDispatch?: (type: string, data: unknown) => boolean } = {}) {
  const posted: Array<{ channel: string; content: string }> = []
  let next = 800
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const route = String(url).slice(DISCORD_API.length)
    const body = init?.body ? (JSON.parse(String(init.body)) as { content?: string }) : {}
    if (route === '/guilds/100/channels')
      return new Response(JSON.stringify([{ id: '200', type: 4, name: 'Astera' }, { id: SESSIONS, type: 0, name: 'sessions', parent_id: '200' }]))
    const thread = route.match(/\/messages\/(\d+)\/threads$/)
    if (thread) return new Response(JSON.stringify({ id: thread[1], type: 11 }))
    const channel = route.split('/')[2]
    posted.push({ channel, content: String(body.content) })
    return new Response(JSON.stringify({ id: String(next++), channel_id: channel, content: body.content }))
  }) as typeof fetch
  const delivered: Array<[string, string]> = []
  const written: Array<[string, string]> = []
  const routes: ReplyRoutes = {
    write: (id, data) => (written.push([id, data]), true),
    isChat: () => false,
    pendingRequest: () => null,
    deliverChat: async (id, text) => void delivered.push([id, text]),
    answerChat: async () => {}
  }
  const conn = discordConnection({
    getAccount: () => null,
    readStatusPayload: async () => null,
    lang: () => 'en',
    log: () => {},
    profileDir: '/nowhere',
    routes: () => routes,
    isQuitting: () => false,
    load: async () => CFG,
    fetchFn,
    WebSocketCtor: FakeSocket,
    ...o
  })
  return { conn, posted, delivered, written }
}

const consoleRoute = (answer: string | null, ask = vi.fn()): ConsoleRoute => ({
  ensure: async () => ({ id: 'console-1' }),
  ask: async (id, send, answered) => {
    ask(id)
    await send()
    answered(answer)
  }
})
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

describe('discordConnection', () => {
  it("opens a session's thread in #sessions and routes the owner's reply there into the session", async () => {
    const h = rig()
    await h.conn.apply(CFG)
    ws().open()
    h.conn.notifier.register(info)
    await vi.waitFor(() => expect(h.posted).toHaveLength(1))
    expect(h.posted[0]).toMatchObject({ channel: SESSIONS, content: '🖥 proj\n/proj' })
    await settle()
    const thread = '800'
    ws().dispatch('MESSAGE_CREATE', message(thread, { content: 'go on' }))
    await vi.waitFor(() => expect(h.written).toEqual([['s-1', 'go on']]))
    await h.conn.stop()
  })

  it('never delivers a reply from a user other than the configured one', async () => {
    const h = rig({ console: consoleRoute('no') })
    await h.conn.apply(CFG)
    ws().open()
    h.conn.notifier.register(info)
    await vi.waitFor(() => expect(h.posted).toHaveLength(1))
    await settle()
    ws().dispatch('MESSAGE_CREATE', message('800', { author: { id: '1' } }))
    ws().dispatch('MESSAGE_CREATE', message('42', { author: { id: '1' } }))
    await settle()
    expect(h.written).toEqual([])
    expect(h.delivered).toEqual([])
    expect(h.posted).toHaveLength(1)
    await h.conn.stop()
  })

  it('sends a message outside the session threads to the console and answers in that channel', async () => {
    const h = rig({ console: consoleRoute('x'.repeat(DISCORD_TEXT_MAX + 50)) })
    await h.conn.apply(CFG)
    ws().open()
    ws().dispatch('MESSAGE_CREATE', message('42'))
    await vi.waitFor(() => expect(h.posted).toHaveLength(1))
    expect(h.delivered).toEqual([['console-1', 'status?']])
    expect(h.posted[0].channel).toBe('42')
    expect(h.posted[0].content.length).toBeLessThanOrEqual(DISCORD_TEXT_MAX)
    expect(h.posted[0].content).toContain('cut here')
    await h.conn.stop()
  })

  it('hands INTERACTION_CREATE to onDispatch and keeps what it claims from the console', async () => {
    const ask = vi.fn()
    const seen: Array<[string, unknown]> = []
    const h = rig({ console: consoleRoute('no', ask), onDispatch: (type, data) => (seen.push([type, data]), true) })
    await h.conn.apply(CFG)
    ws().open()
    ws().dispatch('INTERACTION_CREATE', { id: 'i1', type: 3 })
    ws().dispatch('MESSAGE_CREATE', message('42'))
    await settle()
    expect(seen.map(([type]) => type)).toEqual(['READY', 'INTERACTION_CREATE', 'MESSAGE_CREATE'])
    expect(seen[1][1]).toEqual({ id: 'i1', type: 3 })
    expect(ask).not.toHaveBeenCalled()
    expect(h.posted).toEqual([])
    await h.conn.stop()
  })

  it('sends a root where rootChannel says', async () => {
    const h = rig()
    const conn = discordConnection({
      getAccount: () => null,
      readStatusPayload: async () => null,
      lang: () => 'en',
      log: () => {},
      profileDir: '/nowhere',
      routes: () => ({ write: () => true }),
      isQuitting: () => false,
      rootChannel: async (sid) => (sid === 's-1' ? '555' : null),
      fetchFn: (async (url: unknown) => {
        h.posted.push({ channel: String(url).slice(DISCORD_API.length).split('/')[2], content: '' })
        return new Response(JSON.stringify({ id: '9', channel_id: '555', content: '' }))
      }) as typeof fetch,
      WebSocketCtor: FakeSocket
    })
    await conn.apply(CFG)
    conn.notifier.register(info)
    await vi.waitFor(() => expect(h.posted[0]?.channel).toBe('555'))
    await conn.stop()
  })

  it('exposes the live REST client only while settings are applied', async () => {
    const h = rig()
    expect(h.conn.rest()).toBeNull()
    await h.conn.apply(CFG)
    expect(h.conn.rest()).not.toBeNull()
    await h.conn.stop()
    expect(h.conn.rest()).toBeNull()
  })
})
