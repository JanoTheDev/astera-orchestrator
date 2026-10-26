import { describe, expect, it } from 'vitest'
import { discordMissing, discordRepliesBlocked, isDiscordReady } from './ready'

describe('discord ready', () => {
  it('needs both the bot token and the server', () => {
    expect(isDiscordReady({ botToken: 't', guildId: 'g', userId: null })).toBe(true)
    expect(discordMissing({ botToken: 't', guildId: null, userId: 'u' })).toEqual(['guildId'])
    expect(discordMissing({ botToken: null, guildId: 'g', userId: 'u' })).toEqual(['botToken'])
    expect(discordMissing({ botToken: '', guildId: '', userId: '' })).toEqual(['botToken', 'guildId'])
    expect(isDiscordReady({ botToken: null, guildId: 'g', userId: 'u' })).toBe(false)
  })

  it('blocks replies without an allowed user, never allows everyone', () => {
    expect(discordRepliesBlocked({ botToken: 't', guildId: 'g', userId: null })).toBe(true)
    expect(discordRepliesBlocked({ botToken: 't', guildId: 'g', userId: '' })).toBe(true)
    expect(discordRepliesBlocked({ botToken: 't', guildId: 'g', userId: '123' })).toBe(false)
  })
})
