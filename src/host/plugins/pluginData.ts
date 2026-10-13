// Where a plugin's settings and secrets are kept (SDK + Plugin spec §23-§24; plugin runtime design P4, slice 2c):
// plain setting values in `<profile>/plugins/settings/<folder>.json`, written by the Host alone; secret settings and the
// secrets the plugin keeps itself in a SecretStore of its own at `<profile>/plugins/secrets/<folder>/` (owner-only
// files, checked on every read). The two kinds share the store under prefixes, so neither can name the other's.
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { openSecretStore } from '../../core/secrets/secretStore'
import { moveRetrying } from './moves'
import { pluginsRoot } from './registry'

export const settingsFile = (profileDir: string, folder: string): string => path.join(pluginsRoot(profileDir), 'settings', `${folder}.json`)
export const secretsDir = (profileDir: string, folder: string): string => path.join(pluginsRoot(profileDir), 'secrets', folder)

const VERSION = 1

/** A settings file that is there and cannot be read: refused, never read as empty, so the plugin is not started with
 *  values it was never given. A write replaces it whole, which is how `plugins configure` repairs it. */
export class PluginSettingsUnreadable extends Error {
  readonly code = 'PLUGIN_SETTINGS_UNREADABLE'
}

/** A secret name or value a plugin may not use. */
export class PluginSecretRefused extends Error {
  readonly code = 'PLUGIN_SECRET_REFUSED'
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export async function readSettings(profileDir: string, folder: string): Promise<Record<string, unknown>> {
  const file = settingsFile(profileDir, folder)
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw e
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new PluginSettingsUnreadable(`${file} is not JSON; set the plugin's settings again to rewrite it`)
  }
  if (!isObject(parsed) || parsed.version !== VERSION || !isObject(parsed.values))
    throw new PluginSettingsUnreadable(`${file} is not a version ${VERSION} settings file; set the plugin's settings again to rewrite it`)
  return parsed.values
}

export async function writeSettings(profileDir: string, folder: string, values: Record<string, unknown>): Promise<void> {
  const file = settingsFile(profileDir, folder)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify({ version: VERSION, values }, null, 2)}\n`, 'utf8')
  try {
    await moveRetrying(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
}

/** One kind of entry in a plugin's store: its names, without the prefix that keeps the kinds apart. */
export interface SecretSpace {
  get(name: string): Promise<string | undefined>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
  names(): Promise<string[]>
}

/** A name a plugin can give: what the store accepts after the prefix, and nothing that could leave the folder. */
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,72}$/
const VALUE_MAX = 64 * 1024

export function pluginSecrets(profileDir: string, folder: string): { secret: SecretSpace; setting: SecretSpace; values(): Promise<string[]> } {
  const dir = secretsDir(profileDir, folder)
  const store = openSecretStore({ dir, profileDir })
  const exists = (): Promise<boolean> => fs.stat(dir).then((s) => s.isDirectory(), () => false)
  const all = async (): Promise<string[]> => ((await exists()) ? store.withLock((tx) => tx.list()) : [])
  const space = (prefix: string): SecretSpace => {
    const checked = (name: unknown): string => {
      if (typeof name !== 'string' || !NAME.test(name))
        throw new PluginSecretRefused(`${String(name)} is not a secret name (letters, digits, _, - and ., at most 73, not starting with .)`)
      return `${prefix}${name}`
    }
    return {
      get: async (name) => (await store.read(checked(name))) ?? undefined,
      set: async (name, value) => {
        const key = checked(name)
        if (typeof value !== 'string') throw new PluginSecretRefused('a plugin secret is text')
        if (value.length > VALUE_MAX) throw new PluginSecretRefused(`a plugin secret holds at most ${VALUE_MAX} characters`)
        await store.withLock((tx) => tx.write(key, value))
      },
      delete: async (name) => {
        const key = checked(name)
        if (await exists()) await store.withLock((tx) => tx.remove(key))
      },
      names: async () => (await all()).filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)).sort()
    }
  }
  return {
    secret: space('secret-'),
    setting: space('setting-'),
    values: async () => {
      const out: string[] = []
      for (const n of await all()) {
        const v = await store.read(n)
        if (v !== null) out.push(v)
      }
      return out
    }
  }
}

/** Deletes a plugin's settings file and its secrets, for `plugins remove`. Nothing there is no error. */
export async function forgetPluginData(profileDir: string, folder: string): Promise<void> {
  await fs.rm(settingsFile(profileDir, folder), { force: true })
  await fs.rm(secretsDir(profileDir, folder), { recursive: true, force: true, maxRetries: 3 })
}
