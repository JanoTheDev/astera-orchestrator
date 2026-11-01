// T12: the silent-worker minutes as the app's store and the Host read them.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WORKER_SILENT_DEFAULT_MINUTES, readWorkerSilentMinutes, workerSilentMinutesOf } from './workerSilentMinutes'

describe('workerSilentMinutes', () => {
  it('a number of minutes within 2-60, rounded; anything else is the default of 8', () => {
    expect(WORKER_SILENT_DEFAULT_MINUTES).toBe(8)
    expect(workerSilentMinutesOf(5)).toBe(5)
    expect(workerSilentMinutesOf(12.4)).toBe(12)
    expect(workerSilentMinutesOf(1)).toBe(2)
    expect(workerSilentMinutesOf(500)).toBe(60)
    for (const v of [undefined, null, NaN, Infinity, '5', true, {}]) expect(workerSilentMinutesOf(v)).toBe(8)
  })

  it('the Host reads the file, and a missing or damaged one is the default', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-silent-'))
    const f = path.join(dir, 'app-settings.json')
    expect(await readWorkerSilentMinutes(f)).toBe(8)
    writeFileSync(f, JSON.stringify({ workerSilentMinutes: 3 }))
    expect(await readWorkerSilentMinutes(f)).toBe(3)
    writeFileSync(f, '{ not json')
    expect(await readWorkerSilentMinutes(f)).toBe(8)
  })
})
