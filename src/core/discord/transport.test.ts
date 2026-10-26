import { describe, expect, it } from 'vitest'
import { ConnectionPostError } from '../connections/transport'
import { DISCORD_API, discordRest } from './rest'
import { DiscordTransport } from './transport'

const TOKEN = 'MTIz.secret-bot-token.xyz'
const GUILD = '100000000000000001'

interface Call {
  method: string
  route: string
  body: Record<string, unknown> | undefined
}

/** A REST client over a fetch that answers by route; `channels` is what the guild holds. */
function rig(channels: Array<Record<string, unknown>> = [], fail: Record<string, number> = {}) {
  const calls: Call[] = []
  let next = 200000000000000000n
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const route = String(url).slice(DISCORD_API.length)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, route, body })
    const status = fail[`${method} ${route}`]
    if (status) return new Response(JSON.stringify({ code: 10003, message: `has ${TOKEN}` }), { status })
    const id = String(next++)
    if (method === 'GET' && route === `/guilds/${GUILD}/channels`) return new Response(JSON.stringify(channels))
    if (method === 'POST' && route === `/guilds/${GUILD}/channels`) {
      channels.push({ id, ...body })
      return new Response(JSON.stringify({ id, ...body }))
    }
    const thread = route.match(/^\/channels\/(\d+)\/messages\/(\d+)\/threads$/)
    if (thread) return new Response(JSON.stringify({ id: thread[2], type: 11 }))
    return new Response(JSON.stringify({ id, channel_id: route.split('/')[2], content: body?.content }))
  }) as typeof fetch
  return { rest: discordRest({ token: TOKEN, fetchFn, sleep: async () => {} }), calls, channels }
}

const posts = (calls: Call[]): Call[] => calls.filter((c) => c.method === 'POST' && c.route.endsWith('/messages'))

describe('DiscordTransport', () => {
  it('creates the Astera category and #sessions once, then starts a thread from a session root', async () => {
    const { rest, calls, channels } = rig()
    const t = new DiscordTransport(rest, GUILD)
    const root = await t.post('🖥 *build* · work\n/repo', undefined, { sessionId: 's1' })
    const category = channels.find((c) => c.type === 4)!
    const sessions = channels.find((c) => c.type === 0)!
    const creates = calls.filter((c) => c.route === `/guilds/${GUILD}/channels` && c.method === 'POST')
    expect(creates.map((c) => c.body)).toEqual([
      { name: 'Astera', type: 4 },
      { name: 'sessions', type: 0, parent_id: category.id }
    ])
    const [rootPost] = posts(calls)
    expect(rootPost.route).toBe(`/channels/${sessions.id}/messages`)
    expect(rootPost.body?.content).toBe('🖥 **build** · work\n/repo')
    const start = calls.find((c) => c.route.endsWith('/threads'))!
    expect(start.route).toBe(`/channels/${sessions.id}/messages/${root}/threads`)
    expect(start.body).toEqual({ name: '🖥 *build* · work', auto_archive_duration: 10080 })

    await t.post('🖥 other\n/x', undefined, { sessionId: 's2' })
    expect(calls.filter((c) => c.route === `/guilds/${GUILD}/channels`)).toHaveLength(3) // one lookup, two creates
  })

  it('reuses an existing #sessions under the Astera category, looked up by name', async () => {
    const { rest, calls } = rig([
      { id: '300000000000000001', type: 4, name: 'astera' },
      { id: '300000000000000002', type: 0, name: 'sessions', parent_id: '999' },
      { id: '300000000000000003', type: 0, name: 'sessions', parent_id: '300000000000000001' }
    ])
    await new DiscordTransport(rest, GUILD).post('hi', undefined, { sessionId: 's1' })
    expect(calls.filter((c) => c.method === 'POST' && c.route.startsWith('/guilds'))).toEqual([])
    expect(posts(calls)[0].route).toBe('/channels/300000000000000003/messages')
  })

  it('posts a thread message into the thread channel, and a notice without starting a thread', async () => {
    const { rest, calls } = rig([
      { id: '300000000000000001', type: 4, name: 'Astera' },
      { id: '300000000000000003', type: 0, name: 'sessions', parent_id: '300000000000000001' }
    ])
    const t = new DiscordTransport(rest, GUILD)
    await t.post('done', '400000000000000009')
    await t.post('notice')
    expect(posts(calls).map((c) => c.route)).toEqual(['/channels/400000000000000009/messages', '/channels/300000000000000003/messages'])
    expect(calls.some((c) => c.route.endsWith('/threads'))).toBe(false)
  })

  it('sends a root where the resolver says, given the session id; null keeps the default', async () => {
    const { rest, calls } = rig([
      { id: '300000000000000001', type: 4, name: 'Astera' },
      { id: '300000000000000003', type: 0, name: 'sessions', parent_id: '300000000000000001' }
    ])
    const seen: Array<string | undefined> = []
    const t = new DiscordTransport(rest, GUILD, async (sid) => (seen.push(sid), sid === 'plan' ? '500000000000000005' : null))
    await t.post('a', undefined, { sessionId: 'plan' })
    await t.post('b', undefined, { sessionId: 'other' })
    expect(seen).toEqual(['plan', 'other'])
    expect(posts(calls).map((c) => c.route)).toEqual(['/channels/500000000000000005/messages', '/channels/300000000000000003/messages'])
  })

  it('looks #sessions up again once Discord says the kept one is gone', async () => {
    const chans = [
      { id: '300000000000000001', type: 4, name: 'Astera' },
      { id: '300000000000000003', type: 0, name: 'sessions', parent_id: '300000000000000001' }
    ]
    const { rest, calls } = rig(chans, { 'POST /channels/300000000000000003/messages': 404 })
    const t = new DiscordTransport(rest, GUILD)
    await expect(t.post('a')).rejects.toBeInstanceOf(ConnectionPostError)
    chans[1] = { id: '300000000000000004', type: 0, name: 'sessions', parent_id: '300000000000000001' }
    await t.post('b')
    expect(posts(calls).at(-1)!.route).toBe('/channels/300000000000000004/messages')
  })

  it('fails with a reason that never holds the token', async () => {
    const { rest } = rig([], { [`GET /guilds/${GUILD}/channels`]: 403 })
    const err = await new DiscordTransport(rest, GUILD).post('a').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConnectionPostError)
    expect((err as ConnectionPostError).reason).toBe('status=403 code=10003')
    expect(String((err as Error).message)).not.toContain(TOKEN)
  })
})
