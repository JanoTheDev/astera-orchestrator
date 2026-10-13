// The Host's plugin manager (SDK + Plugin spec §12, §27; plugin runtime design P4-P8): what is installed in
// `<profile>/plugins`, and the changes a person makes to it. Every change runs after the one before it finished, so two
// installs never write the registry over each other. 2a runs no plugin: an enabled, compatible plugin is `stopped`.
import { promises as fs } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { incompatibility, parseManifest, pluginFolderName, type PluginManifest, type PluginPermission } from '../../core/plugins/manifest'
import { PluginCopyRefused, copyPluginFolder, layoutProblem } from './copyFolder'
import { RegistryUnreadable, pluginsRoot, readRegistry, writeRegistry, type PluginRecord } from './registry'
import { moveRetrying, type Rename } from './moves'
import { pluginLogFile, type PluginLaunch, type PluginRuntime } from './runtime'

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
  /** Starts every enabled plugin this Astera runs: the Host calls it once it listens. */
  startAll(): Promise<void>
  /** The last lines of a plugin's log (design P13). */
  logs(id: unknown, lines: unknown): Promise<PluginsAnswer>
  /** What could keep a plugin from running, one check at a time (spec §12 `doctor`). */
  doctor(id: unknown): Promise<PluginsAnswer>
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

const LOG_LINES_DEFAULT = 100
const LOG_LINES_MAX = 1000

/** The error a failed change answers with when the earlier copy could not be moved back either: the person is told
 *  where it is, since nothing else will find it. */
const stranded = (first: unknown, retired: string): Error =>
  new Error(`${first instanceof Error ? first.message : String(first)}; the earlier copy could not be put back: it is in ${retired}`)

/** Removes a folder the Host no longer needs; a failure leaves it behind rather than failing the change it followed. */
const discard = (p: string): Promise<void> => fs.rm(p, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})

export function createPluginManager(d: {
  profileDir: string
  hostVersion: string
  /** The plugin capabilities this Host serves (design P8); none in 2a. */
  capabilities?: readonly string[]
  now?: () => number
  /** For tests: one folder move, and the waits between tries of a refused one. */
  rename?: Rename
  renameWaitsMs?: readonly number[]
  /** For tests: the folder copy (`copyPluginFolder`). */
  copy?: (src: string, dest: string) => Promise<void>
  /** What runs the enabled plugins (2b). Absent: nothing runs, and an enabled, compatible plugin is `stopped`. */
  runtime?: Pick<PluginRuntime, 'start' | 'restart' | 'stop' | 'status'>
}): PluginManager {
  const root = pluginsRoot(d.profileDir)
  // The copies live one level down, so no plugin name can be plugins.json or one of the folders the Host keeps for
  // every plugin beside it (design P4). Staging and retired folders sit beside the copies and start with a dot, which
  // no npm name does.
  const installed = path.join(root, 'installed')
  const host = { version: d.hostVersion, capabilities: d.capabilities ?? [] }
  const now = d.now ?? Date.now
  let queue: Promise<unknown> = Promise.resolve()
  /** Moves a folder, trying again while the system refuses for a moment. */
  const move = (from: string, to: string): Promise<void> =>
    moveRetrying(from, to, { ...(d.rename ? { rename: d.rename } : {}), ...(d.renameWaitsMs ? { waitsMs: d.renameWaitsMs } : {}) })

  /** Puts an earlier copy back after a failed change, and fails with both stories when it cannot. */
  async function putBack(first: unknown, retired: string | null, final: string): Promise<never> {
    if (retired) await move(retired, final).catch(() => Promise.reject(stranded(first, retired)))
    throw first
  }

  let swept: Promise<void> | null = null

  /** Clears what a change that never finished left in `installed` (final review m3): a staging folder goes; an earlier
   *  copy that stepped aside comes back when its plugin is still installed and nothing took its place, and goes
   *  otherwise. With a registry that cannot be read nothing retired is touched, since nothing says whose it is. */
  async function sweep(): Promise<void> {
    const names = await fs.readdir(installed).catch(() => [] as string[])
    const records = await readRegistry(root).catch(() => null)
    for (const n of names) {
      if (n.startsWith('.staging-')) {
        await discard(path.join(installed, n))
        continue
      }
      const retired = /^\.retired-(.+)-[0-9a-f]{12}$/.exec(n)
      if (!retired || records === null) continue
      const final = path.join(installed, retired[1])
      if (records.some((r) => r.folder === retired[1]) && !(await isFolder(final))) await move(path.join(installed, n), final).catch(() => {})
      else await discard(path.join(installed, n))
    }
  }

  /** Where an earlier copy waits while a change is made: named for its folder, so a Host that stopped half way can
   *  tell whose it is. */
  const retiredFor = (folder: string): string => path.join(installed, `.retired-${folder}-${hex()}`)

  /** One at a time, each answered with its refusal or the registry's own complaint. The first one clears what a Host
   *  that stopped half way left behind. */
  const serial = (fn: () => Promise<PluginsAnswer>): Promise<PluginsAnswer> => {
    const run = queue.then(async () => {
      try {
        await (swept ??= sweep())
        return await fn()
      } catch (e) {
        if (e instanceof Refused) return refused(e.status, e.message)
        if (e instanceof RegistryUnreadable) return refused(500, e.message)
        // A file the system would not move or write: the change was undone where it could be, and the caller is told.
        return refused(500, e instanceof Error ? e.message : String(e))
      }
    })
    queue = run.catch(() => {})
    return run
  }

  /** What the runtime needs to start the plugin a record names, with its installed copy's manifest. */
  const launchOf = (r: PluginRecord, m: PluginManifest): PluginLaunch => {
    const dir = path.join(installed, r.folder)
    return { id: r.id, version: m.version, folder: r.folder, dir, entry: path.resolve(dir, m.entry), granted: r.granted }
  }

  /** The record's plugin, when it is enabled and this Astera runs it; null otherwise. */
  async function runnable(r: PluginRecord): Promise<PluginLaunch | null> {
    if (!r.enabled) return null
    const read = await readManifest(path.join(installed, r.folder))
    if (!read.ok || incompatibility(read.manifest, host) !== null) return null
    return launchOf(r, read.manifest)
  }

  /** Starts the record's plugin when it is enabled and runs here. */
  const startIfRunnable = async (r: PluginRecord): Promise<void> => {
    if (!d.runtime) return
    const launch = await runnable(r)
    if (launch) d.runtime.start(launch)
  }

  /** A record as a person sees it, read with its installed copy's manifest and, while it runs, the runtime's word. */
  async function view(r: PluginRecord): Promise<Record<string, unknown>> {
    const dir = path.join(installed, r.folder)
    const read = await readManifest(dir)
    const m = read.ok ? read.manifest : null
    const incompatible = m ? incompatibility(m, host) : `the installed copy cannot be read: ${read.ok ? '' : read.error}`
    const run = r.enabled && incompatible === null ? d.runtime?.status(r.id) : undefined
    const status: PluginStatus = !r.enabled ? 'disabled' : incompatible !== null ? 'incompatible' : (run?.status ?? 'stopped')
    const reason = incompatible ?? run?.reason ?? null
    return {
      id: r.id,
      name: m?.name ?? r.id,
      displayName: m?.displayName ?? r.id,
      version: m?.version ?? r.version,
      ...(m?.description !== undefined ? { description: m.description } : {}),
      enabled: r.enabled,
      status,
      ...(reason !== null ? { reason } : {}),
      ...(run?.pid !== undefined ? { pid: run.pid } : {}),
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
    const layout = await layoutProblem(folder)
    if (layout !== null) throw new Refused(400, `cannot install from ${folder}: ${layout}`)
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

  /** What `folder` holds, if it can be installed with `grant` as the person saw it; refusals name `shownAs`, the folder
   *  the caller named. */
  async function installable(
    folder: string,
    shownAs: string,
    grant: readonly string[],
    expected: { name: string; version: string } | undefined
  ): Promise<{ manifest: PluginManifest; granted: PluginPermission[] }> {
    const read = await readManifest(folder)
    if (!read.ok) throw new Refused(400, read.error.split(folder).join(shownAs))
    const m = read.manifest
    if (expected !== undefined && (expected.name !== m.name || expected.version !== m.version))
      throw new Refused(409, `the folder changed after it was shown: it now holds ${m.name}@${m.version}; run the install again`)
    const granted: PluginPermission[] = []
    for (const g of grant) {
      if (!(m.permissions as string[]).includes(g))
        throw new Refused(400, `${g} is not one the plugin asks for; it asks for: ${m.permissions.length > 0 ? m.permissions.join(', ') : 'nothing'}`)
      if (!granted.includes(g as PluginPermission)) granted.push(g as PluginPermission)
    }
    const entry = await fs.stat(path.join(folder, m.entry)).then((s) => s.isFile(), () => false)
    if (!entry) throw new Refused(400, `the entry ${m.entry} is not a file in the plugin`)
    return { manifest: m, granted }
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
    const expected = want as { name: string; version: string } | undefined
    // Read before anything is copied: a registry that cannot be read refuses the change with nothing written.
    const records = await readRegistry(root)
    // The folder is checked before it is copied, so a refusal costs no copy (final review m2), and the copy is checked
    // again, because the copy is what will run (design P6).
    await installable(src, src, grant as string[], expected)
    await fs.mkdir(installed, { recursive: true })
    const staging = path.join(installed, `.staging-${hex()}`)
    try {
      try {
        await (d.copy ?? copyPluginFolder)(src, staging)
      } catch (e) {
        if (e instanceof PluginCopyRefused) throw new Refused(400, `cannot install from ${src}: ${e.message}`)
        throw e
      }
      const { manifest: m, granted } = await installable(staging, src, grant as string[], expected)
      const folder = pluginFolderName(m.id)
      const final = path.join(installed, folder)
      const previous = records.find((r) => r.id === m.id)
      // A running copy stops before its folder moves: Windows will not move a folder a process runs from. If the change
      // then fails, the earlier copy is put back and started again.
      if (previous) await d.runtime?.stop(previous.id)
      const startPrevious = async (): Promise<void> => {
        if (previous) await startIfRunnable(previous)
      }
      // An earlier copy steps aside first and comes back if the change cannot be finished.
      const retired = (await isFolder(final)) ? retiredFor(folder) : null
      if (retired) {
        try {
          await move(final, retired)
        } catch (e) {
          await startPrevious()
          throw e
        }
      }
      try {
        await move(staging, final)
      } catch (e) {
        await putBack(e, retired, final).finally(startPrevious)
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
        await putBack(e, retired, final).finally(startPrevious)
      }
      if (retired) await discard(retired)
      await startIfRunnable(record)
      return { status: 200, body: { ...(await view(record)), ...(previous ? { replaced: previous.version } : {}) } }
    } finally {
      await discard(staging)
    }
  }

  async function setEnabled(id: unknown, enabled: boolean): Promise<PluginsAnswer> {
    const want = idOf(enabled ? 'plugins-enable' : 'plugins-disable', id)
    const records = await readRegistry(root)
    const r = find(records, want)
    if (r.enabled === enabled) {
      // Enabling a plugin that failed starts it again (design P11): a change, though the flag stays as it was.
      const launch = enabled && d.runtime?.status(r.id)?.status === 'failed' ? await runnable(r) : null
      if (launch && d.runtime) {
        d.runtime.restart(launch)
        return { status: 200, body: { ...(await view(r)), changed: true } }
      }
      return { status: 200, body: { ...(await view(r)), changed: false } }
    }
    const next = { ...r, enabled }
    await writeRegistry(root, records.map((x) => (x.id === want ? next : x)))
    if (enabled) await startIfRunnable(next)
    else await d.runtime?.stop(r.id)
    return { status: 200, body: { ...(await view(next)), changed: true } }
  }

  async function logs(id: unknown, lines: unknown): Promise<PluginsAnswer> {
    const want = idOf('plugins-logs', id)
    const n = lines === undefined ? LOG_LINES_DEFAULT : typeof lines === 'string' && /^\d+$/.test(lines) ? Number(lines) : lines
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > LOG_LINES_MAX)
      throw new Refused(400, `plugins-logs --lines must be a whole number from 1 to ${LOG_LINES_MAX}`)
    const r = find(await readRegistry(root), want)
    const file = pluginLogFile(d.profileDir, r.folder)
    const read = (f: string): Promise<string[]> =>
      fs.readFile(f, 'utf8').then(
        (t) => t.split(/\r?\n/).filter((l) => l !== ''),
        () => []
      )
    const all = [...(await read(`${file}.1`)), ...(await read(file))]
    return { status: 200, body: { id: r.id, file, lines: all.slice(-n) } }
  }

  async function doctor(id: unknown): Promise<PluginsAnswer> {
    const r = find(await readRegistry(root), idOf('plugins-doctor', id))
    const dir = path.join(installed, r.folder)
    const checks: { name: string; ok: boolean; detail: string }[] = []
    const answer = (): PluginsAnswer => ({ status: 200, body: { id: r.id, ok: checks.every((c) => c.ok), checks } })
    const read = await readManifest(dir)
    if (!read.ok) {
      checks.push({ name: 'manifest', ok: false, detail: read.error })
      return answer()
    }
    const m = read.manifest
    checks.push({ name: 'manifest', ok: true, detail: `${m.name} ${m.version}, Plugin API ${m.apiVersion}` })
    const incompatible = incompatibility(m, host)
    checks.push({ name: 'compatible', ok: incompatible === null, detail: incompatible ?? 'this Astera runs it' })
    const entry = await fs.stat(path.resolve(dir, m.entry)).then((st) => st.isFile(), () => false)
    checks.push({ name: 'entry', ok: entry, detail: entry ? m.entry : `${m.entry} is not a file in the installed copy` })
    // Design P2: plugins run on the Node inside Astera, whose ABI no prebuilt addon is built for everywhere.
    const addons = (await fs.readdir(dir, { recursive: true }).catch(() => [] as string[]))
      .filter((f) => f.endsWith('.node'))
      .map((f) => f.split(path.sep).join('/'))
      .sort()
    checks.push({
      name: 'native-addons',
      ok: addons.length === 0,
      detail:
        addons.length === 0
          ? 'none'
          : `${addons.length} native addon${addons.length === 1 ? '' : 's'} (${addons[0]}${addons.length > 1 ? `, and ${addons.length - 1} more` : ''}); plugins run on the Node inside Astera, which cannot load them`
    })
    const run = r.enabled && incompatible === null ? d.runtime?.status(r.id) : undefined
    checks.push(
      !r.enabled
        ? { name: 'runtime', ok: true, detail: 'disabled' }
        : incompatible !== null
          ? { name: 'runtime', ok: true, detail: 'not started' }
          : run?.status === 'failed'
            ? { name: 'runtime', ok: false, detail: `failed: ${run.reason ?? 'it kept crashing'}` }
            : { name: 'runtime', ok: true, detail: `${run?.status ?? 'stopped'}${run?.pid !== undefined ? ` (pid ${run.pid})` : ''}` }
    )
    return answer()
  }

  async function remove(id: unknown): Promise<PluginsAnswer> {
    const want = idOf('plugins-remove', id)
    const records = await readRegistry(root)
    const r = find(records, want)
    const final = path.join(installed, r.folder)
    // Stopped first, then out of the way before the record goes, so a folder Windows will not let go of fails the
    // removal whole; a removal that fails starts the plugin again.
    await d.runtime?.stop(r.id)
    const retired = (await isFolder(final)) ? retiredFor(r.folder) : null
    if (retired) {
      try {
        await move(final, retired)
      } catch (e) {
        await startIfRunnable(r)
        throw e
      }
    }
    try {
      await writeRegistry(root, records.filter((x) => x.id !== want))
    } catch (e) {
      await putBack(e, retired, final).finally(() => startIfRunnable(r))
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
    logs: (id, lines) => serial(() => logs(id, lines)),
    doctor: (id) => serial(() => doctor(id)),
    startAll: () =>
      serial(async () => {
        for (const r of await readRegistry(root)) await startIfRunnable(r)
        return { status: 200, body: {} }
      }).then(() => {}),
    records: () => readRegistry(root)
  }
}
