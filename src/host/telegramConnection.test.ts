import { describe, expect, it, vi } from 'vitest'
import { telegramConnection, type ConsoleRoute, type ReplyRoutes } from './telegramConnection'
import { TELEGRAM_TEXT_MAX } from '../core/telegram/format'

const CFG = { botToken: '123:TOKEN', chatId: '42', userId: '777' }
const nowSec = (): number => Math.floor(Date.now() / 1000)

const msg = (id: number, over: Record<string, unknown> = {}): unknown => ({
  update_id: id,
  message: { message_id: id, date: nowSec() + 5, text: 'status?', chat: { id: 42 }, from: { id: 777, is_bot: false }, ...over }
})

/** One getUpdates answer carrying `updates`, then an idle poll; every sendMessage is recorded. */
function rig(updates: unknown[], console?: ConsoleRoute) {
  const sent: Array<Record<string, unknown>> = []
  let polled = false
  let sentId = 900
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (String(url).endsWith('/getUpdates')) {
      if (!polled) {
        polled = true
        return new Response(JSON.stringify({ ok: true, result: updates }))
      }
      return new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))))
    }
    sent.push(body)
    return new Response(JSON.stringify({ ok: true, result: { message_id: sentId++ } }))
  }) as typeof fetch
  const delivered: Array<[string, string]> = []
  const written: Array<[string, string]> = []
  const routes: ReplyRoutes = {
    write: (id, data) => (written.push([id, data]), true),
    isChat: () => true,
    pendingRequest: () => null,
    deliverChat: async (id, text) => void delivered.push([id, text]),
    answerChat: async () => {}
  }
  const conn = telegramConnection({
    getAccount: () => null,
    readStatusPayload: async () => null,
    lang: () => 'en',
    log: () => {},
    profileDir: '/nowhere',
    routes: () => routes,
    isQuitting: () => false,
    load: async () => CFG,
    fetchFn,
    ...(console ? { console } : {})
  })
  return { conn, sent, delivered, written }
}

const consoleRoute = (answer: string | null, ask = vi.fn()): ConsoleRoute => ({
  ensure: async () => ({ id: 'console-1' }),
  ask: async (id, send, answered) => {
    ask(id)
    await send()
    answered(answer)
  }
})

describe('telegramConnection: where an owner message goes', () => {
  it('sends a message that is not a reply to the console and posts its answer back to the chat', async () => {
    const h = rig([msg(100)], consoleRoute('all quiet'))
    await h.conn.apply(CFG)
    await vi.waitFor(() => expect(h.sent).toHaveLength(1))
    expect(h.delivered).toEqual([['console-1', 'status?']])
    expect(h.sent[0]).toMatchObject({ chat_id: '42', text: 'all quiet' })
    await h.conn.stop()
  })

  it('cuts an answer over the Telegram limit and says so', async () => {
    const h = rig([msg(100)], consoleRoute('x'.repeat(TELEGRAM_TEXT_MAX + 500)))
    await h.conn.apply(CFG)
    await vi.waitFor(() => expect(h.sent).toHaveLength(1))
    const text = String(h.sent[0].text)
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX)
    expect(text).toContain('cut here')
    await h.conn.stop()
  })

  it('keeps a reply to a bot message on its session route, not the console', async () => {
    const ask = vi.fn()
    const h = rig([msg(100, { reply_to_message: { message_id: 5 } })], consoleRoute('no', ask))
    await h.conn.apply(CFG)
    await new Promise((r) => setTimeout(r, 50))
    expect(ask).not.toHaveBeenCalled()
    expect(h.delivered).toEqual([])
    await h.conn.stop()
  })

  it('refuses a message from another chat or user', async () => {
    const ask = vi.fn()
    const h = rig([msg(100, { chat: { id: 43 } }), msg(101, { from: { id: 1, is_bot: false } })], consoleRoute('no', ask))
    await h.conn.apply(CFG)
    await new Promise((r) => setTimeout(r, 50))
    expect(ask).not.toHaveBeenCalled()
    expect(h.delivered).toEqual([])
    expect(h.sent).toEqual([])
    await h.conn.stop()
  })
})
