import { describe, expect, it } from 'vitest'
import { ConnectionPostError } from '../connections/transport'
import { TELEGRAM_TEXT_MAX } from './format'
import { TelegramApiError, telegramCall, TelegramTransport } from './transport'

const TOKEN = '123456:SECRET-token_value'

interface Sent {
  url: string
  body: Record<string, unknown>
}

function fake(replies: Array<Response | Error | ((b: Record<string, unknown>) => Response)>): { fetchFn: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = []
  let i = 0
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    sent.push({ url: String(url), body })
    const r = replies[Math.min(i++, replies.length - 1)]
    if (r instanceof Error) throw r
    return typeof r === 'function' ? r(body) : r
  }) as typeof fetch
  return { fetchFn, sent }
}

const ok = (id: number): Response => new Response(JSON.stringify({ ok: true, result: { message_id: id } }), { status: 200 })
const fail = (status: number, extra: object = {}): Response =>
  new Response(JSON.stringify({ ok: false, error_code: status, ...extra }), { status })

describe('TelegramTransport', () => {
  it('posts a root as HTML and returns the stringified message id', async () => {
    const { fetchFn, sent } = fake([ok(11)])
    const id = await new TelegramTransport(TOKEN, '42', fetchFn).post('*hi* <x>')
    expect(id).toBe('11')
    expect(sent[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(sent[0].body).toEqual({ chat_id: '42', text: '<b>hi</b> &lt;x&gt;', parse_mode: 'HTML' })
  })

  it('replies to the thread root', async () => {
    const { fetchFn, sent } = fake([ok(12)])
    await new TelegramTransport(TOKEN, '42', fetchFn).post('turn done', '11')
    expect(sent[0].body.reply_parameters).toEqual({ message_id: 11, allow_sending_without_reply: true })
  })

  it('splits text over 4096 into replies to the same thread, returning the first id', async () => {
    const { fetchFn, sent } = fake([(b) => ok(100 + sent.length), (b) => ok(100 + sent.length)])
    const text = Array.from({ length: 400 }, (_, i) => `line ${i} ${'z'.repeat(30)}`).join('\n')
    const id = await new TelegramTransport(TOKEN, '42', fetchFn).post(text, '11')
    expect(sent.length).toBeGreaterThan(1)
    for (const s of sent) {
      expect((s.body.text as string).length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX)
      expect(s.body.reply_parameters).toEqual({ message_id: 11, allow_sending_without_reply: true })
    }
    expect(id).toBe('101')
  })

  it('replies later chunks of a split root to the first chunk', async () => {
    const { fetchFn, sent } = fake([ok(50), ok(51), ok(52)])
    await new TelegramTransport(TOKEN, '42', fetchFn).post('x'.repeat(5000))
    expect(sent[0].body.reply_parameters).toBeUndefined()
    expect(sent[1].body.reply_parameters).toEqual({ message_id: 50, allow_sending_without_reply: true })
  })

  it('retries once as plain text when Telegram rejects the HTML (400 parse error)', async () => {
    const { fetchFn, sent } = fake([
      fail(400, { description: "Bad Request: can't parse entities: Unsupported start tag" }),
      ok(9)
    ])
    const id = await new TelegramTransport(TOKEN, '42', fetchFn).post('*hi* <x>')
    expect(id).toBe('9')
    expect(sent).toHaveLength(2)
    expect(sent[1].body.parse_mode).toBeUndefined()
    expect(sent[1].body.text).toBe('*hi* <x>')
  })

  it('does not retry a 400 that is not a parse error', async () => {
    const { fetchFn, sent } = fake([fail(400, { description: 'Bad Request: chat not found' })])
    await expect(new TelegramTransport(TOKEN, '42', fetchFn).post('hi')).rejects.toMatchObject({
      reason: 'status=400 code=400 "Bad Request: chat not found"'
    })
    expect(sent).toHaveLength(1)
  })

  it('fails with the retry_after reason on 429 and does not loop', async () => {
    const { fetchFn, sent } = fake([fail(429, { description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } })])
    const err = await new TelegramTransport(TOKEN, '42', fetchFn).post('hi').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConnectionPostError)
    expect((err as ConnectionPostError).reason).toContain('retry_after=7')
    expect(sent).toHaveLength(1)
  })

  it('never puts the token in a thrown reason: network error, description, plain-text retry failure', async () => {
    const leaky = new Error(`request to https://api.telegram.org/bot${TOKEN}/sendMessage failed`)
    leaky.name = 'FetchError'
    for (const replies of [
      [leaky],
      [fail(401, { description: `Unauthorized ${TOKEN}` })],
      [fail(400, { description: `can't parse entities ${TOKEN}` }), fail(500, { description: TOKEN })]
    ]) {
      const { fetchFn } = fake(replies)
      const err = (await new TelegramTransport(TOKEN, '42', fetchFn).post('hi').catch((e: unknown) => e)) as ConnectionPostError
      expect(err).toBeInstanceOf(ConnectionPostError)
      expect(err.reason).not.toContain(TOKEN)
      expect(err.reason).not.toContain('SECRET')
      expect(err.message).not.toContain('SECRET')
    }
  })

  it('reports a non-JSON error response by status alone', async () => {
    const { fetchFn } = fake([new Response('<html>Bad Gateway</html>', { status: 502 })])
    await expect(new TelegramTransport(TOKEN, '42', fetchFn).post('hi')).rejects.toMatchObject({ reason: 'status=502' })
  })
})

describe('telegramCall', () => {
  it('aborts a request nobody answers after the timeout', async () => {
    const fetchFn = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })))
      })) as typeof fetch
    const err = await telegramCall(fetchFn, TOKEN, 'getMe', {}, { timeoutMs: 20 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TelegramApiError)
    expect((err as TelegramApiError).reason).toBe('AbortError')
  })
})
