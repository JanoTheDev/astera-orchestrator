import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HOST_RESTART_WHEN_IDLE_FILE, hostRestartWhenIdleOf, readHostRestartWhenIdle, writeHostRestartWhenIdle } from './hostRestartWhenIdle'

describe('Restart the Host when idle setting', () => {
  it('off only for an explicit false', () => {
    expect(hostRestartWhenIdleOf(false)).toBe(false)
    for (const v of [undefined, true, 0, 'false', null]) expect(hostRestartWhenIdleOf(v)).toBe(true)
  })

  it('reads what was written, and a missing or damaged file is on', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-host-restart-'))
    expect(readHostRestartWhenIdle(dir)).toBe(true)
    await writeHostRestartWhenIdle(dir, false)
    expect(readHostRestartWhenIdle(dir)).toBe(false)
    await writeHostRestartWhenIdle(dir, true)
    expect(readHostRestartWhenIdle(dir)).toBe(true)
    writeFileSync(path.join(dir, HOST_RESTART_WHEN_IDLE_FILE), '{ not json')
    expect(readHostRestartWhenIdle(dir)).toBe(true)
    writeFileSync(path.join(dir, HOST_RESTART_WHEN_IDLE_FILE), 'null')
    expect(readHostRestartWhenIdle(dir)).toBe(true)
  })
})
