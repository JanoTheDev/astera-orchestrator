import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPluginManager, type PluginManager } from './manager'
import { pluginsRoot } from './registry'

let dir: string
let profile: string
let manager: PluginManager
let clock: number
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-plugin-manager-'))
  profile = path.join(dir, 'profile')
  await fs.mkdir(profile)
  clock = 1_000
  manager = createPluginManager({ profileDir: profile, hostVersion: '1.5.0', now: () => clock })
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** A plugin folder (spec §48: a space and a non-ASCII name in its path) with the given manifest fields. */
async function plugin(
  folder: string,
  o: { name?: string; version?: string; permissions?: string[]; capabilities?: string[]; astera?: Record<string, unknown>; top?: Record<string, unknown> } = {}
): Promise<string> {
  const at = path.join(dir, folder)
  await fs.mkdir(path.join(at, 'dist'), { recursive: true })
  const pkg = {
    name: o.name ?? '@acme/astera-jira',
    version: o.version ?? '1.0.0',
    displayName: 'Jira',
    astera: {
      apiVersion: '1',
      entry: './dist/plugin.js',
      permissions: o.permissions ?? ['jobs.read', 'jobs.create'],
      ...(o.capabilities ? { capabilities: o.capabilities } : {}),
      ...o.astera
    },
    ...o.top
  }
  await fs.writeFile(path.join(at, 'package.json'), JSON.stringify(pkg))
  await fs.writeFile(path.join(at, 'dist', 'plugin.js'), 'export default {}')
  return at
}

const FOLDER = 'my plugin 플러그인'
const body = (r: { body: unknown }): Record<string, unknown> => r.body as Record<string, unknown>
const listed = async (): Promise<Record<string, unknown>[]> => {
  const r = await manager.list()
  expect(r.status).toBe(200)
  return body(r).plugins as Record<string, unknown>[]
}
const leftovers = async (): Promise<string[]> => (await fs.readdir(pluginsRoot(profile)).catch(() => [])).filter((n) => n.startsWith('.'))

describe('inspect', () => {
  it('shows what a folder holds and asks for, before anything is installed', async () => {
    const src = await plugin(FOLDER)
    const r = await manager.inspect(src)
    expect(r.status).toBe(200)
    expect(r.body).toEqual({
      id: '@acme/astera-jira',
      name: '@acme/astera-jira',
      displayName: 'Jira',
      version: '1.0.0',
      apiVersion: '1',
      entry: './dist/plugin.js',
      capabilities: [],
      permissions: ['jobs.read', 'jobs.create'],
      compatible: true
    })
    expect(await leftovers()).toEqual([])
  })

  it('says why a plugin will not run here, and what is installed under its id', async () => {
    const src = await plugin(FOLDER, { capabilities: ['event'] })
    await manager.install({ path: src, grant: [] })
    expect(await manager.inspect(src)).toMatchObject({
      status: 200,
      body: { compatible: false, reason: 'this Astera does not run event plugins yet', installed: { version: '1.0.0', enabled: true } }
    })
  })

  it('refuses a relative path, a missing folder, a folder with no package.json and a broken manifest', async () => {
    expect(await manager.inspect('relative/dir')).toEqual({ status: 400, body: { error: 'plugins-inspect needs an absolute --path' } })
    expect(await manager.inspect(3)).toEqual({ status: 400, body: { error: 'plugins-inspect needs an absolute --path' } })
    const missing = path.join(dir, 'nope')
    expect(await manager.inspect(missing)).toEqual({ status: 400, body: { error: `not a folder on this machine: ${missing}` } })
    const empty = path.join(dir, 'empty')
    await fs.mkdir(empty)
    expect(await manager.inspect(empty)).toEqual({ status: 400, body: { error: `no package.json in ${empty}` } })
    const broken = await plugin('broken')
    await fs.writeFile(path.join(broken, 'package.json'), '{ nope')
    expect(await manager.inspect(broken)).toEqual({ status: 400, body: { error: `${path.join(broken, 'package.json')} is not JSON` } })
    const bad = await plugin('bad', { permissions: ['jobs.write'] })
    expect(body(await manager.inspect(bad)).error).toMatch(/package\.json: astera\.permissions: jobs\.write is not a permission/)
  })
})

describe('install', () => {
  it('installs a copy with the full grant, enabled and stopped', async () => {
    const src = await plugin(FOLDER)
    const r = await manager.install({ path: src, grant: ['jobs.read', 'jobs.create'], expect: { name: '@acme/astera-jira', version: '1.0.0' } })
    expect(r.status).toBe(200)
    const dirOf = path.join(pluginsRoot(profile), '@acme+astera-jira')
    expect(r.body).toEqual({
      id: '@acme/astera-jira',
      name: '@acme/astera-jira',
      displayName: 'Jira',
      version: '1.0.0',
      enabled: true,
      status: 'stopped',
      capabilities: [],
      permissions: ['jobs.read', 'jobs.create'],
      requested: ['jobs.read', 'jobs.create'],
      installedAt: 1_000,
      dir: dirOf,
      source: { kind: 'folder', path: src }
    })
    expect(await fs.readFile(path.join(dirOf, 'dist', 'plugin.js'), 'utf8')).toBe('export default {}')
    expect(await listed()).toEqual([r.body])
    expect(await leftovers()).toEqual([])
  })

  it('grants a subset, and nothing at all', async () => {
    const src = await plugin(FOLDER)
    expect(body(await manager.install({ path: src, grant: ['jobs.read'] })).permissions).toEqual(['jobs.read'])
    expect(body(await manager.install({ path: src, grant: [] })).permissions).toEqual([])
  })

  it('refuses a grant the plugin did not ask for, and installs nothing', async () => {
    const src = await plugin(FOLDER)
    expect(await manager.install({ path: src, grant: ['jobs.read', 'runs.control'] })).toEqual({
      status: 400,
      body: { error: 'runs.control is not one the plugin asks for; it asks for: jobs.read, jobs.create' }
    })
    const none = await plugin('asks nothing', { name: 'quiet', permissions: [] })
    expect(body(await manager.install({ path: none, grant: ['jobs.read'] })).error).toBe(
      'jobs.read is not one the plugin asks for; it asks for: nothing'
    )
    expect(await listed()).toEqual([])
    expect(await leftovers()).toEqual([])
  })

  it('refuses an install with no grant', async () => {
    const src = await plugin(FOLDER)
    for (const grant of [undefined, 'jobs.read', [3]])
      expect(await manager.install({ path: src, grant })).toEqual({
        status: 400,
        body: { error: 'plugins-install needs a grant: the permissions you approve, from those the plugin asks for' }
      })
    expect(await listed()).toEqual([])
  })

  it('refuses a malformed expect', async () => {
    const src = await plugin(FOLDER)
    expect(await manager.install({ path: src, grant: [], expect: 'x' })).toEqual({ status: 400, body: { error: 'expect must be { name, version }' } })
  })

  it('refuses a folder that changed after it was shown', async () => {
    const src = await plugin(FOLDER, { version: '1.0.1' })
    expect(await manager.install({ path: src, grant: [], expect: { name: '@acme/astera-jira', version: '1.0.0' } })).toEqual({
      status: 409,
      body: { error: 'the folder changed after it was shown: it now holds @acme/astera-jira@1.0.1; run the install again' }
    })
    expect(await listed()).toEqual([])
    expect(await leftovers()).toEqual([])
  })

  it('refuses an entry that is not a file in the plugin', async () => {
    const src = await plugin(FOLDER, { astera: { entry: './dist/missing.js' } })
    expect(await manager.install({ path: src, grant: [] })).toEqual({
      status: 400,
      body: { error: 'the entry ./dist/missing.js is not a file in the plugin' }
    })
    expect(await leftovers()).toEqual([])
  })

  it('refuses a relative path sent straight to the Host', async () => {
    expect(await manager.install({ path: 'my-plugin', grant: [] })).toEqual({ status: 400, body: { error: 'plugins-install needs an absolute --path' } })
  })

  it('leaves an earlier install as it was when a copy fails half way', async () => {
    const src = await plugin(FOLDER)
    await manager.install({ path: src, grant: ['jobs.read'] })
    await plugin(FOLDER, { version: '2.0.0' })
    const outside = path.join(dir, 'elsewhere')
    await fs.mkdir(outside)
    await fs.mkdir(path.join(src, 'node_modules', 'deep'), { recursive: true })
    await fs.symlink(outside, path.join(src, 'node_modules', 'deep', 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await manager.install({ path: src, grant: [] })).toEqual({
      status: 400,
      body: {
        error: `cannot install from ${src}: node_modules/deep/linked is a link that leads outside the plugin; bundle it or replace the link with a copy`
      }
    })
    expect(await listed()).toMatchObject([{ version: '1.0.0', permissions: ['jobs.read'] }])
    expect(await leftovers()).toEqual([])
    const pkg = JSON.parse(await fs.readFile(path.join(pluginsRoot(profile), '@acme+astera-jira', 'package.json'), 'utf8'))
    expect(pkg.version).toBe('1.0.0')
  })

  it('replaces an earlier version, keeping it disabled, and asks the grant again', async () => {
    const src = await plugin(FOLDER)
    await manager.install({ path: src, grant: ['jobs.read', 'jobs.create'] })
    await manager.setEnabled('@acme/astera-jira', false)
    await plugin(FOLDER, { version: '1.1.0', permissions: ['jobs.read', 'jobs.create', 'runs.read'] })
    clock = 2_000
    const r = await manager.install({ path: src, grant: ['jobs.read'] })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ version: '1.1.0', enabled: false, status: 'disabled', permissions: ['jobs.read'], installedAt: 2_000, replaced: '1.0.0' })
    expect(await listed()).toHaveLength(1)
    expect(await leftovers()).toEqual([])
  })

  it('installs a plugin this Astera will not run, and says why', async () => {
    const newer = await plugin(FOLDER, { astera: { minAsteraVersion: '1.10.0' } })
    expect(await manager.install({ path: newer, grant: [] })).toMatchObject({
      status: 200,
      body: { status: 'incompatible', reason: 'the plugin needs Astera 1.10.0 or newer; this is 1.5.0' }
    })
    const api2 = await plugin('api two', { name: 'api-two', astera: { apiVersion: '2' } })
    expect(body(await manager.install({ path: api2, grant: [] }))).toMatchObject({ status: 'incompatible', reason: 'this Astera speaks Plugin API 1; the plugin needs 2' })
  })

  it('finishes two installs started together, keeping both', async () => {
    const a = await plugin('a', { name: 'plugin-a' })
    const b = await plugin('b', { name: 'plugin-b' })
    const [ra, rb] = await Promise.all([manager.install({ path: a, grant: [] }), manager.install({ path: b, grant: [] })])
    expect([ra.status, rb.status]).toEqual([200, 200])
    expect((await listed()).map((p) => p.id)).toEqual(['plugin-a', 'plugin-b'])
  })
})

describe('a plugin whose installed copy cannot be read', () => {
  it('lists as incompatible and says so', async () => {
    const src = await plugin(FOLDER)
    await manager.install({ path: src, grant: [] })
    await fs.rm(path.join(pluginsRoot(profile), '@acme+astera-jira', 'package.json'))
    expect(await listed()).toMatchObject([
      { id: '@acme/astera-jira', version: '1.0.0', status: 'incompatible', reason: expect.stringMatching(/^the installed copy cannot be read: no package\.json in /) }
    ])
  })
})

describe('get, enable, disable, remove', () => {
  beforeEach(async () => {
    await manager.install({ path: await plugin(FOLDER), grant: ['jobs.read'] })
  })

  it('gets one plugin', async () => {
    expect(await manager.get('@acme/astera-jira')).toMatchObject({ status: 200, body: { id: '@acme/astera-jira', status: 'stopped' } })
  })

  it('disables and enables, saying when nothing changed', async () => {
    expect(await manager.setEnabled('@acme/astera-jira', false)).toMatchObject({ status: 200, body: { enabled: false, status: 'disabled', changed: true } })
    expect(await manager.setEnabled('@acme/astera-jira', false)).toMatchObject({ status: 200, body: { changed: false } })
    expect(await manager.setEnabled('@acme/astera-jira', true)).toMatchObject({ status: 200, body: { enabled: true, status: 'stopped', changed: true } })
    expect(await listed()).toMatchObject([{ enabled: true }])
  })

  it('removes the folder and the record', async () => {
    expect(await manager.remove('@acme/astera-jira')).toEqual({ status: 200, body: { id: '@acme/astera-jira', version: '1.0.0', removed: true } })
    expect(await listed()).toEqual([])
    expect(await fs.readdir(pluginsRoot(profile))).toEqual(['plugins.json'])
  })

  it('answers 404 for an id that is not installed, and 400 for no id', async () => {
    expect(await manager.get('nope')).toEqual({ status: 404, body: { error: 'no plugin nope is installed' } })
    expect(await manager.setEnabled('nope', true)).toEqual({ status: 404, body: { error: 'no plugin nope is installed' } })
    expect(await manager.remove('nope')).toEqual({ status: 404, body: { error: 'no plugin nope is installed' } })
    expect(await manager.get(undefined)).toEqual({ status: 400, body: { error: 'plugins-get needs --id' } })
    expect(await manager.setEnabled('', true)).toEqual({ status: 400, body: { error: 'plugins-enable needs --id' } })
    expect(await manager.setEnabled(3, false)).toEqual({ status: 400, body: { error: 'plugins-disable needs --id' } })
    expect(await manager.remove(undefined)).toEqual({ status: 400, body: { error: 'plugins-remove needs --id' } })
  })
})

describe('a plugins.json broken by hand', () => {
  it('answers 500 naming the file, and refuses every change without writing', async () => {
    const root = pluginsRoot(profile)
    await fs.mkdir(root, { recursive: true })
    const file = path.join(root, 'plugins.json')
    await fs.writeFile(file, '{ broken')
    const list = await manager.list()
    expect(list.status).toBe(500)
    expect(body(list).error).toContain(file)
    const src = await plugin(FOLDER)
    expect((await manager.install({ path: src, grant: [] })).status).toBe(500)
    expect((await manager.setEnabled('@acme/astera-jira', false)).status).toBe(500)
    expect((await manager.remove('@acme/astera-jira')).status).toBe(500)
    expect((await manager.inspect(src)).status).toBe(500)
    expect(await fs.readFile(file, 'utf8')).toBe('{ broken')
    expect(await leftovers()).toEqual([])
  })
})
