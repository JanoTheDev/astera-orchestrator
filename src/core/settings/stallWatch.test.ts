// Stall watchdog: the on/off setting as the app's store and the Host read it.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readStallWatchOn, stallWatchOnOf } from './stallWatch'

describe('stall watch setting', () => {
  it('on unless an explicit false', () => {
    expect(stallWatchOnOf(false)).toBe(false)
    for (const v of [undefined, true, 0, 'false', null]) expect(stallWatchOnOf(v)).toBe(true)
  })

  it('the Host reads the file, and a missing or damaged one is on', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-stall-'))
    const f = path.join(dir, 'app-settings.json')
    expect(await readStallWatchOn(f)).toBe(true)
    writeFileSync(f, JSON.stringify({ stallWatch: false }))
    expect(await readStallWatchOn(f)).toBe(false)
    writeFileSync(f, '{ not json')
    expect(await readStallWatchOn(f)).toBe(true)
  })
})
