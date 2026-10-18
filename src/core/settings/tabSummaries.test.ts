// W9-I: the console-summaries switch as the app's store and the Host read it.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readTabSummaries, tabSummariesOf } from './tabSummaries'

describe('tab summaries setting', () => {
  it('off only for an explicit false', () => {
    expect(tabSummariesOf(false)).toBe(false)
    for (const v of [undefined, true, 0, 'false', null]) expect(tabSummariesOf(v)).toBe(true)
  })

  it('the Host reads the file, and a missing or damaged one is on', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-summaries-'))
    const f = path.join(dir, 'app-settings.json')
    expect(await readTabSummaries(f)).toBe(true)
    writeFileSync(f, JSON.stringify({ tabSummaries: false }))
    expect(await readTabSummaries(f)).toBe(false)
    writeFileSync(f, '{ not json')
    expect(await readTabSummaries(f)).toBe(true)
  })
})
