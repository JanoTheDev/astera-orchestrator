import { describe, expect, it } from 'vitest'
import { isTelegramReady } from './ready'

describe('isTelegramReady', () => {
  it('needs both the bot token and the chat', () => {
    expect(isTelegramReady({ botToken: '1:abc', chatId: '42' })).toBe(true)
    expect(isTelegramReady({ botToken: '1:abc', chatId: null })).toBe(false)
    expect(isTelegramReady({ botToken: null, chatId: '42' })).toBe(false)
    expect(isTelegramReady({ botToken: '', chatId: '' })).toBe(false)
  })
})
