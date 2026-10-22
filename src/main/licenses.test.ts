import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { licensesFile, parseLicenses, readLicenses } from './licenses'

describe('parseLicenses', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const raw = JSON.stringify({
      entries: [
        { kind: 'package', name: 'a', version: '1.0.0', license: 'MIT', text: 'T' },
        { kind: 'font', name: 'IBMPlex' },
        { kind: 'other', name: 'x' },
        { kind: 'package' },
        null
      ]
    })
    expect(parseLicenses(raw)).toEqual([
      { kind: 'package', name: 'a', version: '1.0.0', license: 'MIT', text: 'T' },
      { kind: 'font', name: 'IBMPlex', version: '', license: '', text: '' }
    ])
  })

  it('is null for text that is not the file', () => {
    expect(parseLicenses('not json')).toBeNull()
    expect(parseLicenses('{"entries":3}')).toBeNull()
  })
})

describe('readLicenses', () => {
  it('reads the file, and is null when it is missing', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'astera-licenses-'))
    writeFileSync(path.join(dir, 'l.json'), '{"entries":[{"kind":"runtime","name":"Chromium"}]}')
    expect(await readLicenses(path.join(dir, 'l.json'))).toHaveLength(1)
    expect(await readLicenses(path.join(dir, 'none.json'))).toBeNull()
  })
})

describe('licensesFile', () => {
  it('is in resources when packaged and in build/ of the checkout otherwise', () => {
    const b = { resourcesPath: '/r', appPath: '/app' }
    expect(licensesFile({ ...b, packaged: true })).toBe(path.join('/r', 'licenses.json'))
    expect(licensesFile({ ...b, packaged: false })).toBe(path.join('/app', 'build', 'licenses.json'))
  })
})
