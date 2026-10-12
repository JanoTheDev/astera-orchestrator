// The SDK packages build with the repo's own TypeScript into ESM and CommonJS with declarations, and both load in
// plain Node with the same exports. Built into a temp folder whose name has a space (SDK spec §48).
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildPackage, checkOut, isMain, PACKAGES } from './build-packages.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

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

      // Final review of SDK 1a, Important 1: tsc turns every import, static or dynamic, into a require in the
      // CommonJS half, so this is the fence nothing in the source can slip past
      const required = readdirSync(path.join(dist, 'cjs'))
        .filter((f) => f.endsWith('.js'))
        .flatMap((f) => [...readFileSync(path.join(dist, 'cjs', f), 'utf8').matchAll(/\brequire\(\s*([^)]*)\)/g)].map((m) => `${f}: ${m[1]}`))
      const bad = required.filter((r) => !/: "(\.\/[\w.-]+\.js|node:(?!sqlite")[\w/]+)"$/.test(r))
      expect(bad).toEqual([])

      // Minor 7: loaded by its name, through the package.json exports map, the way a consumer does
      const consumer = path.join(out, 'consumer')
      const installed = path.join(consumer, 'node_modules', '@astera-app', 'client')
      mkdirSync(installed, { recursive: true })
      cpSync(path.join(root, 'packages', 'client', 'package.json'), path.join(installed, 'package.json'))
      cpSync(dist, path.join(installed, 'dist'), { recursive: true })
      const run = (args) => execFileSync(process.execPath, args, { cwd: consumer, encoding: 'utf8' }).trim()
      expect(run(['--input-type=module', '-e', "import('@astera-app/client').then((m) => console.log(m.ERROR_CODES.length, typeof m.AsteraError, typeof m.createAsteraClient))"])).toBe(`${esm.ERROR_CODES.length} function function`)
      expect(run(['-e', "const m = require('@astera-app/client'); console.log(m.ERROR_CODES.length, typeof m.AsteraError, typeof m.createAsteraClient)"])).toBe(`${esm.ERROR_CODES.length} function function`)
      expect(run(['-e', "console.log(require('@astera-app/client/package.json').name)"])).toBe('@astera-app/client')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120_000)

  // Minor 3: `--out packages` once meant rmSync on the package's own sources
  it('refuses an output folder that is the package or holds it', () => {
    const pkg = path.join(root, 'packages', 'client')
    expect(() => checkOut(pkg, pkg)).toThrow(/sources/)
    expect(() => checkOut(path.join(root, 'packages'), pkg)).toThrow(/sources/)
    expect(() => checkOut(root, pkg)).toThrow(/sources/)
    expect(() => checkOut(path.join(pkg, 'dist'), pkg)).not.toThrow()
    expect(() => checkOut(path.join(os.tmpdir(), 'x', 'client'), pkg)).not.toThrow()
  })

  // Minor 3: run through a junction or a symlink, the script used to build nothing and exit 0
  it('knows it is the script it was started as, through a link too', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'astera link '))
    try {
      const link = path.join(tmp, 'scripts')
      symlinkSync(here, link, 'junction')
      const self = pathToFileURL(path.join(here, 'build-packages.mjs')).href
      expect(isMain(path.join(link, 'build-packages.mjs'), self)).toBe(true)
      expect(isMain(path.join(here, 'build-packages.mjs'), self)).toBe(true)
      expect(isMain(path.join(here, 'host-runtime.mjs'), self)).toBe(false)
      expect(isMain(undefined, self)).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
