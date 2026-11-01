// Window diagnostic: the on/off setting as the app's store and the Host read it.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readWindowDiagnosticOn, windowDiagnosticOf } from './windowDiagnostic'

describe('window diagnostic setting', () => {
  it('off unless an explicit true', () => {
    expect(windowDiagnosticOf(true)).toBe(true)
    for (const v of [undefined, false, 1, 'true', null, {}]) expect(windowDiagnosticOf(v)).toBe(false)
  })

  it('the Host reads the file, and a missing or damaged one is off', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-windiag-'))
    const f = path.join(dir, 'app-settings.json')
    expect(await readWindowDiagnosticOn(f)).toBe(false)
    writeFileSync(f, JSON.stringify({ windowDiagnostic: true }))
    expect(await readWindowDiagnosticOn(f)).toBe(true)
    writeFileSync(f, '{ not json')
    expect(await readWindowDiagnosticOn(f)).toBe(false)
  })
})
