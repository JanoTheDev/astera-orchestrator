import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DiscordConfigStore } from './discordConfigStore'
import type { DiscordConfig } from '../core/discord/config'

const cfg = (over: Partial<DiscordConfig> = {}): DiscordConfig => ({
  botToken: null,
  guildId: null,
  userId: null,
  plans: true,
  ...over
})
const tmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'astera-dcstore-'))

describe('DiscordConfigStore', () => {
  it('round-trips, normalises blanks to null, and tolerates a missing or corrupt file', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'discord.json')
    const store = new DiscordConfigStore(file)
    expect(await store.load()).toEqual(cfg())
    await store.save(cfg({ botToken: 't', guildId: '1', userId: '2', plans: false }))
    expect(await store.load()).toEqual(cfg({ botToken: 't', guildId: '1', userId: '2', plans: false }))
    expect(await store.save(cfg({ botToken: '  ', guildId: ' 9 ' }))).toEqual(cfg({ guildId: '9' }))
    await fs.writeFile(file, '{broken', 'utf8')
    expect(await store.load()).toEqual(cfg())
  })

  it('patch keeps unsent fields and clears fields sent as null', async () => {
    const dir = await tmp()
    const store = new DiscordConfigStore(path.join(dir, 'discord.json'))
    await store.save(cfg({ botToken: 't', guildId: '1', userId: '2' }))
    expect(await store.patch({ guildId: '8' })).toEqual(cfg({ botToken: 't', guildId: '8', userId: '2' }))
    expect(await store.patch({ botToken: null, plans: false })).toEqual(cfg({ guildId: '8', userId: '2', plans: false }))
    expect(await store.patch({})).toEqual(cfg({ guildId: '8', userId: '2', plans: false }))
  })

  it('patch on a missing file merges over the empty defaults', async () => {
    const dir = await tmp()
    const store = new DiscordConfigStore(path.join(dir, 'none.json'))
    expect(await store.patch({ guildId: '5' })).toEqual(cfg({ guildId: '5' }))
  })

  it('patch may overwrite a corrupt file: that damage does not heal, and nothing is lost', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'discord.json')
    await fs.writeFile(file, '{broken', 'utf8')
    const store = new DiscordConfigStore(file)
    expect(await store.patch({ guildId: '5' })).toEqual(cfg({ guildId: '5' }))
  })

  // Only readFile fails (not the path), so save() would succeed — the refusal is what protects the token.
  it('patch refuses to merge over an unreadable file and leaves it untouched', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'discord.json')
    const store = new DiscordConfigStore(file)
    await store.save(cfg({ botToken: 't', guildId: '1' }))
    const onDisk = await fs.readFile(file, 'utf8')
    const spy = vi
      .spyOn(fs, 'readFile')
      .mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    try {
      await expect(store.patch({ userId: '7' })).rejects.toThrow(/discord\.json/)
      expect(await store.load()).toEqual(cfg()) // load() stays forgiving
    } finally {
      spy.mockRestore()
    }
    expect(await fs.readFile(file, 'utf8')).toBe(onDisk)
  })
})
