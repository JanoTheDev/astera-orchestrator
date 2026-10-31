import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IpcMain } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readAutoLimits, updateAutoLimits } from '../core/settings/autoLimits'
import type { AgentLimits } from '../core/types'
import { limitKindOf, registerAutoLimitsIpc } from './autoLimitsIpc'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'astera-auto-limits-ipc-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const lim = (cap: number) => ({ cap, cause: 'strain' as const, at: '2026-10-31T11:24:00.000Z', detail: 'memory 6% free' })
const limits: AgentLimits = { person: 25, effective: 9, recommended: 14, memoryPerAgentGb: 1.5, minUnderPressure: { value: 13, isDefault: true } }

function register(): { call: (channel: string, ...args: unknown[]) => Promise<unknown>; min: { value: number | null } } {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  const ipcMain = { handle: (c: string, fn: (...a: unknown[]) => unknown) => handlers.set(c, fn) } as unknown as IpcMain
  const min = { value: null as number | null }
  registerAutoLimitsIpc(ipcMain, {
    profileDir: dir,
    agentLimits: () => limits,
    getMinWorkers: () => min.value,
    setMinWorkers: async (n) => {
      min.value = n
    }
  })
  return { call: async (c, ...a) => handlers.get(c)!({}, ...a), min }
}

describe('settings.restoreAutoLimit', () => {
  it('clears only the named limit and writes a reset history row', async () => {
    await updateAutoLimits(dir, (c) => ({ ...c, workers: lim(9), heavy: lim(1) }))
    const { call } = register()
    await call('settings.restoreAutoLimit', 'workers')
    const after = await readAutoLimits(dir)
    expect(after.workers).toBeUndefined()
    expect(after.heavy?.cap).toBe(1)
    expect(after.history).toHaveLength(1)
    expect(after.history[0]).toMatchObject({ what: 'workers', from: 9, to: null, cause: 'reset' })
  })

  it('rejects a name that is not a limit and leaves the file alone', async () => {
    await updateAutoLimits(dir, (c) => ({ ...c, workers: lim(9) }))
    const { call } = register()
    await expect(call('settings.restoreAutoLimit', 'everything')).rejects.toThrow()
    expect((await readAutoLimits(dir)).workers?.cap).toBe(9)
  })

  it('keeps the all-reset, which clears every limit', async () => {
    await updateAutoLimits(dir, (c) => ({ ...c, workers: lim(9), heavy: lim(1) }))
    await register().call('settings.restoreAutoLimits')
    const after = await readAutoLimits(dir)
    expect(after.workers).toBeUndefined()
    expect(after.heavy).toBeUndefined()
  })
})

describe('settings.agentLimits and the minimum', () => {
  it('answers the limits and passes the minimum through, a non-number as empty', async () => {
    const { call, min } = register()
    expect(await call('settings.agentLimits')).toBe(limits)
    await call('settings.setMinWorkersUnderPressure', 6)
    expect(await call('settings.getMinWorkersUnderPressure')).toBe(6)
    await call('settings.setMinWorkersUnderPressure', '7')
    expect(min.value).toBeNull()
  })
  it('names the three limits only', () => {
    expect(['workers', 'heavy', 'checks', 'x', 3].map(limitKindOf)).toEqual(['workers', 'heavy', 'checks', null, null])
  })
})
