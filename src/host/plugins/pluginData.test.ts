import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PluginCursorUnreadable,
  PluginSecretRefused,
  PluginSettingsUnreadable,
  cursorFile,
  forgetPluginData,
  pluginCursor,
  pluginSecrets,
  readSettings,
  secretsDir,
  settingsFile,
  writeSettings
} from './pluginData'

let dir: string
let profile: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-plugin-data-'))
  // Spec §48: a space and Hangul in the profile's path.
  profile = path.join(dir, 'my profile 프로필')
  await fs.mkdir(profile)
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('a plugin settings file', () => {
  it('lives in <profile>/plugins/settings, and reads as empty before anything was set', async () => {
    expect(settingsFile(profile, '@acme+jira')).toBe(path.join(profile, 'plugins', 'settings', '@acme+jira.json'))
    expect(await readSettings(profile, '@acme+jira')).toEqual({})
  })

  it('reads back what was written, as JSON with a version', async () => {
    await writeSettings(profile, '@acme+jira', { baseUrl: 'https://jira.example.com', pageSize: 50, dryRun: false })
    expect(await readSettings(profile, '@acme+jira')).toEqual({ baseUrl: 'https://jira.example.com', pageSize: 50, dryRun: false })
    expect(JSON.parse(await fs.readFile(settingsFile(profile, '@acme+jira'), 'utf8'))).toMatchObject({ version: 1 })
    expect((await fs.readdir(path.dirname(settingsFile(profile, '@acme+jira')))).sort()).toEqual(['@acme+jira.json'])
  })

  it('refuses a file broken by hand, naming it', async () => {
    await fs.mkdir(path.dirname(settingsFile(profile, 'x')), { recursive: true })
    for (const text of ['{ nope', '[]', '{"version":2,"values":{}}', '{"version":1,"values":[]}']) {
      await fs.writeFile(settingsFile(profile, 'x'), text)
      const e = await readSettings(profile, 'x').catch((err: unknown) => err)
      expect(e, text).toBeInstanceOf(PluginSettingsUnreadable)
      expect((e as Error).message).toContain(settingsFile(profile, 'x'))
    }
  })
})

describe('a plugin secret store', () => {
  it('keeps the plugin secrets and its secret settings apart, by name', async () => {
    const s = pluginSecrets(profile, '@acme+jira')
    await s.secret.set('refresh-token', 'r-123')
    await s.setting.set('token', 'tok-456')
    expect(await s.secret.get('refresh-token')).toBe('r-123')
    expect(await s.setting.get('token')).toBe('tok-456')
    expect(await s.secret.get('token')).toBeUndefined()
    expect(await s.secret.names()).toEqual(['refresh-token'])
    expect(await s.setting.names()).toEqual(['token'])
    expect((await s.values()).sort()).toEqual(['r-123', 'tok-456'])
    await s.secret.delete('refresh-token')
    expect(await s.secret.get('refresh-token')).toBeUndefined()
    expect(existsSync(secretsDir(profile, '@acme+jira'))).toBe(true)
  })

  it('keeps one plugin from another', async () => {
    await pluginSecrets(profile, 'plugin-a').secret.set('token', 'a-secret')
    expect(await pluginSecrets(profile, 'plugin-b').secret.get('token')).toBeUndefined()
  })

  it('creates nothing to answer a read, a list or the values of a plugin with no secrets', async () => {
    const s = pluginSecrets(profile, 'quiet')
    expect(await s.secret.get('x')).toBeUndefined()
    expect(await s.secret.names()).toEqual([])
    expect(await s.values()).toEqual([])
    expect(existsSync(secretsDir(profile, 'quiet'))).toBe(false)
  })

  it('refuses a name that could reach another file, and a value too long', async () => {
    const s = pluginSecrets(profile, 'p')
    for (const name of ['../other', 'a/b', '', 'x'.repeat(74), '.hidden', 'has space'])
      expect(await s.secret.set(name, 'v').catch((e: unknown) => e), name).toBeInstanceOf(PluginSecretRefused)
    expect(await s.secret.get('../other').catch((e: unknown) => e)).toBeInstanceOf(PluginSecretRefused)
    const long = await s.secret.set('big', 'x'.repeat(64 * 1024 + 1)).catch((e: unknown) => e)
    expect(long).toBeInstanceOf(PluginSecretRefused)
    expect((long as Error).message).toBe('a plugin secret holds at most 65536 characters')
    expect(await s.secret.set('ok', 3 as unknown as string).catch((e: unknown) => e)).toBeInstanceOf(PluginSecretRefused)
  })
})

describe('forgetPluginData', () => {
  it('deletes the settings file and the secrets of one plugin, and nothing of another', async () => {
    await writeSettings(profile, 'gone', { a: 1 })
    await pluginSecrets(profile, 'gone').secret.set('t', 'v')
    await writeSettings(profile, 'kept', { a: 2 })
    await forgetPluginData(profile, 'gone')
    expect(existsSync(settingsFile(profile, 'gone'))).toBe(false)
    expect(existsSync(secretsDir(profile, 'gone'))).toBe(false)
    expect(await readSettings(profile, 'kept')).toEqual({ a: 2 })
    await forgetPluginData(profile, 'never-installed')
  })
})

// 2c final review M10: on Windows two names that differ in case, or by a trailing dot, are one file.
describe('secret names on a file system that folds case', () => {
  it('keeps names that differ only in case as one secret, everywhere', async () => {
    const s = pluginSecrets(profile, 'p')
    await s.secret.set('Token', 'upper')
    await s.secret.set('token', 'lower')
    expect(await s.secret.get('TOKEN')).toBe('lower')
    expect(await s.secret.names()).toEqual(['token'])
  })

  it('refuses a name ending in a dot', async () => {
    expect(await pluginSecrets(profile, 'p').secret.set('a.', 'v').catch((e: unknown) => e)).toBeInstanceOf(PluginSecretRefused)
  })
})

describe('pluginCursor (plugin Phase 3 N6)', () => {
  it('lives in <profile>/plugins/cursors, has none until one is written, then reads back the last one written', async () => {
    expect(cursorFile(profile, '@acme+jira')).toBe(path.join(profile, 'plugins', 'cursors', '@acme+jira.json'))
    const c = pluginCursor(profile, 'p')
    expect(await c.read()).toBeNull()
    await c.write('ev_aaaaaaaaaaaa_3')
    await c.write('ev_aaaaaaaaaaaa_4')
    expect(await c.read()).toBe('ev_aaaaaaaaaaaa_4')
    expect(JSON.parse(await fs.readFile(cursorFile(profile, 'p'), 'utf8'))).toEqual({ version: 1, cursor: 'ev_aaaaaaaaaaaa_4' })
  })

  it('refuses a file that is not a version 1 cursor naming an event id', async () => {
    await fs.mkdir(path.dirname(cursorFile(profile, 'p')), { recursive: true })
    for (const text of ['{ broken', '{"version":2,"cursor":"ev_aaaaaaaaaaaa_1"}', '{"version":1,"cursor":"nope"}', '[]']) {
      await fs.writeFile(cursorFile(profile, 'p'), text)
      await expect(pluginCursor(profile, 'p').read(), text).rejects.toBeInstanceOf(PluginCursorUnreadable)
    }
  })

  it('goes with the plugin’s other data', async () => {
    await pluginCursor(profile, 'p').write('ev_aaaaaaaaaaaa_1')
    await forgetPluginData(profile, 'p')
    expect(existsSync(cursorFile(profile, 'p'))).toBe(false)
  })
})
