// The third-party notices file (scripts/gen-licenses.mjs).
import { describe, it, expect } from 'vitest'
import { buildLicenses, licenseName, noticeFiles, noticeText, productionPackages } from './gen-licenses.mjs'

const lock = {
  packages: {
    '': { name: 'astera', version: '1.0.0' },
    'node_modules/a': { version: '1.0.0', license: 'MIT' },
    'node_modules/b/node_modules/a': { version: '1.0.0', license: 'MIT' },
    'node_modules/a2': { name: 'aliased', version: '2.0.0' },
    'node_modules/dev-only': { version: '1.0.0', dev: true, license: 'ISC' },
    'node_modules/opt': { version: '3.0.0', devOptional: true, license: 'ISC' },
    'node_modules/ws': { version: '1.0.0', link: true },
    'node_modules/electron': { version: '41.0.0', dev: true, license: 'MIT' }
  }
}

describe('productionPackages', () => {
  it('keeps production entries once per name@version and drops dev-only, links and the root', () => {
    const got = productionPackages(lock)
    expect(got.map((p) => `${p.name}@${p.version}`)).toEqual(['a@1.0.0', 'aliased@2.0.0', 'opt@3.0.0'])
    expect(got[0].dirs).toEqual(['node_modules/a', 'node_modules/b/node_modules/a'])
  })
})

describe('licenseName', () => {
  it('reads the string, object and array shapes', () => {
    expect(licenseName('MIT')).toBe('MIT')
    expect(licenseName({ type: 'ISC' })).toBe('ISC')
    expect(licenseName([{ type: 'MIT' }, { type: 'Apache-2.0' }])).toBe('(MIT OR Apache-2.0)')
    expect(licenseName(undefined)).toBe('')
  })
})

describe('noticeFiles', () => {
  it('picks license and notice files, license first, and not source files', () => {
    expect(noticeFiles(['index.js', 'NOTICE', 'LICENSE.md', 'license.js', 'COPYING', 'README.md'])).toEqual(['COPYING', 'LICENSE.md', 'NOTICE'])
  })
})

describe('noticeText', () => {
  it('joins the files and normalises line endings; a missing folder is empty', () => {
    const files = { '/p/LICENSE': 'MIT text\r\n', '/p/NOTICE': 'notice' }
    const fs = { list: () => ['NOTICE', 'LICENSE'], read: (f) => files[f] }
    expect(noticeText('/p', fs)).toBe('MIT text\n\n---\n\nnotice')
    expect(noticeText('/gone', { list: () => { throw new Error('ENOENT') } })).toBe('')
  })
})

describe('buildLicenses', () => {
  it('lists packages with text, falls back to package.json for the license, and adds Electron, Chromium and fonts', () => {
    const files = { '/m/node_modules/a/LICENSE': 'A license', '/m/node_modules/a2/package.json': '{"license":"BSD-2-Clause"}', '/m/node_modules/electron/LICENSE': 'E license' }
    const fs = {
      exists: (d) => d.endsWith('/a') || d.endsWith('/a2') || d.endsWith('/electron'),
      read: (f) => files[f],
      list: (d) => Object.keys(files).filter((f) => f.startsWith(`${d}/`) && !f.endsWith('.json')).map((f) => f.slice(d.length + 1))
    }
    const out = buildLicenses({ lock, nodeModulesOf: (k) => `/m/${k}`, fontLicenses: [{ name: 'IBMPlex', text: 'OFL' }], fs })
    const by = Object.fromEntries(out.entries.map((e) => [e.name, e]))
    expect(by.a).toMatchObject({ kind: 'package', version: '1.0.0', license: 'MIT', text: 'A license' })
    expect(by.aliased).toMatchObject({ license: 'BSD-2-Clause', text: '' })
    expect(by.opt).toMatchObject({ license: 'ISC', text: '' })
    expect(by.Electron).toMatchObject({ kind: 'runtime', version: '41.0.0', text: 'E license' })
    expect(by.Chromium.text).toContain('LICENSES.chromium.html')
    expect(by.IBMPlex).toMatchObject({ kind: 'font', license: 'OFL-1.1', text: 'OFL' })
  })
})
