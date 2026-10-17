// Where a plugin's settings and secrets are kept (SDK + Plugin spec §23-§24; plugin runtime design P4, slice 2c):
// plain setting values in `<profile>/plugins/settings/<folder>.json`, written by the Host alone; secret settings and the
// secrets the plugin keeps itself in a SecretStore of its own at `<profile>/plugins/secrets/<folder>/` (owner-only
// files, checked on every read). The two kinds share the store under prefixes, so neither can name the other's. An
// event plugin's place in the event log is `<profile>/plugins/cursors/<folder>.json` (plugin Phase 3 N6).
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { openSecretStore } from '../../core/secrets/secretStore'
import { EVENT_ID } from '../../core/events/eventRing'
import { moveRetrying } from './moves'
import { pluginsRoot } from './registry'

export const settingsFile = (profileDir: string, folder: string): string => path.join(pluginsRoot(profileDir), 'settings', `${folder}.json`)
export const secretsDir = (profileDir: string, folder: string): string => path.join(pluginsRoot(profileDir), 'secrets', folder)
export const cursorFile = (profileDir: string, folder: string): string => path.join(pluginsRoot(profileDir), 'cursors', `${folder}.json`)

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

/** Writes `value` as the whole of `file`, through a temp file and a move, so a reader never sees half of it. */
async function writeWhole(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await moveRetrying(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
}

export async function writeSettings(profileDir: string, folder: string, values: Record<string, unknown>): Promise<void> {
  await writeWhole(settingsFile(profileDir, folder), { version: VERSION, values })
}

/** A cursor file that is there and cannot be read: the deliverer goes on from now and writes it again. */
export class PluginCursorUnreadable extends Error {
  readonly code = 'PLUGIN_CURSOR_UNREADABLE'
}

/** Where an event plugin's deliverer keeps its place in the event log (plugin Phase 3 N6): the id of the last event it
 *  handed over or gave up. */
export interface CursorStore {
  /** The cursor, or null when there is none yet. Throws PluginCursorUnreadable when the file holds no cursor. */
  read(): Promise<string | null>
  write(cursor: string): Promise<void>
}

export function pluginCursor(profileDir: string, folder: string): CursorStore {
  const file = cursorFile(profileDir, folder)
  return {
    read: async () => {
      let text: string
      try {
        text = await fs.readFile(file, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new PluginCursorUnreadable(`${file} is not JSON`)
      }
      if (!isObject(parsed) || parsed.version !== VERSION || typeof parsed.cursor !== 'string' || !EVENT_ID.test(parsed.cursor))
        throw new PluginCursorUnreadable(`${file} is not a version ${VERSION} cursor file`)
      return parsed.cursor
    },
    write: (cursor) => writeWhole(file, { version: VERSION, cursor })
  }
}

/** One kind of entry in a plugin's store: its names, without the prefix that keeps the kinds apart. */
export interface SecretSpace {
  get(name: string): Promise<string | undefined>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
  names(): Promise<string[]>
}

/** The longest secret name, and the longest value, in characters: docs/plugins.md and the SDK's types say both. */
export const SECRET_NAME_MAX = 73
export const SECRET_VALUE_MAX = 64 * 1024
/** A name a plugin can give: what the store accepts after the prefix, and nothing that could leave the folder. */
const NAME = new RegExp(`^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,${SECRET_NAME_MAX - 1}}$`)

export type PluginSecrets = { secret: SecretSpace; setting: SecretSpace; values(): Promise<string[]> }

/** The store of each plugin folder (5d, from the performance review): a store caches the ACL and SID checks Windows
 *  needs (icacls and whoami, three processes), so one opened per call ran them on every secret a plugin read. */
const opened = new Map<string, PluginSecrets>()

/** A plugin's secret store, one per folder for as long as the plugin's data is kept (forgetPluginData lets it go). */
export function pluginSecrets(profileDir: string, folder: string): PluginSecrets {
  const key = secretsDir(profileDir, folder)
  let store = opened.get(key)
  if (store === undefined) {
    store = openPluginSecrets(profileDir, folder)
    opened.set(key, store)
  }
  return store
}

function openPluginSecrets(profileDir: string, folder: string): PluginSecrets {
  const dir = secretsDir(profileDir, folder)
  // The walk stops at plugins/, not the profile: other Host code makes plugins/ with the default mode (group writable
  // under a umask such as Ubuntu's 002), and it guards no more than the profile directory above it, which is not walked.
  const store = openSecretStore({ dir, profileDir: pluginsRoot(profileDir) })
  const exists = (): Promise<boolean> => fs.stat(dir).then((s) => s.isDirectory(), () => false)
  const all = async (): Promise<string[]> => ((await exists()) ? store.withLock((tx) => tx.list()) : [])
  const space = (prefix: string): SecretSpace => {
    // A name is a file, and Windows folds case and drops a trailing dot: `Token` and `token`, `a.` and `a`, would be one
    // file there and two elsewhere, so a name is kept folded and a trailing dot refused (2c final review M10).
    const checked = (name: unknown): string => {
      if (typeof name !== 'string' || !NAME.test(name) || name.endsWith('.'))
        throw new PluginSecretRefused(`${String(name)} is not a secret name (letters, digits, _, - and ., at most ${SECRET_NAME_MAX}, not starting or ending with .)`)
      return `${prefix}${name.toLowerCase()}`
    }
    return {
      get: async (name) => (await store.read(checked(name))) ?? undefined,
      set: async (name, value) => {
        const key = checked(name)
        if (typeof value !== 'string') throw new PluginSecretRefused('a plugin secret is text')
        if (value.length > SECRET_VALUE_MAX) throw new PluginSecretRefused(`a plugin secret holds at most ${SECRET_VALUE_MAX} characters`)
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

/** Deletes a plugin's settings file, its event cursor and its secrets, for `plugins remove`. Nothing there is no
 *  error. */
export async function forgetPluginData(profileDir: string, folder: string): Promise<void> {
  opened.delete(secretsDir(profileDir, folder))
  await fs.rm(settingsFile(profileDir, folder), { force: true })
  await fs.rm(cursorFile(profileDir, folder), { force: true })
  await fs.rm(secretsDir(profileDir, folder), { recursive: true, force: true, maxRetries: 3 })
}
