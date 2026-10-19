import { describe, expect, it } from 'vitest'
import { telegramTransportOf } from './connect'
import { TelegramTransport } from './transport'

describe('telegramTransportOf', () => {
  it('builds a threaded transport and names the chat as the channel', () => {
    const r = telegramTransportOf({ botToken: '1:abc', chatId: '42' })
    expect(r.transport).toBeInstanceOf(TelegramTransport)
    expect(r.transport?.supportsThreads).toBe(true)
    expect(r.channel).toBe('42')
  })

  it('selects no transport when the token or the chat is missing', () => {
    expect(telegramTransportOf({ botToken: null, chatId: '42' })).toEqual({ transport: null, channel: null })
    expect(telegramTransportOf({ botToken: '1:abc', chatId: '' })).toEqual({ transport: null, channel: null })
  })

  it('posts through the injected fetch', async () => {
    const urls: string[] = []
    const fetchFn = (async (url: unknown) => {
      urls.push(String(url))
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 })
    }) as typeof fetch
    const { transport } = telegramTransportOf({ botToken: '1:abc', chatId: '42' }, fetchFn)
    expect(await transport?.post('hi')).toBe('7')
    expect(urls).toEqual(['https://api.telegram.org/bot1:abc/sendMessage'])
  })
})
