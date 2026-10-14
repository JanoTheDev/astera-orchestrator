// The person's own npm against a registry served in the test (plugins 2e, design P14): `npm pack` fetches a plugin
// through cmd.exe on Windows with its spec quoted, the Host extracts it, and `npm install` puts its one dependency in
// the plugin's own node_modules without running the dependency's install script. Skipped where npm is not installed.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { removeFixture } from '../../core/testFixtures'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { NpmMissing, createNpm, createNpmRunner, installDependencies, npmEnv, packAndExtract, type NpmRun } from './npm'
import { pax, tgzOf, type Entry } from './tarballFixture'

const hasNpm = spawnSync('npm --version', { shell: true, encoding: 'utf8' }).status === 0

let dir: string
let server: http.Server
let registry: string
/** npm itself, packed from the npm installed on this machine, served as Astera's own npm would be fetched. */
let ownNpm: Buffer | null = null
const MARKER = path.join(os.tmpdir(), `astera-npm-postinstall-${process.pid}.txt`)
const PWNED = path.join(os.tmpdir(), `astera-npm-pwned-${process.pid}.txt`)

/** A packument and its tarball, as the registry answers them. */
function pkg(name: string, version: string, json: Record<string, unknown>, files: Record<string, string>) {
  const tgz = tgzOf([
    { name: 'package/package.json', body: JSON.stringify({ name, version, ...json }) },
    ...Object.entries(files).map(([f, body]) => ({ name: `package/${f}`, body }))
  ])
  const file = `${name.replace('/', '-').replace('@', '')}-${version}.tgz`
  return {
    name,
    tgz,
    file,
    packument: (base: string) => ({
      name,
      'dist-tags': { latest: version },
      versions: {
        [version]: {
          name,
          version,
          ...json,
          dist: {
            tarball: `${base}tarballs/${file}`,
            integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}`,
            shasum: createHash('sha1').update(tgz).digest('hex')
          }
        }
      }
    })
  }
}

const PACKAGES = [
  pkg(
    '@smoke/hello',
    '1.0.0',
    { dependencies: { 'tiny-dep': '^1.0.0' }, devDependencies: { 'never-installed': '1.0.0' }, astera: { apiVersion: '1', entry: 'index.mjs' } },
    { 'index.mjs': "import dep from 'tiny-dep'\nexport default { activate() { return dep } }\n" }
  ),
  // 2e final review I1: a package that ships an npm.cmd and a git.cmd of its own, and an .npmrc that points npm at a
  // registry that does not answer. None of them may be run or read.
  pkg(
    '@smoke/sly',
    '1.0.0',
    { dependencies: { 'tiny-dep': '^1.0.0' }, astera: { apiVersion: '1', entry: 'index.mjs' } },
    {
      'index.mjs': 'export default {}\n',
      'npm.cmd': `@echo off\r\necho pwned> "${PWNED}"\r\nexit /b 1\r\n`,
      'git.cmd': `@echo off\r\necho pwned> "${PWNED}"\r\nexit /b 1\r\n`,
      '.npmrc': 'registry=http://127.0.0.1:9/\n'
    }
  ),
  pkg(
    'tiny-dep',
    '1.2.0',
    { main: 'index.js', scripts: { postinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(MARKER)}, 'ran')"` } },
    { 'index.js': "module.exports = 'tiny'\n" }
  )
]

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-npm 플러그인 '))
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '')
    const base = registry
    if (url === '/own/npm.tgz' && ownNpm) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      return void res.end(ownNpm)
    }
    for (const p of PACKAGES) {
      if (url === `/${p.name}`) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return void res.end(JSON.stringify(p.packument(base)))
      }
      if (url === `/tarballs/${p.file}`) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        return void res.end(p.tgz)
      }
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end('{"error":"not found"}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
}, 30_000)
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await removeFixture(dir)
  await fs.rm(MARKER, { force: true })
  await fs.rm(PWNED, { force: true })
})

describe.skipIf(!hasNpm)('npm against a registry of the test', () => {
  const run = () =>
    createNpmRunner({
      env: {
        ...npmEnv(process.env),
        npm_config_registry: registry,
        npm_config_cache: path.join(dir, 'cache'),
        npm_config_userconfig: path.join(dir, 'npmrc'),
        npm_config_globalconfig: path.join(dir, 'npmrc-global')
      }
    })

  it('fetches a plugin by a spec with a range, and installs its dependency without its install script or the dev ones', async () => {
    const staging = path.join(dir, 'stage 1')
    await fs.mkdir(staging, { recursive: true })
    const got = await packAndExtract('@smoke/hello@^1.0.0', staging, run())
    expect(got).toMatchObject({ name: '@smoke/hello', version: '1.0.0' })
    expect(got.folder).toBe(path.join(staging, 'package'))
    expect(JSON.parse(await fs.readFile(path.join(got.folder, 'package.json'), 'utf8'))).toMatchObject({ name: '@smoke/hello' })
    await installDependencies(got.folder, staging, run())
    expect(await fs.readFile(path.join(got.folder, 'node_modules', 'tiny-dep', 'index.js'), 'utf8')).toBe("module.exports = 'tiny'\n")
    expect(existsSync(path.join(got.folder, 'node_modules', 'never-installed'))).toBe(false)
    expect(existsSync(path.join(got.folder, 'node_modules', '.bin'))).toBe(false)
    expect(existsSync(MARKER)).toBe(false)
  }, 120_000)

  // Without NoDefaultCurrentDirectoryInExePath, as a Host started from Explorer has it: cmd.exe would look in the
  // current folder for npm first.
  it('runs nothing the package ships and reads no .npmrc of its, even where cmd.exe looks in the current folder', async () => {
    const staging = path.join(dir, 'stage sly')
    await fs.mkdir(staging, { recursive: true })
    const env: NodeJS.ProcessEnv = { ...npmEnv(process.env), npm_config_registry: registry, npm_config_cache: path.join(dir, 'cache'), npm_config_userconfig: path.join(dir, 'npmrc'), npm_config_globalconfig: path.join(dir, 'npmrc-global') }
    // Under whatever case the environment block spells it.
    for (const k of Object.keys(env)) if (k.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[k]
    const loose = createNpmRunner({ env })
    const got = await packAndExtract('@smoke/sly', staging, loose)
    expect(await installDependencies(got.folder, staging, loose)).toBe(true)
    expect(await fs.readFile(path.join(got.folder, 'node_modules', 'tiny-dep', 'index.js'), 'utf8')).toBe("module.exports = 'tiny'\n")
    expect(existsSync(PWNED)).toBe(false)
  }, 120_000)

  // Plugins 2e-2: no npm on this computer, so Astera fetches its own (here the machine's npm, packed and served by the
  // test's registry, as registry.npmjs.org serves npm 11.21.0) and runs it on its own Node, with no shell.
  it('installs through its own npm where the person has none', async () => {
    // The npm folder whole, its node_modules with it, as the registry's npm tarball holds them (`npm pack` of an
    // installed npm leaves them out). Packed here, a path longer than a tar header holds in a pax record before it:
    // Windows' tar.exe, which this used, failed on GitHub's Windows runner without a word.
    // The npm installed with the Node running the tests: `npm root -g` names the configured global prefix, which a CI
    // runner sets apart from it (C:\npm\prefix on GitHub's Windows runners)
    const root =
      process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules') : path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules')
    const version = (JSON.parse(await fs.readFile(path.join(root, 'npm', 'package.json'), 'utf8')) as { version: string }).version
    const entries: Entry[] = []
    for (const rel of (await fs.readdir(path.join(root, 'npm'), { recursive: true })).sort()) {
      const full = path.join(root, 'npm', rel)
      if (!(await fs.lstat(full)).isFile()) continue
      const name = `npm/${rel.split(path.sep).join('/')}`
      if (Buffer.byteLength(name) > 100) entries.push({ name: 'PaxHeader', type: 'x', body: pax({ path: name }) })
      entries.push({ name, body: await fs.readFile(full) })
    }
    expect(entries.length).toBeGreaterThan(1000)
    ownNpm = tgzOf(entries)
    let systemCalls = 0
    const none: NpmRun = async () => {
      systemCalls++
      throw new NpmMissing()
    }
    const profile = path.join(dir, 'own profile')
    const npm = createNpm({
      profileDir: profile,
      env: { ...process.env, npm_config_registry: registry, npm_config_cache: path.join(dir, 'cache'), npm_config_userconfig: path.join(dir, 'npmrc') },
      node: process.execPath,
      pinned: { version, integrity: `sha512-${createHash('sha512').update(ownNpm).digest('base64')}`, url: `${registry}own/npm.tgz` },
      system: Object.assign(none, { stopAll: () => {} })
    })
    const staging = path.join(dir, 'stage own')
    await fs.mkdir(staging, { recursive: true })
    const got = await packAndExtract('@smoke/hello@^1.0.0', staging, npm)
    expect(await installDependencies(got.folder, staging, npm)).toBe(true)
    expect(await fs.readFile(path.join(got.folder, 'node_modules', 'tiny-dep', 'index.js'), 'utf8')).toBe("module.exports = 'tiny'\n")
    expect(systemCalls).toBe(1)
    expect(existsSync(path.join(profile, 'plugins', 'npm', version, 'bin', 'npm-cli.js'))).toBe(true)
  }, 180_000)

  it('says why a package cannot be fetched, with npm’s last lines', async () => {
    const staging = path.join(dir, 'stage 2')
    await fs.mkdir(staging, { recursive: true })
    const e = await packAndExtract('@smoke/nowhere@1.0.0', staging, run()).catch((err: unknown) => err)
    expect((e as Error).message).toMatch(/^npm could not fetch @smoke\/nowhere@1\.0\.0: /)
    expect((e as Error).message).toMatch(/404|E404|not found/i)
  }, 120_000)
})
