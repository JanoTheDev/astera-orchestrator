import { describe, expect, it, vi } from 'vitest'
import { ConnectionPostError } from '../connections/transport'
import { DISCORD_API, DiscordApiError, discordRest } from './rest'

const TOKEN = 'MTIz.secret-bot-token.xyz'

interface Call {
  url: string
  init: RequestInit
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

/** A client over a scripted fetch, with a clock that the injected sleep advances. */
function setup(responses: Array<Response | Error>) {
  const calls: Call[] = []
  let clock = 1_000_000
  const sleeps: number[] = []
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = responses.shift()
    if (!next) throw new Error('no scripted response')
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  const rest = discordRest({
    token: TOKEN,
    fetchFn,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    }
  })
  return { rest, calls, sleeps }
}

const bodyOf = (c: Call): unknown => JSON.parse(String(c.init.body))
const headersOf = (c: Call): Record<string, string> => c.init.headers as Record<string, string>

describe('discordRest', () => {
  it('sends JSON with the bot authorization to API v10', async () => {
    const { rest, calls } = setup([json(200, { id: '1', username: 'astera', bot: true })])
    expect(await rest.me()).toEqual({ id: '1', username: 'astera', bot: true })
    expect(calls[0].url).toBe(`${DISCORD_API}/users/@me`)
    expect(calls[0].init.method).toBe('GET')
    expect(headersOf(calls[0]).Authorization).toBe(`Bot ${TOKEN}`)
    expect(calls[0].init.body).toBeUndefined()
  })

  it('posts never ping anyone unless the caller says so', async () => {
    const { rest, calls } = setup([
      json(200, { id: 'm1', channel_id: 'c', content: '' }),
      json(200, { id: 'm1', channel_id: 'c', content: '' }),
      json(204, null),
      json(200, { id: 'm2', channel_id: 'c', content: '' }),
      json(200, { id: 'm3', channel_id: 'c', content: '' })
    ])
    await rest.postMessage('111111111111111111', { content: '@everyone hi' })
    await rest.editMessage('111111111111111111', '222222222222222222', { content: 'x' })
    await rest.interactionCallback('333', 'itok', { type: 4, data: { content: 'y' } })
    await rest.editOriginalInteraction('444', 'itok', { content: 'z' })
    await rest.postMessage('111111111111111111', { content: 'hi', allowed_mentions: { parse: ['users'] } })
    expect(bodyOf(calls[0])).toEqual({ content: '@everyone hi', allowed_mentions: { parse: [] } })
    expect(bodyOf(calls[1])).toMatchObject({ allowed_mentions: { parse: [] } })
    expect(bodyOf(calls[2])).toEqual({ type: 4, data: { content: 'y', allowed_mentions: { parse: [] } } })
    expect(bodyOf(calls[3])).toMatchObject({ allowed_mentions: { parse: [] } })
    expect(bodyOf(calls[4])).toMatchObject({ allowed_mentions: { parse: ['users'] } })
    expect(calls[2].url).toBe(`${DISCORD_API}/interactions/333/itok/callback`)
    expect(calls[3].url).toBe(`${DISCORD_API}/webhooks/444/itok/messages/@original`)
  })

  it('hits the documented routes', async () => {
    const { rest, calls } = setup(Array.from({ length: 9 }, () => json(200, {})))
    await rest.application()
    await rest.guildChannels('g')
    await rest.createChannel('g', { name: 'plan', type: 0, parent_id: 'cat' }, { reason: 'plan created' })
    await rest.editChannel('c', { topic: 't' })
    await rest.deleteChannel('c')
    await rest.pinMessage('c', 'm')
    await rest.startThread('c', 'm', { name: 'n', auto_archive_duration: 1440 })
    await rest.startThreadWithoutMessage('c', { name: 'n', type: 11 })
    await rest.bulkOverwriteGuildCommands('a', 'g', [{ name: 'plan' }])
    expect(calls.map((c) => `${c.init.method} ${c.url.slice(DISCORD_API.length)}`)).toEqual([
      'GET /applications/@me',
      'GET /guilds/g/channels',
      'POST /guilds/g/channels',
      'PATCH /channels/c',
      'DELETE /channels/c',
      'PUT /channels/c/pins/m',
      'POST /channels/c/messages/m/threads',
      'POST /channels/c/threads',
      'PUT /applications/a/guilds/g/commands'
    ])
    expect(headersOf(calls[2])['X-Audit-Log-Reason']).toBe('plan%20created')
    expect(bodyOf(calls[8])).toEqual([{ name: 'plan' }])
  })

  it('a 204 resolves to undefined', async () => {
    const { rest } = setup([json(204, null)])
    expect(await rest.pinMessage('c', 'm')).toBeUndefined()
  })

  it('waits retry_after on 429 and retries', async () => {
    const { rest, calls, sleeps } = setup([
      json(429, { retry_after: 1.5, global: false }),
      json(200, { id: '1', username: 'a' })
    ])
    expect((await rest.me()).id).toBe('1')
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([1500])
  })

  it('falls back to the Retry-After header', async () => {
    const { rest, sleeps } = setup([json(429, {}, { 'Retry-After': '2' }), json(200, {})])
    await rest.me()
    expect(sleeps).toEqual([2000])
  })

  it('gives up after 3 retries', async () => {
    const { rest, calls } = setup(Array.from({ length: 5 }, () => json(429, { retry_after: 0.1 })))
    await expect(rest.me()).rejects.toMatchObject({ name: 'DiscordApiError', status: 429 })
    expect(calls).toHaveLength(4)
  })

  it('never waits more than 60 s in total', async () => {
    const { rest, calls, sleeps } = setup([
      json(429, { retry_after: 40 }),
      json(429, { retry_after: 30 }),
      json(200, {})
    ])
    await expect(rest.me()).rejects.toMatchObject({ status: 429 })
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([40_000])
  })

  it('waits for an exhausted bucket before the next call to it, not to another bucket', async () => {
    const exhausted = { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '2.5' }
    const { rest, sleeps } = setup([
      json(200, { id: 'm1' }, exhausted),
      json(200, { id: 'x' }),
      json(200, { id: 'm2' })
    ])
    await rest.postMessage('111111111111111111', { content: 'a' })
    await rest.me()
    expect(sleeps).toEqual([])
    await rest.postMessage('111111111111111111', { content: 'b' })
    expect(sleeps).toEqual([2500])
  })

  it('edits of different messages in one channel share a bucket', async () => {
    const exhausted = { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '1' }
    const { rest, sleeps } = setup([json(200, {}, exhausted), json(200, {})])
    await rest.editMessage('111111111111111111', '222222222222222222', { content: 'a' })
    await rest.editMessage('111111111111111111', '333333333333333333', { content: 'b' })
    expect(sleeps).toEqual([1000])
  })

  it('an API error carries the status and Discord code only', async () => {
    const { rest } = setup([json(403, { code: 50013, message: `Missing Permissions ${TOKEN}` })])
    const err = (await rest.postMessage('c', { content: 'x' }).catch((e: unknown) => e)) as DiscordApiError
    expect(err).toBeInstanceOf(DiscordApiError)
    expect(err).toBeInstanceOf(ConnectionPostError)
    expect(err.status).toBe(403)
    expect(err.code).toBe(50013)
    expect(err.reason).toBe('status=403 code=50013')
  })

  it('an unparseable error body still gives the status', async () => {
    const { rest } = setup([new Response('<html>bad gateway</html>', { status: 502 })])
    await expect(rest.me()).rejects.toMatchObject({ status: 502, code: null })
  })

  it('never puts the token in an error or a log line', async () => {
    const logs = vi.spyOn(console, 'log')
    const warns = vi.spyOn(console, 'warn')
    const errors = vi.spyOn(console, 'error')
    try {
      const { rest } = setup([
        new TypeError(`fetch failed for Bot ${TOKEN}`),
        json(401, { code: 0, message: `401: Unauthorized ${TOKEN}` })
      ])
      const failures = [
        await rest.me().catch((e: unknown) => e),
        await rest.me().catch((e: unknown) => e)
      ] as DiscordApiError[]
      expect(failures[0]).toMatchObject({ status: 0, code: null })
      for (const e of failures) {
        expect(e).toBeInstanceOf(DiscordApiError)
        expect(JSON.stringify({ ...e, message: e.message, stack: e.stack, cause: String(e.cause) })).not.toContain(
          TOKEN
        )
      }
      const logged = [...logs.mock.calls, ...warns.mock.calls, ...errors.mock.calls].flat().map(String).join('\n')
      expect(logged).not.toContain(TOKEN)
    } finally {
      logs.mockRestore()
      warns.mockRestore()
      errors.mockRestore()
    }
  })
})
