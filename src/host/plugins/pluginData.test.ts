import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  PluginSecretRefused,
  PluginSettingsUnreadable,
  forgetPluginData,
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
