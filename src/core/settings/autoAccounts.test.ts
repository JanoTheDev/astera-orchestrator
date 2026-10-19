// T2: the automatic-accounts switch as the Host reads it.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { autoAccountsOnOf, readAutoAccountsOn } from './autoAccounts'

describe('auto accounts setting', () => {
  it('on unless an explicit false', () => {
    expect(autoAccountsOnOf(false)).toBe(false)
    for (const v of [undefined, true, 0, 'false', null]) expect(autoAccountsOnOf(v)).toBe(true)
  })

  it('the Host reads the file, and a missing or damaged one is on', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-auto-accounts-'))
    const f = path.join(dir, 'app-settings.json')
    expect(await readAutoAccountsOn(f)).toBe(true)
    writeFileSync(f, JSON.stringify({ autoAccounts: false }))
    expect(await readAutoAccountsOn(f)).toBe(false)
    writeFileSync(f, '{ not json')
    expect(await readAutoAccountsOn(f)).toBe(true)
  })
})
