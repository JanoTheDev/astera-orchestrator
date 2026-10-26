import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  autoLimitsFileIn,
  autoLimitsOf,
  effectiveCap,
  healthFileIn,
  readAutoLimits,
  readChecksAsHeavy,
  readHealthSnapshot,
  resetAutoLimits,
  takeSignalExit,
  updateAutoLimits,
  writeHealthSnapshotSync,
  writeSignalExitSync,
  type AutoLimit,
  type HealthSnapshot
} from './autoLimits'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astera-auto-limits-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const lim = (cap: number): AutoLimit => ({ cap, cause: 'strain', at: '2026-01-01T00:00:00Z', detail: 'lagged' })

describe('autoLimitsOf', () => {
  it('reads anything that is not an object as empty', () => {
    for (const v of [null, undefined, 3, 'x', [], true]) expect(autoLimitsOf(v)).toEqual({ history: [] })
  })
  it('drops invalid parts and keeps valid ones', () => {
    const r = autoLimitsOf({
      workers: lim(2),
      heavy: { ...lim(0) },
      checksAsHeavy: { cause: 'nope', at: 'x' },
      history: [{ at: 'a', what: 'workers', from: 4, to: 2, cause: 'strain', detail: 'd' }, { at: 'b', what: 'bogus' }, 5]
    })
    expect(r.workers?.cap).toBe(2)
    expect(r.heavy).toBeUndefined()
    expect(r.checksAsHeavy).toBeUndefined()
    expect(r.history).toHaveLength(1)
  })
  it('requires whole-number caps >= 1', () => {
    for (const cap of [1.5, -1, 0, '2', NaN]) expect(autoLimitsOf({ workers: { ...lim(1), cap } }).workers).toBeUndefined()
  })
})

describe('effectiveCap', () => {
  it('takes the min and never raises', () => {
    expect(effectiveCap(6, lim(2))).toBe(2)
    expect(effectiveCap(6, lim(9))).toBe(6)
    expect(effectiveCap(6, undefined)).toBe(6)
    expect(effectiveCap(0, undefined)).toBe(1)
  })
})

describe('resetAutoLimits', () => {
  it('clears the limits and records a reset row for each', () => {
    const r = resetAutoLimits({ workers: lim(2), heavy: lim(1), checksAsHeavy: { cause: 'crash', at: 't' }, history: [] }, 'now')
    expect(r.workers).toBeUndefined()
    expect(r.heavy).toBeUndefined()
    expect(r.checksAsHeavy).toBeUndefined()
    expect(r.history.map((h) => [h.what, h.cause])).toEqual([['workers', 'reset'], ['heavy', 'reset'], ['checks', 'reset']])
  })
})

describe('updateAutoLimits / readAutoLimits', () => {
  it('reads a missing or torn file as empty', async () => {
    expect(await readAutoLimits(dir)).toEqual({ history: [] })
    writeFileSync(autoLimitsFileIn(dir), '{torn')
    expect(await readAutoLimits(dir)).toEqual({ history: [] })
  })
  it('writes under a lock, mode 600, and reads back', async () => {
    await updateAutoLimits(dir, (c) => ({ ...c, workers: lim(2) }))
    expect((await readAutoLimits(dir)).workers?.cap).toBe(2)
    if (process.platform === 'linux') expect(statSync(autoLimitsFileIn(dir)).mode & 0o777).toBe(0o600)
  })
  it('serialises concurrent updates', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        updateAutoLimits(dir, (c) => ({ ...c, history: [...c.history, { at: String(i), what: 'workers', from: null, to: 1, cause: 'strain', detail: '' }] }))
      )
    )
    expect((await readAutoLimits(dir)).history).toHaveLength(8)
  })
  it('trims history to the last 20', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ at: String(i), what: 'heavy' as const, from: 2, to: 1, cause: 'calm' as const, detail: '' }))
    const r = await updateAutoLimits(dir, (c) => ({ ...c, history: rows }))
    expect(r.history).toHaveLength(20)
    expect(r.history[19].at).toBe('29')
  })
  it('readChecksAsHeavy follows the flag', async () => {
    expect(await readChecksAsHeavy(dir)).toBe(false)
    await updateAutoLimits(dir, (c) => ({ ...c, checksAsHeavy: { cause: 'oom', at: 't' } }))
    expect(await readChecksAsHeavy(dir)).toBe(true)
  })
})

describe('health snapshot and signal exit', () => {
  const snap: HealthSnapshot = { at: 't', memAvailablePct: 40, load1PerCpu: 0.5, loopDelayP99Ms: 12, strained: false, liveWorkers: 2, liveSessions: 3, heavyRunning: 1, checksRunning: 0 }
  it('round-trips a snapshot at mode 600, and rejects a bad one', async () => {
    expect(await readHealthSnapshot(dir)).toBeNull()
    writeHealthSnapshotSync(dir, snap)
    expect(await readHealthSnapshot(dir)).toEqual(snap)
    if (process.platform === 'linux') expect(statSync(healthFileIn(dir)).mode & 0o777).toBe(0o600)
    writeFileSync(healthFileIn(dir), JSON.stringify({ ...snap, strained: 'yes' }))
    expect(await readHealthSnapshot(dir)).toBeNull()
  })
  it('never throws when the directory cannot be written', () => {
    writeFileSync(path.join(dir, 'host'), 'a file, not a dir')
    expect(() => writeHealthSnapshotSync(dir, snap)).not.toThrow()
    expect(() => writeSignalExitSync(dir, 'SIGTERM')).not.toThrow()
  })
  it('takes the signal marker once', async () => {
    expect(await takeSignalExit(dir)).toBeNull()
    writeSignalExitSync(dir, 'SIGTERM')
    expect(await takeSignalExit(dir)).toBe('SIGTERM')
    expect(await takeSignalExit(dir)).toBeNull()
  })
})
