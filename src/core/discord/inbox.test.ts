import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewaySocket } from './gateway'
import { DiscordInboxController, type DiscordInboxDeps } from './inbox'

const TOKEN = 'MTIz.secret-bot-token.xyz'
const CFG = { botToken: TOKEN, guildId: '100', userId: '777' }
const THREAD = '500'

class FakeSocket implements GatewaySocket {
  static all: FakeSocket[] = []
  onopen: GatewaySocket['onopen'] = null
  onmessage: GatewaySocket['onmessage'] = null
  onclose: GatewaySocket['onclose'] = null
  onerror: GatewaySocket['onerror'] = null
  closed = false
  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }
  send(): void {}
  close(): void {
    this.closed = true
  }
  push(p: { op: number; d?: unknown; s?: number; t?: string }): void {
    this.onmessage?.({ data: JSON.stringify(p) })
  }
  /** HELLO then READY with the bot's own id. */
  open(): void {
    this.push({ op: 10, d: { heartbeat_interval: 3_600_000 } })
    this.push({ op: 0, s: 1, t: 'READY', d: { session_id: 's', user: { id: '999' } } })
  }
  dispatch(t: string, d: unknown): void {
    this.push({ op: 0, s: 2, t, d })
  }
}
const live = (): FakeSocket => FakeSocket.all.filter((s) => !s.closed).at(-1)!
const message = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: '1',
  channel_id: THREAD,
  guild_id: '100',
  content: 'go on',
  author: { id: '777' },
  ...over
})

beforeEach(() => {
  FakeSocket.all = []
})

function rig(over: Partial<DiscordInboxDeps> = {}) {
  const logs: string[] = []
  const notes: Array<[string, string]> = []
  const written: Array<[string, string]> = []
  const makeDeps = vi.fn(() => ({
    lang: () => 'en' as const,
    log: (m: string) => logs.push(m),
    resolveSession: (id: string) => (id === THREAD ? 'sess-1' : null),
    write: (id: string, data: string) => (written.push([id, data]), true),
    postNote: async (id: string, text: string) => void notes.push([id, text]),
    isOwnMessage: (id: string) => id === '600',
    replyHint: () => 'reply in a thread',
    WebSocketCtor: FakeSocket,
    ...over
  }))
  const ctl = new DiscordInboxController({ makeDeps, isQuitting: () => false })
  return { ctl, makeDeps, logs, notes, written }
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

describe('DiscordInbox', () => {
  it("routes the owner's message in a session thread into the session", async () => {
    const h = rig()
    await h.ctl.apply(CFG)
    live().open()
    live().dispatch('MESSAGE_CREATE', message())
    await settle()
    expect(h.written).toEqual([['sess-1', 'go on']])
    await h.ctl.stop()
  })

  it('never delivers a reply from another user, or from anyone while no user id is set', async () => {
    const h = rig()
    await h.ctl.apply(CFG)
    live().open()
    live().dispatch('MESSAGE_CREATE', message({ author: { id: '123' } }))
    await settle()
    await h.ctl.apply({ ...CFG, userId: null })
    live().dispatch('MESSAGE_CREATE', message({ id: '2' }))
    await settle()
    expect(h.written).toEqual([])
    expect(h.notes).toEqual([])
    expect(h.logs).toContain('discord inbound ignored(not-allowed-user 123)')
    expect(h.logs).toContain('discord inbound ignored(user-id-unset)')
    await h.ctl.stop()
  })

  it('tells a thread of an ended session that it ended', async () => {
    const h = rig()
    await h.ctl.apply(CFG)
    live().open()
    live().dispatch('MESSAGE_CREATE', message({ channel_id: '600' }))
    await settle()
    expect(h.notes).toEqual([['600', expect.stringContaining('ended')]])
    await h.ctl.stop()
  })

  it('offers other dispatches and messages outside threads to the listener before the console', async () => {
    const seen: string[] = []
    const consoled: string[] = []
    const h = rig({
      onDispatch: (type, d) => (seen.push(type), type === 'INTERACTION_CREATE' || (d as { content?: string }).content === 'mine'),
      console: async (text) => void consoled.push(text)
    })
    await h.ctl.apply(CFG)
    live().open()
    live().dispatch('INTERACTION_CREATE', { id: 'i1' })
    live().dispatch('MESSAGE_CREATE', message({ channel_id: '42', content: 'mine' }))
    live().dispatch('MESSAGE_CREATE', message({ id: '3', channel_id: '42', content: 'status?' }))
    await settle()
    expect(seen).toEqual(['READY', 'INTERACTION_CREATE', 'MESSAGE_CREATE', 'MESSAGE_CREATE'])
    expect(consoled).toEqual(['status?'])
    await h.ctl.stop()
  })

  it('answers a message outside threads with the hint when no console is wired', async () => {
    const h = rig()
    await h.ctl.apply(CFG)
    live().open()
    live().dispatch('MESSAGE_CREATE', message({ channel_id: '42' }))
    await settle()
    expect(h.notes).toEqual([['42', 'reply in a thread']])
    await h.ctl.stop()
  })

  it('reconnects only when the token or server changes', async () => {
    const h = rig()
    await h.ctl.apply(CFG)
    await h.ctl.apply({ ...CFG, userId: '778' })
    expect(FakeSocket.all).toHaveLength(1)
    await h.ctl.apply({ ...CFG, guildId: '101' })
    expect(FakeSocket.all).toHaveLength(2)
    expect(FakeSocket.all[0].closed).toBe(true)
    await h.ctl.apply({ ...CFG, botToken: null })
    expect(FakeSocket.all.every((s) => s.closed)).toBe(true)
    await h.ctl.stop()
  })

  it('stops on a fatal close, logs it once without the token, and retries on the next apply', async () => {
    const h = rig()
    await h.ctl.apply(CFG)
    live().onclose?.({ code: 4014 })
    const stopped = h.logs.filter((l) => l.startsWith('discord gateway stopped'))
    expect(stopped).toHaveLength(1)
    expect(stopped[0]).toContain('Message Content intent')
    expect(h.logs.join('\n')).not.toContain(TOKEN)
    await h.ctl.apply(CFG)
    expect(FakeSocket.all).toHaveLength(2)
    await h.ctl.stop()
  })
})
