import { describe, expect, it } from 'vitest'
import { DISCORD_TEXT_MAX, channelSlug, toDiscordText } from './format'

describe('toDiscordText', () => {
  it('turns *bold* into **bold** at word edges only', () => {
    expect(toDiscordText('*Done* in 2*3*4 and a_b')).toBe('**Done** in 2*3*4 and a_b')
  })

  it('keeps italics, quotes and code as they are', () => {
    expect(toDiscordText('> _quiet_ `*x*`')).toBe('> _quiet_ `*x*`')
    expect(toDiscordText('```\n*not bold*\n```')).toBe('```\n*not bold*\n```')
  })

  it('turns <url|label> into a masked link and <url> into the bare url', () => {
    expect(toDiscordText('see <https://x.dev/a|the plan> or <https://x.dev/b>')).toBe(
      'see [the plan](https://x.dev/a) or https://x.dev/b'
    )
  })

  it('cuts to the max with an ellipsis', () => {
    const out = toDiscordText('a'.repeat(3000))
    expect(out.length).toBe(DISCORD_TEXT_MAX)
    expect(out.endsWith('…')).toBe(true)
    expect(toDiscordText('a'.repeat(DISCORD_TEXT_MAX))).toBe('a'.repeat(DISCORD_TEXT_MAX))
  })

  it('never cuts an emoji in half', () => {
    const out = toDiscordText('a'.repeat(DISCORD_TEXT_MAX - 2) + '😀'.repeat(10))
    expect(out.length).toBeLessThanOrEqual(DISCORD_TEXT_MAX)
    expect(out).not.toMatch(/[\uD800-\uDBFF]…$/)
  })
})

describe('channelSlug', () => {
  it('lowercases and joins words with -', () => {
    expect(channelSlug('  Discord Core   Client ')).toBe('discord-core-client')
    expect(channelSlug('W7-C: fix_the  thing!')).toBe('w7-c-fix-the-thing')
  })

  it('drops accents, emoji and other scripts', () => {
    expect(channelSlug('Café 🚀 plan')).toBe('cafe-plan')
    expect(channelSlug('🚀🔥')).toBe('plan')
    expect(channelSlug('한국어 계획')).toBe('plan')
    expect(channelSlug('한국어 v2')).toBe('v2')
  })

  it('is never empty', () => {
    expect(channelSlug('')).toBe('plan')
    expect(channelSlug('---')).toBe('plan')
  })

  it('caps at 100 characters without a trailing -', () => {
    expect(channelSlug('a'.repeat(150))).toBe('a'.repeat(100))
    const s = channelSlug(`${'a'.repeat(99)} b`)
    expect(s).toBe('a'.repeat(99))
    expect(s.length).toBeLessThanOrEqual(100)
  })
})
