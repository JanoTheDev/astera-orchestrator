import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { TelegramConfigReader, EMPTY_TELEGRAM_CONFIG } from './config'

const tmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'astera-tgcfg-'))

describe('TelegramConfigReader', () => {
  it('a missing file gives the empty config', async () => {
    const dir = await tmp()
    expect(await new TelegramConfigReader(path.join(dir, 'telegram.json')).load()).toEqual(
      EMPTY_TELEGRAM_CONFIG
    )
  })

  it('a corrupt file gives the empty config', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'telegram.json')
    await fs.writeFile(file, '{broken', 'utf8')
    expect(await new TelegramConfigReader(file).load()).toEqual(EMPTY_TELEGRAM_CONFIG)
  })

  it('reads and trims stored values; blank or non-string values become null', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'telegram.json')
    await fs.writeFile(file, JSON.stringify({ botToken: ' 123:abc ', chatId: '  ', userId: 42 }), 'utf8')
    expect(await new TelegramConfigReader(file).load()).toEqual({
      botToken: '123:abc',
      chatId: null,
      userId: null
    })
  })

  it('a transient read error falls back to the empty config in load()', async () => {
    const spy = vi
      .spyOn(fs, 'readFile')
      .mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    try {
      expect(await new TelegramConfigReader('x/telegram.json').load()).toEqual(EMPTY_TELEGRAM_CONFIG)
    } finally {
      spy.mockRestore()
    }
  })
})
