import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LAST_GOOD_SUFFIX, readLastGood, readWhole, writeDurably } from './plan'
import { OrchestrationStore } from '../orchestration/store'
import { emptyState } from '../orchestration/state'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-state-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('writeDurably', () => {
  it('replaces the file whole and keeps the version before as the last good copy', async () => {
    const file = path.join(dir, 'orchestration.json')
    await writeDurably(file, '{"v":1}')
    await writeDurably(file, '{"v":2}')
    expect(await fs.readFile(file, 'utf8')).toBe('{"v":2}')
    expect(await readLastGood(file)).toEqual({ v: 1 })
    // No temp file is left behind.
    expect((await fs.readdir(dir)).sort()).toEqual(['orchestration.json', `orchestration.json${LAST_GOOD_SUFFIX}`])
  })
})

describe('a crash mid-write never leaves a broken orchestration.json', () => {
  it('a write that dies before its rename leaves the old file whole', async () => {
    const file = path.join(dir, 'orchestration.json')
    const store = new OrchestrationStore(file)
    await store.load()
    const s1 = { ...emptyState(), messages: [] }
    await store.save(s1)
    // The crash: a temp file half written, never renamed.
    await fs.writeFile(`${file}.dead.tmp`, '{"runs":[{"id":')
    const next = new OrchestrationStore(file)
    expect((await next.load()).recovered).toBe(false)
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(s1)))
  })

  it('a file that still comes back torn is answered from the last good copy, not started empty', async () => {
    const file = path.join(dir, 'orchestration.json')
    const store = new OrchestrationStore(file)
    await store.load()
    const good = { ...emptyState(), projects: [{ id: 'prj_1', name: 'p', path: dir, createdAt: 'x' }] } as never
    await store.save(good)
    await store.save({ ...emptyState() })
    // The disk lied about the flush: the newest file is torn.
    await fs.writeFile(file, '{"runs":[{"id":')
    const next = new OrchestrationStore(file)
    const r = await next.load()
    expect(r.recovered).toBe(false)
    expect(next.get().projects).toHaveLength(1)
    // The torn file is kept for a person to look at.
    expect(await fs.readFile(file + '.bak', 'utf8')).toBe('{"runs":[{"id":')
  })
})

// 2026-11-15: a 16 MB state written through `writeFile` was 33 requests in libuv's pool, each waiting its turn behind
// whatever else held the pool, and state-put ran past the app's 15 s. A big state is one request each way now.
describe('a big state is one pool request to write and one to read', () => {
  it('writes and reads 4 MB with a single write and a single read', async () => {
    const file = path.join(dir, 'orchestration.json')
    const probe = await fs.open(path.join(dir, 'probe'), 'w')
    const handle = Object.getPrototypeOf(probe) as { write: () => unknown; read: () => unknown; writeFile: () => unknown }
    await probe.close()
    const writes = vi.spyOn(handle, 'write')
    const writeFiles = vi.spyOn(handle, 'writeFile')
    const reads = vi.spyOn(handle, 'read')
    const text = JSON.stringify({ tasks: Array.from({ length: 4000 }, (_, i) => ({ id: `tsk_${i}`, prompt: 'é'.repeat(500) })) })
    expect(Buffer.byteLength(text)).toBeGreaterThan(4_000_000)
    await writeDurably(file, text)
    expect(writes).toHaveBeenCalledTimes(1)
    expect(writeFiles).not.toHaveBeenCalled()
    expect(await readWhole(file)).toBe(text)
    expect(reads).toHaveBeenCalledTimes(1)
  })

  it('the store sweeps the temp files of writes that died long ago, and leaves a fresh one alone', async () => {
    const file = path.join(dir, 'orchestration.json')
    await fs.writeFile(file, JSON.stringify(emptyState()))
    const old = `${file}.2f6f6e0e.tmp`
    const fresh = `${file}.76f64c1c.tmp`
    await fs.writeFile(old, '{"runs":[')
    await fs.writeFile(fresh, '{"runs":[')
    const hoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await fs.utimes(old, hoursAgo, hoursAgo)
    await new OrchestrationStore(file).load()
    expect((await fs.readdir(dir)).sort()).toEqual(['orchestration.json', 'orchestration.json.76f64c1c.tmp'])
  })
})
