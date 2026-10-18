// Coordinator rotation: the context threshold as the app's store and the Host read it.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FRESH_COORDINATOR_DEFAULT_PCT, freshCoordinatorPctOf, readFreshCoordinatorPct } from './freshCoordinator'

describe('fresh coordinator pct', () => {
  it('a whole number from 0 to 100, else the default', () => {
    expect(freshCoordinatorPctOf(0)).toBe(0)
    expect(freshCoordinatorPctOf(60)).toBe(60)
    for (const v of [undefined, -1, 1.5, "30", 101]) expect(freshCoordinatorPctOf(v)).toBe(FRESH_COORDINATOR_DEFAULT_PCT)
  })

  it('the Host reads the file, and a missing or damaged one is the default', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-digest-'))
    const f = path.join(dir, 'app-settings.json')
    expect(await readFreshCoordinatorPct(f)).toBe(FRESH_COORDINATOR_DEFAULT_PCT)
    writeFileSync(f, JSON.stringify({ freshCoordinatorContextPct: 5 }))
    expect(await readFreshCoordinatorPct(f)).toBe(5)
    writeFileSync(f, '{ not json')
    expect(await readFreshCoordinatorPct(f)).toBe(FRESH_COORDINATOR_DEFAULT_PCT)
  })
})
