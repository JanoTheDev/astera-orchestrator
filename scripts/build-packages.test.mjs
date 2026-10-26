// The SDK packages build with the repo's own TypeScript into ESM and CommonJS with declarations, and both load in
// plain Node with the same exports. Built into a temp folder whose name has a space (SDK spec §48).
import { describe, it, expect } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildPackage, checkOut, isMain, PACKAGES } from './build-packages.mjs'
import { makeProfile, startHost } from '../packages/client/test/fakeHost.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

describe('build-packages', () => {
  it('lists the client package, then the plugin SDK that names its types', () => {
    expect(PACKAGES).toEqual(['client', 'plugin-sdk'])
  })

  // Plugin runtime design P10: the plugin SDK ships definePlugin and the context types, and names the client's types
  // by package, so a plugin that installs both gets the real AsteraClient.
  it('builds @astera-app/plugin-sdk as ESM and CommonJS, with declarations that import the client by name', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'astera pkg '))
    try {
      const dist = buildPackage('plugin-sdk', out)
      for (const f of ['esm/index.js', 'esm/index.d.ts', 'cjs/index.js', 'cjs/index.d.ts']) expect(existsSync(path.join(dist, f)), f).toBe(true)
      const esm = await import(pathToFileURL(path.join(dist, 'esm', 'index.js')).href)
      const cjs = createRequire(import.meta.url)(path.join(dist, 'cjs', 'index.js'))
      const exported = ['NOTIFICATION_KINDS', 'PLUGIN_API_VERSION', 'defineCompletionCheckProvider', 'defineJobSourceProvider', 'defineNotificationProvider', 'definePlugin']
      expect(Object.keys(esm).sort()).toEqual(exported)
      expect(Object.keys(cjs).filter((k) => k !== '__esModule').sort()).toEqual(exported)
      const def = { activate() {} }
      expect(esm.definePlugin(def)).toBe(def)
      expect(cjs.definePlugin(def)).toBe(def)
      for (const half of ['esm', 'cjs']) {
        const dts = readFileSync(path.join(dist, half, 'index.d.ts'), 'utf8')
        // The client's types by name: the context's client, and the events onEvent is handed (plugin Phase 3)
        expect(dts, half).toMatch(/import type \{ AsteraClient, AsteraEvent, EventGap \} from ['"]@astera-app\/client['"]/)
        // Nothing of the client is copied in, and the run-time half requires nothing.
        expect(readdirSync(path.join(dist, half)).filter((f) => f.endsWith('.js'))).toEqual(['index.js'])
      }
      expect(readFileSync(path.join(dist, 'cjs', 'index.js'), 'utf8')).not.toMatch(/\brequire\(/)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120_000)

  it('builds @astera-app/client as ESM and CommonJS with the same exports and declarations', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'astera pkg '))
    try {
      const dist = buildPackage('client', out)
      for (const f of ['esm/index.js', 'esm/index.d.ts', 'cjs/index.js', 'cjs/index.d.ts']) expect(existsSync(path.join(dist, f)), f).toBe(true)
      const esm = await import(pathToFileURL(path.join(dist, 'esm', 'index.js')).href)
      const cjs = createRequire(import.meta.url)(path.join(dist, 'cjs', 'index.js'))
      expect(Object.keys(esm).sort()).toEqual(Object.keys(cjs).filter((k) => k !== '__esModule').sort())
      expect(esm.EXIT_CODES.NOT_FOUND).toBe(4)
      expect(esm).not.toHaveProperty('ERROR_CODES')
      expect(new cjs.AsteraError('NOT_FOUND', 'x')).toBeInstanceOf(Error)
      // Final review of SDK 1b, Important 4: two copies of the package, one AsteraError
      expect(new cjs.AsteraError('NOT_FOUND', 'x') instanceof esm.AsteraError).toBe(true)
      expect(esm.isAsteraError(new cjs.AsteraError('NOT_FOUND', 'x'))).toBe(true)
      expect(new esm.AsteraError('NOT_FOUND', 'x') instanceof cjs.AsteraError).toBe(true)

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
      expect(run(['--input-type=module', '-e', "import('@astera-app/client').then((m) => console.log(Object.keys(m.EXIT_CODES).length, typeof m.AsteraError, typeof m.createAsteraClient))"])).toBe(`${Object.keys(esm.EXIT_CODES).length} function function`)
      expect(run(['-e', "const m = require('@astera-app/client'); console.log(Object.keys(m.EXIT_CODES).length, typeof m.AsteraError, typeof m.createAsteraClient)"])).toBe(`${Object.keys(esm.EXIT_CODES).length} function function`)
      expect(run(['-e', "console.log(require('@astera-app/client/package.json').name)"])).toBe('@astera-app/client')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  }, 120_000)

  // Final review of SDK 1b, minor 2: a client left open after its calls kept Node (and the Host) up
  it('an idle client does not keep the process alive', async () => {
    const out = mkdtempSync(path.join(os.tmpdir(), 'astera life '))
    const profile = await makeProfile()
    const host = await startHost({ key: profile.key })
    try {
      const dist = buildPackage('client', out)
      const script = path.join(out, 'idle.mjs')
      writeFileSync(
        script,
        [
          `import { createAsteraClient } from ${JSON.stringify(pathToFileURL(path.join(dist, 'esm', 'index.js')).href)}`,
          'const c = await createAsteraClient({ profileDir: process.argv[2], address: process.argv[3] })',
          "await c.call('x-cmd')",
          "console.log('called')",
          '// no close(): the process must end on its own'
        ].join('\n')
      )
      const started = Date.now()
      const said = await new Promise((resolve, reject) =>
        execFile(process.execPath, [script, profile.dir, host.address], { timeout: 10_000 }, (err, stdout) => (err ? reject(err) : resolve(stdout.trim())))
      )
      expect(said).toBe('called')
      expect(Date.now() - started).toBeLessThan(8000)
    } finally {
      await host.close()
      await profile.cleanup()
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
