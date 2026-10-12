// The SDK packages build with the repo's own TypeScript into ESM and CommonJS with declarations, and both load in
// plain Node with the same exports. Built into a temp folder whose name has a space (SDK spec §48).
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { buildPackage, PACKAGES } from './build-packages.mjs'

describe('build-packages', () => {
  it('lists the client package', () => {
    expect(PACKAGES).toContain('client')
  })

  it('builds @astera-app/client as ESM and CommonJS with the same exports and declarations', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'astera pkg '))
    try {
      const dist = buildPackage('client', out)
      for (const f of ['esm/index.js', 'esm/index.d.ts', 'cjs/index.js', 'cjs/index.d.ts']) expect(existsSync(path.join(dist, f)), f).toBe(true)
      const esm = await import(pathToFileURL(path.join(dist, 'esm', 'index.js')).href)
      const cjs = createRequire(import.meta.url)(path.join(dist, 'cjs', 'index.js'))
      expect(Object.keys(esm).sort()).toEqual(Object.keys(cjs).filter((k) => k !== '__esModule').sort())
      expect(esm.ERROR_CODES).toContain('NOT_FOUND')
      expect(new cjs.AsteraError('NOT_FOUND', 'x')).toBeInstanceOf(Error)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120_000)
})
