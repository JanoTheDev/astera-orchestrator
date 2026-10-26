import { describe, it, expect, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DiscordConfigReader, EMPTY_DISCORD_CONFIG } from './config'

const tmp = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), 'astera-dccfg-'))

class Exposed extends DiscordConfigReader {
  raw(): ReturnType<DiscordConfigReader['read']> {
    return this.read()
  }
}

describe('DiscordConfigReader', () => {
  it('a missing file gives the empty config, with the plan workspace on', async () => {
    const dir = await tmp()
    const cfg = await new DiscordConfigReader(path.join(dir, 'discord.json')).load()
    expect(cfg).toEqual(EMPTY_DISCORD_CONFIG)
    expect(cfg.plans).toBe(true)
  })

  it('a corrupt file gives the empty config', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'discord.json')
    await fs.writeFile(file, '{broken', 'utf8')
    expect(await new DiscordConfigReader(file).load()).toEqual(EMPTY_DISCORD_CONFIG)
  })

  it('reads and trims stored values; blank or non-string values become null', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'discord.json')
    await fs.writeFile(
      file,
      JSON.stringify({ botToken: ' abc.def ', guildId: '  ', userId: 42, plans: false }),
      'utf8'
    )
    expect(await new DiscordConfigReader(file).load()).toEqual({
      botToken: 'abc.def',
      guildId: null,
      userId: null,
      plans: false
    })
  })

  it('plans is only off when stored as the boolean false', async () => {
    const dir = await tmp()
    const file = path.join(dir, 'discord.json')
    await fs.writeFile(file, JSON.stringify({ plans: 'false' }), 'utf8')
    expect((await new DiscordConfigReader(file).load()).plans).toBe(true)
  })

  it('a transient read error is null from read() and the empty config from load()', async () => {
    const spy = vi
      .spyOn(fs, 'readFile')
      .mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    try {
      expect(await new Exposed('x/discord.json').raw()).toBeNull()
      expect(await new DiscordConfigReader('x/discord.json').load()).toEqual(EMPTY_DISCORD_CONFIG)
    } finally {
      spy.mockRestore()
    }
  })
})
