import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  HEAVY_JOBS_DEFAULT,
  HEAVY_JOBS_MAX,
  autoHeavySlots,
  availableMemoryBytes,
  heavyJobsAtOnceOf,
  heldHeavySlots,
  memAvailableBytesOfMeminfo,
  readHeavyJobsAtOnce
} from './heavyJobs'

const GB = 1024 ** 3
const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-heavy-jobs-'))
const file = path.join(dir, 'app-settings.json')
afterEach(() => rmSync(file, { force: true }))
const autoFile = path.join(dir, 'auto-limits.json')
afterEach(() => rmSync(autoFile, { force: true }))
/** A reading of a Windows machine with this much available (os.freemem injected) and no heavy slot held. */
const win = (gb: number, held = 0) => ({ platform: 'win32' as const, freemem: () => gb * GB, held: () => held })

describe('heavyJobsAtOnceOf', () => {
  it('takes a whole number >= 1, caps it at the max, and reads anything else as not set', () => {
    expect(heavyJobsAtOnceOf(1)).toBe(1)
    expect(heavyJobsAtOnceOf(3)).toBe(3)
    expect(heavyJobsAtOnceOf(99)).toBe(HEAVY_JOBS_MAX)
    for (const v of [0, -1, 1.5, '2', true, null, undefined, NaN]) expect(heavyJobsAtOnceOf(v)).toBeNull()
  })
})

describe('autoHeavySlots', () => {
  it('fits (available - reserve) / per-job and never goes below 1', () => {
    // reserve 9 GB, 8 GB per heavy job
    expect(autoHeavySlots({ availableBytes: 12 * GB, heldSlots: 0 })).toBe(1) // (12-9)/8 = 0
    expect(autoHeavySlots({ availableBytes: 17 * GB, heldSlots: 0 })).toBe(1)
    expect(autoHeavySlots({ availableBytes: 25 * GB, heldSlots: 0 })).toBe(2)
    expect(autoHeavySlots({ availableBytes: 0, heldSlots: 0 })).toBe(1)
  })
  it('counts the held slots back in, so running heavy jobs do not shrink the answer', () => {
    expect(autoHeavySlots({ availableBytes: 17 * GB, heldSlots: 0 })).toBe(1)
    expect(autoHeavySlots({ availableBytes: 17 * GB, heldSlots: 2 })).toBe(3) // 17 + 16 - 9 = 24 -> 3
    expect(autoHeavySlots({ availableBytes: 9 * GB, heldSlots: 2 })).toBe(2)
  })
  it('clamps to HEAVY_JOBS_MAX', () => {
    expect(autoHeavySlots({ availableBytes: 500 * GB, heldSlots: 0 })).toBe(HEAVY_JOBS_MAX)
    expect(autoHeavySlots({ availableBytes: 1 * GB, heldSlots: 50 })).toBe(HEAVY_JOBS_MAX)
  })
  it('takes its own per-job and reserve figures, and answers 1 for unusable numbers', () => {
    expect(autoHeavySlots({ availableBytes: 10 * GB, heldSlots: 0, perJobGb: 1, reservedGb: 4 })).toBe(6)
    expect(autoHeavySlots({ availableBytes: NaN, heldSlots: 0 })).toBe(1)
    expect(autoHeavySlots({ availableBytes: 40 * GB, heldSlots: NaN })).toBe(3)
  })
})

describe('available memory', () => {
  it('reads os.freemem() on Windows', () => {
    expect(availableMemoryBytes({ platform: 'win32', freemem: () => 5 * GB, readMeminfo: () => { throw new Error('no proc on Windows') } })).toBe(5 * GB)
  })
  it('reads MemAvailable from /proc/meminfo on Linux, not MemFree', () => {
    const text = 'MemTotal:       32000000 kB\nMemFree:          500000 kB\nMemAvailable:   20971520 kB\n'
    expect(memAvailableBytesOfMeminfo(text)).toBe(20 * GB)
    expect(availableMemoryBytes({ platform: 'linux', freemem: () => 0.5 * GB, readMeminfo: () => text })).toBe(20 * GB)
  })
  it('falls back to os.freemem() on Linux when /proc/meminfo is unreadable or has no MemAvailable', () => {
    expect(memAvailableBytesOfMeminfo('MemTotal: 1 kB\n')).toBeNull()
    expect(availableMemoryBytes({ platform: 'linux', freemem: () => 3 * GB, readMeminfo: () => 'MemTotal: 1 kB\n' })).toBe(3 * GB)
    expect(availableMemoryBytes({ platform: 'linux', freemem: () => 4 * GB, readMeminfo: () => { throw new Error('EACCES') } })).toBe(4 * GB)
  })
})

describe('heldHeavySlots', () => {
  const lock = path.join(dir, 'held', 'fullsuite.lock')
  it('counts the Windows owner files whose pid is alive (backslash paths included)', () => {
    mkdirSync(path.dirname(lock), { recursive: true })
    writeFileSync(`${lock}.owner`, '101')
    writeFileSync(`${lock.replace(/\.lock$/, '')}.1.lock.owner`, '102')
    writeFileSync(`${lock.replace(/\.lock$/, '')}.2.lock.owner`, '999')
    const alive = (pid: number): boolean => pid !== 999
    expect(heldHeavySlots({ platform: 'win32', lock: lock.replace(/\//g, '\\'), alive })).toBe(2)
    expect(heldHeavySlots({ platform: 'win32', lock: path.join(dir, 'nothing', 'x.lock'), alive })).toBe(0)
  })
  it('counts the live queue tickets elsewhere, at most the limit', () => {
    const q = path.join(dir, 'queue')
    mkdirSync(q, { recursive: true })
    for (const [i, pid] of [1, 2, 3, 4].entries()) writeFileSync(path.join(q, `00${i}.json`), JSON.stringify({ pid, cmd: 'x', cwd: '/', at: i }))
    expect(heldHeavySlots({ platform: 'linux', queueDir: q, alive: (p) => p !== 4 })).toBe(3)
    expect(heldHeavySlots({ platform: 'linux', queueDir: q, alive: () => true, limit: 2 })).toBe(2)
  })
})

describe('readHeavyJobsAtOnce', () => {
  it('is auto when not set, "auto" or no file: sized from available memory (Windows reading)', async () => {
    expect(await readHeavyJobsAtOnce(file, win(25))).toBe(2) // no file
    writeFileSync(file, JSON.stringify({ maxConcurrentWorkers: 25 }))
    expect(await readHeavyJobsAtOnce(file, win(25))).toBe(2)
    expect(await readHeavyJobsAtOnce(file, win(12))).toBe(1)
    writeFileSync(file, JSON.stringify({ heavyJobsAtOnce: 'auto' }))
    expect(await readHeavyJobsAtOnce(file, win(33))).toBe(3)
    expect(await readHeavyJobsAtOnce(file, win(17, 2))).toBe(3) // held slots counted back in
  })
  it('sizes from MemAvailable on a Linux reading', async () => {
    const meminfo = 'MemTotal: 33554432 kB\nMemFree: 1000 kB\nMemAvailable: 26214400 kB\n' // 25 GB
    expect(await readHeavyJobsAtOnce(file, { platform: 'linux', readMeminfo: () => meminfo, freemem: () => 0, held: () => 0 })).toBe(2)
  })
  it('uses the number the owner set as is, whatever the memory', async () => {
    writeFileSync(file, JSON.stringify({ heavyJobsAtOnce: 4 }))
    expect(await readHeavyJobsAtOnce(file, win(1))).toBe(4)
    writeFileSync(file, JSON.stringify({ heavyJobsAtOnce: 99 }))
    expect(await readHeavyJobsAtOnce(file, win(500))).toBe(HEAVY_JOBS_MAX)
  })
  it('reads an invalid number and an unreadable or broken file as the default 1', async () => {
    expect(HEAVY_JOBS_DEFAULT).toBe(1)
    writeFileSync(file, JSON.stringify({ heavyJobsAtOnce: 0 }))
    expect(await readHeavyJobsAtOnce(file, win(500))).toBe(1)
    writeFileSync(file, '{broken')
    expect(await readHeavyJobsAtOnce(file, win(500))).toBe(1)
    expect(await readHeavyJobsAtOnce(dir, win(500))).toBe(1)
  })
})

describe('readHeavyJobsAtOnce with an auto-limit', () => {
  it('lowers a number, never raises it', async () => {
    writeFileSync(file, JSON.stringify({ heavyJobsAtOnce: 4 }))
    writeFileSync(autoFile, JSON.stringify({ heavy: { cap: 2, cause: 'strain', at: 't', detail: 'd' } }))
    expect(await readHeavyJobsAtOnce(file, win(500))).toBe(2)
    writeFileSync(autoFile, JSON.stringify({ heavy: { cap: 9, cause: 'strain', at: 't', detail: 'd' } }))
    expect(await readHeavyJobsAtOnce(file, win(500))).toBe(4)
  })
  it('lowers the auto value too', async () => {
    writeFileSync(file, JSON.stringify({}))
    writeFileSync(autoFile, JSON.stringify({ heavy: { cap: 1, cause: 'strain', at: 't', detail: 'd' } }))
    expect(await readHeavyJobsAtOnce(file, win(100))).toBe(1)
    writeFileSync(autoFile, JSON.stringify({ heavy: { cap: 5, cause: 'strain', at: 't', detail: 'd' } }))
    expect(await readHeavyJobsAtOnce(file, win(100))).toBe(5)
  })
})
