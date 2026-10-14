// A test's fixture folder removed without turning the test red (load-sensitive tests, 2026-10-14): on Windows a process
// the test started, or the indexer, can hold a handle a moment longer than the retries waited, and `rm` failed with
// EBUSY, ENOTEMPTY or EPERM after the test itself had passed. Those are left to the sweeper (vitest.globalSetup.ts),
// and only for a folder the sweeper takes; any other error still fails.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removeFixture } from './testFixtures'

const fixture = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-fixture-test-'))
  writeFileSync(path.join(dir, 'a.txt'), 'a')
  return dir
}
const failing = (code: string) => async (): Promise<void> => {
  throw Object.assign(new Error(`${code}: held`), { code })
}
afterEach(() => {
  vi.restoreAllMocks()
})

describe('removeFixture', () => {
  it('removes the folder', async () => {
    const dir = fixture()
    await removeFixture(dir)
    expect(existsSync(dir)).toBe(false)
  })

  it('retries with fs.promises.rm, whose retries back off over about 5 s', async () => {
    const seen: unknown[] = []
    await removeFixture(path.join(os.tmpdir(), 'astera-x'), async (_p, o) => void seen.push(o))
    expect(seen).toEqual([{ recursive: true, force: true, maxRetries: 10, retryDelay: 100 }])
  })

  // Final review m3: what is left behind is said, since a held fixture can be the only sign of a process a test leaked
  it('leaves a held fixture the sweeper takes to it, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const code of ['EBUSY', 'ENOTEMPTY', 'EPERM'])
      await expect(removeFixture(path.join(os.tmpdir(), 'astera-held-x'), failing(code)), code).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(3)
    expect(String(warn.mock.calls[0][0])).toContain('astera-held-x')
  })

  // Final review m2: the sweeper's own rule decides, so nothing is tolerated that it would never remove
  it('still fails on any other error, and on a folder the sweeper would not take', async () => {
    await expect(removeFixture(path.join(os.tmpdir(), 'astera-x'), failing('EACCES'))).rejects.toThrow('EACCES')
    await expect(removeFixture(path.join(os.tmpdir(), 'mine-x'), failing('EBUSY'))).rejects.toThrow('EBUSY')
    await expect(removeFixture(path.join(os.tmpdir(), 'astera-host-x'), failing('EBUSY'))).rejects.toThrow('EBUSY')
    await expect(removeFixture(path.join(os.tmpdir(), 'astera-a', 'astera-b'), failing('EBUSY'))).rejects.toThrow('EBUSY')
  })
})
