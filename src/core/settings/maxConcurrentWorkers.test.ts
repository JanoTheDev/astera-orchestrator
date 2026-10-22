import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_CONCURRENT_WORKERS } from '../orchestration/types'
import { machineSpecs } from './machineSpecs'
import { maxConcurrentWorkersOf, readMaxConcurrentWorkers } from './maxConcurrentWorkers'

describe('maxConcurrentWorkersOf', () => {
  it('clamps to the cap and reads anything else as not set', () => {
    expect(maxConcurrentWorkersOf(7)).toBe(7)
    expect(maxConcurrentWorkersOf(500)).toBe(MAX_CONCURRENT_WORKERS)
    expect(maxConcurrentWorkersOf(0)).toBeNull()
    expect(maxConcurrentWorkersOf('3')).toBeNull()
  })
})

describe('readMaxConcurrentWorkers', () => {
  const file = (body: string | null): string => {
    const p = path.join(mkdtempSync(path.join(os.tmpdir(), 'mcw-')), 'app-settings.json')
    if (body !== null) writeFileSync(p, body)
    return p
  }
  it('returns the saved value', async () => expect(await readMaxConcurrentWorkers(file('{"maxConcurrentWorkers":4}'))).toBe(4))
  it('returns the machine recommendation when not set or the file is missing', async () => {
    const rec = machineSpecs().recommended
    expect(await readMaxConcurrentWorkers(file('{}'))).toBe(rec)
    expect(await readMaxConcurrentWorkers(file(null))).toBe(rec)
  })
})
