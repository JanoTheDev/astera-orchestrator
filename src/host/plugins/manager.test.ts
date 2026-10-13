import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPluginManager, type PluginManager } from './manager'
import type { PluginLaunch, PluginRunStatus, PluginRuntime } from './runtime'
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
/** Where installed copies live (design P4): beside plugins.json, never as it. */
const installed = (): string => path.join(pluginsRoot(profile), 'installed')
const leftovers = async (): Promise<string[]> => [
  ...(await fs.readdir(pluginsRoot(profile)).catch(() => [])),
  ...(await fs.readdir(installed()).catch(() => []))
].filter((n) => n.startsWith('.'))

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

  it('refuses a folder in a layout a copy cannot keep, before anything is approved', async () => {
    const src = await plugin(FOLDER)
    await fs.mkdir(path.join(src, 'node_modules', '.pnpm'), { recursive: true })
    expect(await manager.inspect(src)).toEqual({
      status: 400,
      body: { error: `cannot install from ${src}: node_modules/.pnpm is pnpm's isolated layout, which a copy cannot keep: bundle the plugin, or install its dependencies hoisted (node-linker=hoisted)` }
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
    const dirOf = path.join(installed(), '@acme+astera-jira')
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

  // Final review m2: an app or SDK caller sends install without inspecting first; a refusal must not cost a copy.
  it('checks the folder before copying it', async () => {
    const copies: string[] = []
    const m = createPluginManager({
      profileDir: profile,
      hostVersion: '1.5.0',
      copy: async (from) => {
        copies.push(from)
      }
    })
    const src = await plugin(FOLDER)
    expect((await m.install({ path: src, grant: ['jobs.reed'] })).status).toBe(400)
    expect((await m.install({ path: src, grant: [], expect: { name: '@acme/astera-jira', version: '9.9.9' } })).status).toBe(409)
    const noEntry = await plugin('no entry', { astera: { entry: './missing.js' } })
    expect((await m.install({ path: noEntry, grant: [] })).status).toBe(400)
    const empty = path.join(dir, 'empty folder')
    await fs.mkdir(empty)
    expect((await m.install({ path: empty, grant: [] })).status).toBe(400)
    expect(copies).toEqual([])
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
    const pkg = JSON.parse(await fs.readFile(path.join(installed(), '@acme+astera-jira', 'package.json'), 'utf8'))
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

describe('a plugin named like the Host’s own files', () => {
  it('installs and removes beside plugins.json and the shared folders without touching them', async () => {
    const root = pluginsRoot(profile)
    // What 2b and 2c keep for every plugin, standing in for them here.
    for (const shared of ['logs', 'settings', 'secrets']) {
      await fs.mkdir(path.join(root, shared), { recursive: true })
      await fs.writeFile(path.join(root, shared, 'keep'), shared)
    }
    for (const name of ['plugins.json', 'logs', 'settings', 'secrets', 'installed']) {
      const src = await plugin(`named ${name}`, { name })
      expect((await manager.install({ path: src, grant: [] })).status, name).toBe(200)
    }
    expect((await listed()).map((p) => p.id).sort()).toEqual(['installed', 'logs', 'plugins.json', 'secrets', 'settings'])
    for (const name of ['logs', 'settings', 'secrets']) expect((await manager.remove(name)).status).toBe(200)
    for (const shared of ['logs', 'settings', 'secrets']) expect(await fs.readFile(path.join(root, shared, 'keep'), 'utf8')).toBe(shared)
    expect((await listed()).map((p) => p.id).sort()).toEqual(['installed', 'plugins.json'])
  })
})

describe('a plugin whose installed copy cannot be read', () => {
  it('lists as incompatible and says so', async () => {
    const src = await plugin(FOLDER)
    await manager.install({ path: src, grant: [] })
    await fs.rm(path.join(installed(), '@acme+astera-jira', 'package.json'))
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
    // Its log goes too, the rotated generation with it: nothing can read it once the plugin is gone (2b smoke).
    const log = path.join(pluginsRoot(profile), 'logs', '@acme+astera-jira.log')
    await fs.mkdir(path.dirname(log), { recursive: true })
    await fs.writeFile(log, 'x\n')
    await fs.writeFile(`${log}.1`, 'y\n')
    expect(await manager.remove('@acme/astera-jira')).toEqual({ status: 200, body: { id: '@acme/astera-jira', version: '1.0.0', removed: true } })
    expect(await fs.readdir(path.dirname(log))).toEqual([])
    expect(await listed()).toEqual([])
    expect(await fs.readdir(pluginsRoot(profile))).toEqual(['installed', 'logs', 'plugins.json'])
    expect(await fs.readdir(installed())).toEqual([])
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

describe('a folder Windows will not let go of for a moment', () => {
  const eperm = (): NodeJS.ErrnoException => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })

  it('moves it once the scanner lets go', async () => {
    let refusals = 2
    const m = createPluginManager({
      profileDir: profile,
      hostVersion: '1.5.0',
      renameWaitsMs: [0, 0, 0],
      rename: async (from, to) => {
        if (refusals > 0) {
          refusals -= 1
          throw eperm()
        }
        await fs.rename(from, to)
      }
    })
    expect((await m.install({ path: await plugin(FOLDER), grant: [] })).status).toBe(200)
    expect(refusals).toBe(0)
  })

  it('says so, naming the folder, when an update cannot put the earlier copy back', async () => {
    const src = await plugin(FOLDER)
    await manager.install({ path: src, grant: [] })
    await plugin(FOLDER, { version: '2.0.0' })
    let moved = 0
    const m = createPluginManager({
      profileDir: profile,
      hostVersion: '1.5.0',
      renameWaitsMs: [0, 0],
      // The earlier copy steps aside; after that nothing moves.
      rename: async (from, to) => {
        if (moved > 0) throw eperm()
        moved += 1
        await fs.rename(from, to)
      }
    })
    const r = await m.install({ path: src, grant: [] })
    expect(r.status).toBe(500)
    const error = body(r).error as string
    expect(error).toMatch(/^EPERM: operation not permitted, rename/)
    expect(error).toMatch(/the earlier copy could not be put back: it is in .*\.retired-@acme\+astera-jira-[0-9a-f]{12}/)
    expect(await fs.readdir(installed())).toEqual([expect.stringMatching(/^\.retired-@acme\+astera-jira-[0-9a-f]{12}$/)])
  })
})

// Final review m3: a Host that stopped half way through a change leaves its working folders behind.
describe('what a Host that stopped half way left behind', () => {
  it('is cleared before the next change: a copy that stepped aside comes back, the rest goes', async () => {
    await manager.install({ path: await plugin(FOLDER), grant: [] })
    await manager.install({ path: await plugin('other', { name: 'astera-other' }), grant: [] })
    // Stopped between the two moves of an update: the only copy of one plugin is in its retired folder.
    await fs.rename(path.join(installed(), '@acme+astera-jira'), path.join(installed(), '.retired-@acme+astera-jira-0123456789ab'))
    // And an older retired copy of a plugin whose new copy did land, and a staging folder.
    await fs.mkdir(path.join(installed(), '.retired-astera-other-ba9876543210'))
    await fs.mkdir(path.join(installed(), '.staging-deadbeef0000', 'dist'), { recursive: true })
    // And a removal that stopped after its record was gone: nothing names that copy any more.
    await fs.mkdir(path.join(installed(), '.retired-astera-gone-111111111111'))
    const next = createPluginManager({ profileDir: profile, hostVersion: '1.5.0' })
    expect(((await next.list()).body as { plugins: { id: string; status: string }[] }).plugins).toEqual([
      expect.objectContaining({ id: '@acme/astera-jira', status: 'stopped' }),
      expect.objectContaining({ id: 'astera-other', status: 'stopped' })
    ])
    expect(await leftovers()).toEqual([])
    expect((await fs.readdir(installed())).sort()).toEqual(['@acme+astera-jira', 'astera-other'])
  })
})

describe('a file system that refuses', () => {
  it('answers 500 with what the system said, instead of throwing at the Host', async () => {
    // A file where the plugins folder belongs: the install cannot make it.
    await fs.writeFile(pluginsRoot(profile), 'not a folder')
    const r = await manager.install({ path: await plugin(FOLDER), grant: [] })
    expect(r.status).toBe(500)
    expect(body(r).error).toEqual(expect.any(String))
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

describe('with a runtime (plugin runtime design P11)', () => {
  /** A runtime that records what it was asked, with a status per id the test sets. */
  const fakeRuntime = () => {
    const calls: string[] = []
    const launches: PluginLaunch[] = []
    const statuses = new Map<string, PluginRunStatus>()
    const runtime: Pick<PluginRuntime, 'start' | 'restart' | 'stop' | 'status'> = {
      start: (p) => {
        calls.push(`start ${p.id}`)
        launches.push(p)
        statuses.set(p.id, { status: 'running', pid: 7 })
      },
      restart: (p) => {
        calls.push(`restart ${p.id}`)
        statuses.set(p.id, { status: 'running', pid: 8 })
      },
      stop: async (id) => {
        calls.push(`stop ${id}`)
        statuses.set(id, { status: 'stopped' })
      },
      status: (id) => statuses.get(id)
    }
    return { runtime, calls, launches, statuses }
  }
  const withRuntime = (rt: ReturnType<typeof fakeRuntime>) =>
    createPluginManager({ profileDir: profile, hostVersion: '1.5.0', runtime: rt.runtime })

  it('starts an enabled, compatible plugin when it is installed, with where it runs and what it was granted', async () => {
    const rt = fakeRuntime()
    const m = withRuntime(rt)
    const r = await m.install({ path: await plugin(FOLDER), grant: ['jobs.read'] })
    expect(rt.calls).toEqual(['start @acme/astera-jira'])
    const dirOf = path.join(installed(), '@acme+astera-jira')
    expect(rt.launches[0]).toEqual({
      id: '@acme/astera-jira',
      version: '1.0.0',
      folder: '@acme+astera-jira',
      dir: dirOf,
      entry: path.join(dirOf, 'dist', 'plugin.js'),
      granted: ['jobs.read']
    })
    expect(r.body).toMatchObject({ status: 'running', pid: 7 })
  })

  it('does not start a plugin this Astera will not run', async () => {
    const rt = fakeRuntime()
    await withRuntime(rt).install({ path: await plugin(FOLDER, { capabilities: ['event'] }), grant: [] })
    expect(rt.calls).toEqual([])
  })

  it('stops a running copy before an update moves its folder, and starts the new one', async () => {
    const rt = fakeRuntime()
    const m = withRuntime(rt)
    const src = await plugin(FOLDER)
    await m.install({ path: src, grant: [] })
    await plugin(FOLDER, { version: '1.1.0' })
    await m.install({ path: src, grant: [] })
    expect(rt.calls).toEqual(['start @acme/astera-jira', 'stop @acme/astera-jira', 'start @acme/astera-jira'])
    expect(rt.launches[1].version).toBe('1.1.0')
  })

  it('starts the earlier copy again when an update fails after stopping it', async () => {
    const rt = fakeRuntime()
    const m = withRuntime(rt)
    const src = await plugin(FOLDER)
    await m.install({ path: src, grant: [] })
    await plugin(FOLDER, { version: '2.0.0' })
    let moved = 0
    const failing = createPluginManager({
      profileDir: profile,
      hostVersion: '1.5.0',
      runtime: rt.runtime,
      renameWaitsMs: [],
      rename: async (from, to) => {
        // The earlier copy steps aside and comes back; the new copy never lands.
        if (moved === 1) {
          moved += 1
          throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
        }
        moved += 1
        await fs.rename(from, to)
      }
    })
    expect((await failing.install({ path: src, grant: [] })).status).toBe(500)
    expect(rt.calls).toEqual(['start @acme/astera-jira', 'stop @acme/astera-jira', 'start @acme/astera-jira'])
    expect(rt.launches[1].version).toBe('1.0.0')
  })

  it('stops on disable, starts on enable, and starts a failed plugin again on enable', async () => {
    const rt = fakeRuntime()
    const m = withRuntime(rt)
    await m.install({ path: await plugin(FOLDER), grant: [] })
    expect(await m.setEnabled('@acme/astera-jira', false)).toMatchObject({ body: { status: 'disabled', changed: true } })
    expect(await m.setEnabled('@acme/astera-jira', true)).toMatchObject({ body: { status: 'running', changed: true } })
    rt.statuses.set('@acme/astera-jira', { status: 'failed', reason: 'activate threw: x' })
    expect(await m.list()).toMatchObject({ body: { plugins: [{ status: 'failed', reason: 'activate threw: x' }] } })
    expect(await m.setEnabled('@acme/astera-jira', true)).toMatchObject({ body: { status: 'running', changed: true } })
    expect(rt.calls).toEqual(['start @acme/astera-jira', 'stop @acme/astera-jira', 'start @acme/astera-jira', 'restart @acme/astera-jira'])
  })

  it('stops a plugin before removing it', async () => {
    const rt = fakeRuntime()
    const m = withRuntime(rt)
    await m.install({ path: await plugin(FOLDER), grant: [] })
    await m.remove('@acme/astera-jira')
    expect(rt.calls).toEqual(['start @acme/astera-jira', 'stop @acme/astera-jira'])
  })

  it('starts every enabled, compatible plugin at the Host’s start', async () => {
    await manager.install({ path: await plugin('a', { name: 'plugin-a' }), grant: [] })
    await manager.install({ path: await plugin('b', { name: 'plugin-b' }), grant: [] })
    await manager.install({ path: await plugin('c', { name: 'plugin-c', capabilities: ['event'] }), grant: [] })
    await manager.setEnabled('plugin-b', false)
    const rt = fakeRuntime()
    await withRuntime(rt).startAll()
    expect(rt.calls).toEqual(['start plugin-a'])
  })

  it('shows a plugin the runtime has not seen as stopped', async () => {
    const rt = fakeRuntime()
    await manager.install({ path: await plugin(FOLDER), grant: [] })
    expect(await withRuntime(rt).list()).toMatchObject({ body: { plugins: [{ status: 'stopped' }] } })
  })
})

describe('logs and doctor', () => {
  const logFile = (folder: string): string => path.join(pluginsRoot(profile), 'logs', `${folder}.log`)

  it('reads the tail of a plugin’s log, the rotated generation first', async () => {
    await manager.install({ path: await plugin(FOLDER), grant: [] })
    expect(await manager.logs('@acme/astera-jira', undefined)).toEqual({
      status: 200,
      body: { id: '@acme/astera-jira', file: logFile('@acme+astera-jira'), lines: [] }
    })
    await fs.mkdir(path.dirname(logFile('@acme+astera-jira')), { recursive: true })
    await fs.writeFile(`${logFile('@acme+astera-jira')}.1`, 'old 1\nold 2\n')
    await fs.writeFile(logFile('@acme+astera-jira'), 'new 1\n\nnew 2\n')
    expect((await manager.logs('@acme/astera-jira', undefined)).body).toMatchObject({ lines: ['old 1', 'old 2', 'new 1', 'new 2'] })
    expect((await manager.logs('@acme/astera-jira', 2)).body).toMatchObject({ lines: ['new 1', 'new 2'] })
    expect((await manager.logs('@acme/astera-jira', '3')).body).toMatchObject({ lines: ['old 2', 'new 1', 'new 2'] })
    for (const bad of [0, 1001, 2.5, 'x', -1])
      expect(await manager.logs('@acme/astera-jira', bad)).toEqual({ status: 400, body: { error: 'plugins-logs --lines must be a whole number from 1 to 1000' } })
    expect((await manager.logs('nope', undefined)).status).toBe(404)
  })

  it('finds nothing wrong with a healthy plugin', async () => {
    await manager.install({ path: await plugin(FOLDER), grant: [] })
    const r = await manager.doctor('@acme/astera-jira')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({
      id: '@acme/astera-jira',
      ok: true,
      checks: [
        { name: 'manifest', ok: true, detail: '@acme/astera-jira 1.0.0, Plugin API 1' },
        { name: 'compatible', ok: true, detail: 'this Astera runs it' },
        { name: 'entry', ok: true, detail: './dist/plugin.js' },
        { name: 'native-addons', ok: true, detail: 'none' },
        { name: 'runtime', ok: true, detail: 'stopped' }
      ]
    })
  })

  it('names a native addon, which a plugin cannot load here', async () => {
    await manager.install({ path: await plugin(FOLDER), grant: [] })
    const addon = path.join(installed(), '@acme+astera-jira', 'node_modules', 'fast-thing', 'build', 'Release')
    await fs.mkdir(addon, { recursive: true })
    await fs.writeFile(path.join(addon, 'fast.node'), '')
    const r = await manager.doctor('@acme/astera-jira')
    expect(r.body).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([
        {
          name: 'native-addons',
          ok: false,
          detail: '1 native addon (node_modules/fast-thing/build/Release/fast.node); plugins run on the Node inside Astera, which cannot load them'
        }
      ])
    })
  })

  it('says why an incompatible plugin and a failed one do not run', async () => {
    await manager.install({ path: await plugin(FOLDER, { capabilities: ['event'] }), grant: [] })
    expect((await manager.doctor('@acme/astera-jira')).body).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([{ name: 'compatible', ok: false, detail: 'this Astera does not run event plugins yet' }])
    })
    const failing = createPluginManager({
      profileDir: profile,
      hostVersion: '1.5.0',
      runtime: { start() {}, restart() {}, stop: async () => {}, status: () => ({ status: 'failed', reason: 'activate threw: x' }) }
    })
    await failing.install({ path: await plugin('other', { name: 'astera-other' }), grant: [] })
    expect((await failing.doctor('astera-other')).body).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([{ name: 'runtime', ok: false, detail: 'failed: activate threw: x' }])
    })
  })

  it('says a disabled plugin is disabled, which is not a fault', async () => {
    await manager.install({ path: await plugin(FOLDER), grant: [] })
    await manager.setEnabled('@acme/astera-jira', false)
    expect((await manager.doctor('@acme/astera-jira')).body).toMatchObject({
      ok: true,
      checks: expect.arrayContaining([{ name: 'runtime', ok: true, detail: 'disabled' }])
    })
  })

  it('reports a copy whose manifest cannot be read, and an unknown id', async () => {
    await manager.install({ path: await plugin(FOLDER), grant: [] })
    await fs.rm(path.join(installed(), '@acme+astera-jira', 'package.json'))
    const r = await manager.doctor('@acme/astera-jira')
    expect(r.body).toMatchObject({ ok: false, checks: [{ name: 'manifest', ok: false, detail: expect.stringMatching(/^no package\.json in /) }] })
    expect((await manager.doctor('nope')).status).toBe(404)
    expect((await manager.doctor(undefined)).status).toBe(400)
  })
})
