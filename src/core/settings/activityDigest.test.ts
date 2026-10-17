// W3-A: the digest interval as the app's store and the Host read it.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ACTIVITY_DIGEST_DEFAULT_MINUTES, activityDigestMinutesOf, readActivityDigestMinutes } from './activityDigest'

describe('activity digest minutes', () => {
  it('a whole number from 0 to a day, else the default', () => {
    expect(activityDigestMinutesOf(0)).toBe(0)
    expect(activityDigestMinutesOf(60)).toBe(60)
    for (const v of [undefined, -1, 1.5, '30', 1441]) expect(activityDigestMinutesOf(v)).toBe(ACTIVITY_DIGEST_DEFAULT_MINUTES)
  })

  it('the Host reads the file, and a missing or damaged one is the default', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-digest-'))
    const f = path.join(dir, 'app-settings.json')
    expect(await readActivityDigestMinutes(f)).toBe(ACTIVITY_DIGEST_DEFAULT_MINUTES)
    writeFileSync(f, JSON.stringify({ activityDigestMinutes: 5 }))
    expect(await readActivityDigestMinutes(f)).toBe(5)
    writeFileSync(f, '{ not json')
    expect(await readActivityDigestMinutes(f)).toBe(ACTIVITY_DIGEST_DEFAULT_MINUTES)
  })
})
