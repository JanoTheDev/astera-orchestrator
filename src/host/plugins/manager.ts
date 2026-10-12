// The Host's plugin manager (SDK + Plugin spec §12, §27; plugin runtime design P4-P8): what is installed in
// `<profile>/plugins`, and the changes a person makes to it. Every change runs after the one before it finished, so two
// installs never write the registry over each other. 2a runs no plugin: an enabled, compatible plugin is `stopped`.
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { incompatibility, parseManifest, pluginFolderName, type PluginManifest, type PluginPermission } from '../../core/plugins/manifest'
import { PluginCopyRefused, copyPluginFolder } from './copyFolder'
import { RegistryUnreadable, pluginsRoot, readRegistry, writeRegistry, type PluginRecord } from './registry'

export type PluginStatus = 'disabled' | 'incompatible' | 'stopped' | 'starting' | 'running' | 'failed'

/** A Host answer: an HTTP-like status and a body, `{ error }` when it is not 2xx. */
export interface PluginsAnswer {
  status: number
  body: unknown
}

export interface PluginManager {
  inspect(path: unknown): Promise<PluginsAnswer>
  install(a: { path: unknown; grant: unknown; expect?: unknown }): Promise<PluginsAnswer>
  list(): Promise<PluginsAnswer>
  get(id: unknown): Promise<PluginsAnswer>
  setEnabled(id: unknown, enabled: boolean): Promise<PluginsAnswer>
  remove(id: unknown): Promise<PluginsAnswer>
  /** The registry as it is, for the plugin runtime (2b). Throws `RegistryUnreadable`. */
  records(): Promise<PluginRecord[]>
}

/** A refusal: a status and the sentence the caller reads. */
class Refused extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

const refused = (status: number, error: string): PluginsAnswer => ({ status, body: { error } })

/** The manifest a folder's package.json holds, or the sentence saying why it holds none. */
async function readManifest(folder: string): Promise<{ ok: true; manifest: PluginManifest } | { ok: false; error: string }> {
  const file = path.join(folder, 'package.json')
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, error: `no package.json in ${folder}` }
    return { ok: false, error: `${file} cannot be read: ${(e as Error).message}` }
  }
  let pkg: unknown
  try {
    pkg = JSON.parse(text)
  } catch {
    return { ok: false, error: `${file} is not JSON` }
  }
  const parsed = parseManifest(pkg)
  return parsed.ok ? parsed : { ok: false, error: `${file}: ${parsed.problems.join('; ')}` }
}

const isFolder = (p: string): Promise<boolean> => fs.stat(p).then((s) => s.isDirectory(), () => false)

/** The id a command names, or a 400 that says the flag. */
const idOf = (cmd: string, id: unknown): string => {
  if (typeof id !== 'string' || id === '') throw new Refused(400, `${cmd} needs --id`)
  return id
}

/** An absolute path to a folder on this machine, or a 400. */
async function folderOf(cmd: string, p: unknown): Promise<string> {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Refused(400, `${cmd} needs an absolute --path`)
  if (!(await isFolder(p))) throw new Refused(400, `not a folder on this machine: ${p}`)
  return p
}

const hex = (): string => randomBytes(6).toString('hex')

/** Removes a folder the Host no longer needs; a failure leaves it behind rather than failing the change it followed. */
const discard = (p: string): Promise<void> => fs.rm(p, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})

export function createPluginManager(d: {
  profileDir: string
  hostVersion: string
  /** The plugin capabilities this Host serves (design P8); none in 2a. */
  capabilities?: readonly string[]
  now?: () => number
}): PluginManager {
  const root = pluginsRoot(d.profileDir)
  const host = { version: d.hostVersion, capabilities: d.capabilities ?? [] }
  const now = d.now ?? Date.now
  let queue: Promise<unknown> = Promise.resolve()

  /** One at a time, each answered with its refusal or the registry's own complaint. */
  const serial = (fn: () => Promise<PluginsAnswer>): Promise<PluginsAnswer> => {
    const run = queue.then(async () => {
      try {
        return await fn()
      } catch (e) {
        if (e instanceof Refused) return refused(e.status, e.message)
        if (e instanceof RegistryUnreadable) return refused(500, e.message)
        throw e
      }
    })
    queue = run.catch(() => {})
    return run
  }

  /** A record as a person sees it, read with its installed copy's manifest. */
  async function view(r: PluginRecord): Promise<Record<string, unknown>> {
    const dir = path.join(root, r.folder)
    const read = await readManifest(dir)
    const m = read.ok ? read.manifest : null
    const reason = m ? incompatibility(m, host) : `the installed copy cannot be read: ${read.ok ? '' : read.error}`
    const status: PluginStatus = !r.enabled ? 'disabled' : reason !== null ? 'incompatible' : 'stopped'
    return {
      id: r.id,
      name: m?.name ?? r.id,
      displayName: m?.displayName ?? r.id,
      version: m?.version ?? r.version,
      ...(m?.description !== undefined ? { description: m.description } : {}),
      enabled: r.enabled,
      status,
      ...(reason !== null ? { reason } : {}),
      capabilities: m?.capabilities ?? [],
      permissions: r.granted,
      requested: m?.permissions ?? [],
      installedAt: r.installedAt,
      dir,
      source: r.source
    }
  }

  const find = (records: PluginRecord[], id: string): PluginRecord => {
    const r = records.find((x) => x.id === id)
    if (!r) throw new Refused(404, `no plugin ${id} is installed`)
    return r
  }

  async function inspect(p: unknown): Promise<PluginsAnswer> {
    const folder = await folderOf('plugins-inspect', p)
    const read = await readManifest(folder)
    if (!read.ok) throw new Refused(400, read.error)
    const m = read.manifest
    const installed = (await readRegistry(root)).find((r) => r.id === m.id)
    const reason = incompatibility(m, host)
    return {
      status: 200,
      body: {
        id: m.id,
        name: m.name,
        displayName: m.displayName,
        version: m.version,
        ...(m.description !== undefined ? { description: m.description } : {}),
        apiVersion: m.apiVersion,
        entry: m.entry,
        capabilities: m.capabilities,
        permissions: m.permissions,
        ...(m.minAsteraVersion !== undefined ? { minAsteraVersion: m.minAsteraVersion } : {}),
        compatible: reason === null,
        ...(reason !== null ? { reason } : {}),
        ...(installed ? { installed: { version: installed.version, enabled: installed.enabled } } : {})
      }
    }
  }

  async function install(a: { path: unknown; grant: unknown; expect?: unknown }): Promise<PluginsAnswer> {
    const src = await folderOf('plugins-install', a.path)
    const grant = a.grant
    if (!Array.isArray(grant) || !grant.every((g) => typeof g === 'string'))
      throw new Refused(400, 'plugins-install needs a grant: the permissions you approve, from those the plugin asks for')
    const want = a.expect
    if (
      want !== undefined &&
      (typeof want !== 'object' || want === null || typeof (want as Record<string, unknown>).name !== 'string' || typeof (want as Record<string, unknown>).version !== 'string')
    )
      throw new Refused(400, 'expect must be { name, version }')
    // Read before anything is copied: a registry that cannot be read refuses the change with nothing written.
    const records = await readRegistry(root)
    await fs.mkdir(root, { recursive: true })
    const staging = path.join(root, `.staging-${hex()}`)
    try {
      try {
        await copyPluginFolder(src, staging)
      } catch (e) {
        if (e instanceof PluginCopyRefused) throw new Refused(400, `cannot install from ${src}: ${e.message}`)
        throw e
      }
      // The copy is what will run, so the copy is what is checked (design P6).
      const read = await readManifest(staging)
      if (!read.ok) throw new Refused(400, read.error.split(staging).join(src))
      const m = read.manifest
      if (want !== undefined) {
        const w = want as { name: string; version: string }
        if (w.name !== m.name || w.version !== m.version)
          throw new Refused(409, `the folder changed after it was shown: it now holds ${m.name}@${m.version}; run the install again`)
      }
      const granted: PluginPermission[] = []
      for (const g of grant as string[]) {
        if (!(m.permissions as string[]).includes(g))
          throw new Refused(400, `${g} is not one the plugin asks for; it asks for: ${m.permissions.length > 0 ? m.permissions.join(', ') : 'nothing'}`)
        if (!granted.includes(g as PluginPermission)) granted.push(g as PluginPermission)
      }
      const entry = await fs.stat(path.join(staging, m.entry)).then((s) => s.isFile(), () => false)
      if (!entry) throw new Refused(400, `the entry ${m.entry} is not a file in the plugin`)
      const folder = pluginFolderName(m.id)
      const final = path.join(root, folder)
      const previous = records.find((r) => r.id === m.id)
      // An earlier copy steps aside first and comes back if the registry cannot be written.
      const retired = (await isFolder(final)) ? path.join(root, `.retired-${hex()}`) : null
      if (retired) await fs.rename(final, retired)
      try {
        await fs.rename(staging, final)
      } catch (e) {
        if (retired) await fs.rename(retired, final).catch(() => {})
        throw e
      }
      const record: PluginRecord = {
        id: m.id,
        version: m.version,
        folder,
        enabled: previous?.enabled ?? true,
        granted,
        installedAt: now(),
        source: { kind: 'folder', path: src }
      }
      try {
        await writeRegistry(root, [...records.filter((r) => r.id !== m.id), record].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)))
      } catch (e) {
        await discard(final)
        if (retired) await fs.rename(retired, final).catch(() => {})
        throw e
      }
      if (retired) await discard(retired)
      return { status: 200, body: { ...(await view(record)), ...(previous ? { replaced: previous.version } : {}) } }
    } finally {
      await discard(staging)
    }
  }

  async function setEnabled(id: unknown, enabled: boolean): Promise<PluginsAnswer> {
    const want = idOf(enabled ? 'plugins-enable' : 'plugins-disable', id)
    const records = await readRegistry(root)
    const r = find(records, want)
    if (r.enabled === enabled) return { status: 200, body: { ...(await view(r)), changed: false } }
    const next = { ...r, enabled }
    await writeRegistry(root, records.map((x) => (x.id === want ? next : x)))
    return { status: 200, body: { ...(await view(next)), changed: true } }
  }

  async function remove(id: unknown): Promise<PluginsAnswer> {
    const want = idOf('plugins-remove', id)
    const records = await readRegistry(root)
    const r = find(records, want)
    const final = path.join(root, r.folder)
    // Out of the way before the record goes, so a folder Windows will not let go of fails the removal whole.
    const retired = (await isFolder(final)) ? path.join(root, `.retired-${hex()}`) : null
    if (retired) await fs.rename(final, retired)
    try {
      await writeRegistry(root, records.filter((x) => x.id !== want))
    } catch (e) {
      if (retired) await fs.rename(retired, final).catch(() => {})
      throw e
    }
    if (retired) await discard(retired)
    return { status: 200, body: { id: r.id, version: r.version, removed: true } }
  }

  return {
    inspect: (p) => serial(() => inspect(p)),
    install: (a) => serial(() => install(a)),
    list: () =>
      serial(async () => ({ status: 200, body: { plugins: await Promise.all((await readRegistry(root)).map(view)) } })),
    get: (id) =>
      serial(async () => {
        const want = idOf('plugins-get', id)
        return { status: 200, body: await view(find(await readRegistry(root), want)) }
      }),
    setEnabled: (id, enabled) => serial(() => setEnabled(id, enabled)),
    remove: (id) => serial(() => remove(id)),
    records: () => readRegistry(root)
  }
}
