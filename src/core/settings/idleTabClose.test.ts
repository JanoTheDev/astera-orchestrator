// Idle tabs: the minutes an Astera-started tab with nothing left to do may idle, as the app's store and the Host read them.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { IDLE_TAB_CLOSE_DEFAULT_MINUTES, idleTabCloseMinutesOf, readIdleTabCloseMinutes } from './idleTabClose'

describe('idleTabCloseMinutes', () => {
  it('a number of minutes within 1-60, rounded; anything else is the default of 1', () => {
    expect(IDLE_TAB_CLOSE_DEFAULT_MINUTES).toBe(1)
    expect(idleTabCloseMinutesOf(5)).toBe(5)
    expect(idleTabCloseMinutesOf(12.4)).toBe(12)
    expect(idleTabCloseMinutesOf(0)).toBe(1)
    expect(idleTabCloseMinutesOf(500)).toBe(60)
    for (const v of [undefined, null, NaN, Infinity, '5', true, {}]) expect(idleTabCloseMinutesOf(v)).toBe(1)
  })

  it('the Host reads the file, and a missing or damaged one is the default', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-idle-tabs-'))
    const f = path.join(dir, 'app-settings.json')
    expect(await readIdleTabCloseMinutes(f)).toBe(1)
    writeFileSync(f, JSON.stringify({ idleTabCloseMinutes: 3 }))
    expect(await readIdleTabCloseMinutes(f)).toBe(3)
    writeFileSync(f, '{ not json')
    expect(await readIdleTabCloseMinutes(f)).toBe(1)
  })
})
