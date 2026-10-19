import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { TelegramConfigStore } from './telegramConfigStore'
import type { TelegramConfig } from '../core/telegram/config'

const cfg = (over: Partial<TelegramConfig> = {}): TelegramConfig => ({
  botToken: null,
  chatId: null,
  userId: null,
  ...over
})
const tmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'astera-tgstore-'))

describe('TelegramConfigStore', () => {
  it('round-trips, normalises blanks to null, and tolerates a missing or corrupt file', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'telegram.json')
    const store = new TelegramConfigStore(file)
    expect(await store.load()).toEqual(cfg())
    await store.save(cfg({ botToken: '1:a', chatId: '7', userId: '7' }))
    expect(await store.load()).toEqual(cfg({ botToken: '1:a', chatId: '7', userId: '7' }))
    expect(await store.save(cfg({ botToken: '  ', chatId: ' 9 ' }))).toEqual(cfg({ chatId: '9' }))
    await fs.writeFile(file, '{broken', 'utf8')
    expect(await store.load()).toEqual(cfg())
  })

  it('patch keeps unsent fields and clears fields sent as null', async () => {
    const dir = await tmp()
    const store = new TelegramConfigStore(path.join(dir, 'telegram.json'))
    await store.save(cfg({ botToken: '1:a', chatId: '7', userId: '7' }))
    expect(await store.patch({ chatId: '8' })).toEqual(cfg({ botToken: '1:a', chatId: '8', userId: '7' }))
    expect(await store.patch({ botToken: null })).toEqual(cfg({ chatId: '8', userId: '7' }))
    expect(await store.patch({})).toEqual(cfg({ chatId: '8', userId: '7' }))
  })

  it('patch on a missing file merges over the empty defaults', async () => {
    const dir = await tmp()
    const store = new TelegramConfigStore(path.join(dir, 'none.json'))
    expect(await store.patch({ chatId: '5' })).toEqual(cfg({ chatId: '5' }))
  })

  it('patch may overwrite a corrupt file: that damage does not heal, and nothing is lost', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'telegram.json')
    await fs.writeFile(file, '{broken', 'utf8')
    const store = new TelegramConfigStore(file)
    expect(await store.patch({ chatId: '5' })).toEqual(cfg({ chatId: '5' }))
    expect(await store.load()).toEqual(cfg({ chatId: '5' }))
  })

  // Only readFile fails (not the path), so save() would succeed — the refusal is what protects the token.
  it('patch refuses to merge over an unreadable file and leaves it untouched', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'telegram.json')
    const store = new TelegramConfigStore(file)
    await store.save(cfg({ botToken: '1:a', chatId: '7' }))
    const onDisk = await fs.readFile(file, 'utf8')

    const spy = vi
      .spyOn(fs, 'readFile')
      .mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    try {
      await expect(store.patch({ userId: '7' })).rejects.toThrow(/telegram\.json/)
      expect(await store.load()).toEqual(cfg()) // load() stays forgiving
    } finally {
      spy.mockRestore()
    }
    expect(await fs.readFile(file, 'utf8')).toBe(onDisk)
  })
})
