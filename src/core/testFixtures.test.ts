// A test's fixture folder removed without turning the test red (load-sensitive tests, 2026-10-14): on Windows a process
// the test started, or the indexer, can hold a handle a moment longer than the retries waited, and `rm` failed with
// EBUSY, ENOTEMPTY or EPERM after the test itself had passed. Those are left to the sweeper (vitest.globalSetup.ts),
// which removes stale `astera-` fixtures at the next run; any other error still fails.
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { removeFixture, removeFixtureSync } from './testFixtures'

const fixture = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-fixture-test-'))
  writeFileSync(path.join(dir, 'a.txt'), 'a')
  return dir
}
const failing = (code: string) => async (): Promise<void> => {
  throw Object.assign(new Error(`${code}: held`), { code })
}

describe('removeFixture', () => {
  it('removes the folder', async () => {
    const dir = fixture()
    await removeFixture(dir)
    expect(existsSync(dir)).toBe(false)
    const other = fixture()
    removeFixtureSync(other)
    expect(existsSync(other)).toBe(false)
  })

  it('retries for longer than the old 5 x 20 ms', async () => {
    const seen: unknown[] = []
    await removeFixture(path.join(os.tmpdir(), 'astera-x'), async (_p, o) => void seen.push(o))
    expect(seen).toEqual([{ recursive: true, force: true, maxRetries: 10, retryDelay: 100 }])
  })

  it('leaves a held astera fixture to the sweeper', async () => {
    for (const code of ['EBUSY', 'ENOTEMPTY', 'EPERM'])
      await expect(removeFixture(path.join(os.tmpdir(), 'astera-held-x'), failing(code)), code).resolves.toBeUndefined()
  })

  it('still fails on any other error, and on a folder the sweeper would not take', async () => {
    await expect(removeFixture(path.join(os.tmpdir(), 'astera-x'), failing('EACCES'))).rejects.toThrow('EACCES')
    await expect(removeFixture(path.join(os.tmpdir(), 'mine-x'), failing('EBUSY'))).rejects.toThrow('EBUSY')
  })
})
