import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LAST_GOOD_SUFFIX, readLastGood, writeDurably } from './plan'
import { OrchestrationStore } from '../orchestration/store'
import { emptyState } from '../orchestration/state'

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-state-'))
})
afterEach(async () => {
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
