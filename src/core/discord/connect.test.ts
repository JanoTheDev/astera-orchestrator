import { describe, expect, it } from 'vitest'
import { discordTransportOf } from './connect'
import { DISCORD_API } from './rest'
import { DiscordTransport } from './transport'

const CFG = { botToken: 'MTIz.tok', guildId: '100', userId: null }

describe('discordTransportOf', () => {
  it('builds a threaded transport and names the server as the channel', () => {
    const r = discordTransportOf(CFG)
    expect(r.transport).toBeInstanceOf(DiscordTransport)
    expect(r.transport?.supportsThreads).toBe(true)
    expect(r.channel).toBe('100')
    expect(r.rest).not.toBeNull()
  })

  it('selects nothing when the token or the server is missing', () => {
    const none = { transport: null, channel: null, rest: null }
    expect(discordTransportOf({ ...CFG, botToken: null })).toEqual(none)
    expect(discordTransportOf({ ...CFG, guildId: null })).toEqual(none)
  })

  it('posts through the injected fetch, where the resolver says', async () => {
    const urls: string[] = []
    const fetchFn = (async (url: unknown) => {
      urls.push(String(url))
      return new Response(JSON.stringify({ id: '7', channel_id: '55', content: '' }))
    }) as typeof fetch
    const { transport } = discordTransportOf(CFG, { fetchFn, rootChannel: async () => '55' })
    expect(await transport?.post('hi')).toBe('7')
    expect(urls).toEqual([`${DISCORD_API}/channels/55/messages`])
  })
})
