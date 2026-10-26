import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HEAVY_JOBS_DEFAULT, HEAVY_JOBS_MAX, heavyJobsAtOnceOf, readHeavyJobsAtOnce } from './heavyJobs'

const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-heavy-jobs-'))
const file = path.join(dir, 'app-settings.json')
afterEach(() => rmSync(file, { force: true }))
const autoFile = path.join(dir, 'auto-limits.json')
afterEach(() => rmSync(autoFile, { force: true }))

describe('heavyJobsAtOnceOf', () => {
  it('takes a whole number >= 1, caps it at the max, and reads anything else as not set', () => {
    expect(heavyJobsAtOnceOf(1)).toBe(1)
    expect(heavyJobsAtOnceOf(3)).toBe(3)
    expect(heavyJobsAtOnceOf(99)).toBe(HEAVY_JOBS_MAX)
    for (const v of [0, -1, 1.5, '2', true, null, undefined, NaN]) expect(heavyJobsAtOnceOf(v)).toBeNull()
  })
})

describe('readHeavyJobsAtOnce', () => {
  it('reads the setting, and a missing, invalid or unreadable file as the default 1', async () => {
    expect(HEAVY_JOBS_DEFAULT).toBe(1)
    expect(await readHeavyJobsAtOnce(file)).toBe(1)
    writeFileSync(file, JSON.stringify({ heavyJobsAtOnce: 4 }))
    expect(await readHeavyJobsAtOnce(file)).toBe(4)
    writeFileSync(file, JSON.stringify({ heavyJobsAtOnce: 0 }))
    expect(await readHeavyJobsAtOnce(file)).toBe(1)
    writeFileSync(file, '{broken')
    expect(await readHeavyJobsAtOnce(file)).toBe(1)
    expect(await readHeavyJobsAtOnce(dir)).toBe(1)
  })
})

describe('readHeavyJobsAtOnce with an auto-limit', () => {
  it('lowers the read, never raises it', async () => {
    writeFileSync(file, JSON.stringify({ heavyJobsAtOnce: 4 }))
    writeFileSync(autoFile, JSON.stringify({ heavy: { cap: 2, cause: 'strain', at: 't', detail: 'd' } }))
    expect(await readHeavyJobsAtOnce(file)).toBe(2)
    writeFileSync(autoFile, JSON.stringify({ heavy: { cap: 9, cause: 'strain', at: 't', detail: 'd' } }))
    expect(await readHeavyJobsAtOnce(file)).toBe(4)
  })
})
