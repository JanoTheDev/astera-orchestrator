import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RegistryUnreadable, pluginsRoot, readRegistry, writeRegistry, type PluginRecord } from './registry'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-plugin-registry-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const record = (over: Partial<PluginRecord> = {}): PluginRecord => ({
  id: '@acme/astera-jira',
  version: '1.0.0',
  folder: '@acme+astera-jira',
  enabled: true,
  granted: ['jobs.read'],
  installedAt: 1_000,
  source: { kind: 'folder', path: path.join(dir, 'src') },
  ...over
})

describe('the plugin registry', () => {
  it('lives in <profile>/plugins', () => {
    expect(pluginsRoot(dir)).toBe(path.join(dir, 'plugins'))
  })

  it('reads as empty before anything was installed', async () => {
    expect(await readRegistry(pluginsRoot(dir))).toEqual([])
  })

  it('reads back what it wrote, as JSON with a version', async () => {
    const root = pluginsRoot(dir)
    await writeRegistry(root, [record(), record({ id: 'astera-webhook', folder: 'astera-webhook', enabled: false, granted: [] })])
    expect(await readRegistry(root)).toEqual([record(), record({ id: 'astera-webhook', folder: 'astera-webhook', enabled: false, granted: [] })])
    const text = await fs.readFile(path.join(root, 'plugins.json'), 'utf8')
    expect(JSON.parse(text)).toMatchObject({ version: 1, plugins: [{ id: '@acme/astera-jira' }, { id: 'astera-webhook' }] })
    // Nothing is left beside it from the write.
    expect(await fs.readdir(root)).toEqual(['plugins.json'])
  })

  it('waits out a scanner that holds plugins.json for longer than a moment', async () => {
    const root = pluginsRoot(dir)
    let refusals = 8
    await writeRegistry(root, [record()], {
      waitsMs: Array<number>(10).fill(0),
      rename: async (from, to) => {
        if (refusals > 0) {
          refusals -= 1
          throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
        }
        await fs.rename(from, to)
      }
    })
    expect(await readRegistry(root)).toEqual([record()])
    expect(refusals).toBe(0)
  })

  it('refuses a file that is not JSON, naming the file and how to repair it', async () => {
    const root = pluginsRoot(dir)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'plugins.json'), '{ broken')
    const read = readRegistry(root)
    await expect(read).rejects.toBeInstanceOf(RegistryUnreadable)
    await expect(readRegistry(root)).rejects.toThrow(path.join(root, 'plugins.json'))
    await expect(readRegistry(root)).rejects.toThrow(/fix it or delete it/)
  })

  it('refuses a record of the wrong shape and a file of another version', async () => {
    const root = pluginsRoot(dir)
    await fs.mkdir(root, { recursive: true })
    const bad: unknown[] = [
      { version: 1, plugins: [{ ...record(), enabled: 'yes' }] },
      { version: 1, plugins: [{ ...record(), granted: 'jobs.read' }] },
      { version: 1, plugins: [{ ...record(), source: { kind: 'npm' } }] },
      { version: 1, plugins: [{ ...record(), folder: '../out' }] },
      { version: 1, plugins: {} },
      { version: 2, plugins: [] },
      []
    ]
    for (const b of bad) {
      await fs.writeFile(path.join(root, 'plugins.json'), JSON.stringify(b))
      await expect(readRegistry(root), JSON.stringify(b)).rejects.toBeInstanceOf(RegistryUnreadable)
    }
  })
})
