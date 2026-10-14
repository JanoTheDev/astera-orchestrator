import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { removeFixture } from '../../core/testFixtures'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { spawn as nodeSpawn } from 'node:child_process'
import { NPM_TIMEOUT_MS, NpmFailed, NpmMissing, createNpm, createNpmRunner, installDependencies, locateNpm, npmCommand, npmEnv, npmOutputTail, packAndExtract, type NpmRun, type NpmRunner } from './npm'
import { DOWNLOAD_TOTAL_MS, NpmUnavailable } from './ownNpm'
import { DEFAULT_CHECK_TIMEOUT_MS } from '../../core/orchestration/types'
import { TIMEOUT_HEADROOM_MS } from '../../core/publicContract'
import { tgzOf } from './tarballFixture'

// Plugins 2e (design P14): the person's own npm, by the path found on PATH; on Windows a .cmd is run through cmd.exe
// with every argument quoted. Found on the dev app (2e-2): cmd.exe told "not found" in the system's language, in its
// code page, with exit code 1, so the Host finds npm itself and never asks cmd.exe.
describe('npmCommand', () => {
  const NPM_CMD = 'C:\\Program Files\\nodejs\\npm.cmd'
  it('runs npm.cmd by its full path through cmd.exe, every argument quoted, so ^ and other characters reach npm as written', () => {
    expect(npmCommand(['pack', '@acme/x@^1.0.0', '--json'], 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, { path: NPM_CMD })).toEqual({
      file: 'C:\\Windows\\system32\\cmd.exe',
      // 2e final review I3: no delayed expansion either, whatever the machine's default.
      args: ['/d', '/v:off', '/s', '/c', `""${NPM_CMD}" "pack" "@acme/x@^1.0.0" "--json""`],
      verbatim: true
    })
    expect(npmCommand(['pack', 'x'], 'win32', {}, { path: NPM_CMD }).file).toBe('cmd.exe')
  })

  it('runs an npm.exe, and npm elsewhere, by its path with no shell', () => {
    expect(npmCommand(['pack', 'x'], 'win32', {}, { path: 'C:\\volta\\npm.exe' })).toEqual({ file: 'C:\\volta\\npm.exe', args: ['pack', 'x'], verbatim: false })
    expect(npmCommand(['pack', '@acme/x@^1.0.0'], 'linux', {}, { path: '/usr/bin/npm' })).toEqual({ file: '/usr/bin/npm', args: ['pack', '@acme/x@^1.0.0'], verbatim: false })
  })

  // Plugins 2e-2: Astera's own npm is a script run on the Host's Node, with no shell between.
  it('runs Astera’s own npm on the Host’s Node, with no shell, on every platform', () => {
    const own = { node: 'C:\\Astera\\astera-host.exe', cli: 'C:\\p r\\npm\\bin\\npm-cli.js' }
    expect(npmCommand(['pack', '@acme/x@^1.0.0'], 'win32', {}, { own })).toEqual({ file: own.node, args: [own.cli, 'pack', '@acme/x@^1.0.0'], verbatim: false })
    expect(npmCommand(['pack', 'a"b'], 'linux', {}, { own }).args).toEqual([own.cli, 'pack', 'a"b'])
  })

  it('refuses an argument, or a path, cmd.exe would read anyway', () => {
    for (const bad of ['a"b', '%PATH%', 'a\nb']) expect(() => npmCommand(['pack', bad], 'win32', {}, { path: NPM_CMD }), bad).toThrow(/cannot be passed to npm/)
    expect(() => npmCommand(['pack', 'x'], 'win32', {}, { path: 'C:\\100%\\npm.cmd' })).toThrow(/cannot be passed to npm/)
  })
})

// 2e-2 final review I3, M3, M5: npm is found off the Host's event loop (an offline drive on PATH held it 21 s),
// a leftover npm.cmd with no Node beside it or on PATH is no npm, and a PATH that lacks npm is read again from what
// Windows keeps, so installing Node.js while the Host runs needs no restart.
describe('locateNpm', () => {
  let bin: string
  let other: string
  beforeEach(async () => {
    bin = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-find npm '))
    other = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-find node '))
  })
  afterEach(async () => {
    await removeFixture(bin)
    await removeFixture(other)
  })
  const nothing = async (): Promise<void> => {}

  it.skipIf(process.platform !== 'win32')('finds npm.cmd by PATHEXT with Node beside it, never the sh script npm ships', async () => {
    await fs.writeFile(path.join(bin, 'npm'), '#!/bin/sh')
    await fs.writeFile(path.join(bin, 'npm.cmd'), '@echo off')
    await fs.writeFile(path.join(bin, 'node.exe'), '')
    expect(await locateNpm({ Path: `C:\\nowhere;"${bin}"`, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32', { refresh: nothing })).toBe(path.join(bin, 'npm.cmd'))
    // What a PATHEXT without .CMD leaves cmd.exe unable to run, it is not found.
    expect(await locateNpm({ PATH: bin, PATHEXT: '.COM;.EXE' }, 'win32', { refresh: nothing })).toBeNull()
  })

  it.skipIf(process.platform !== 'win32')('counts a leftover npm.cmd with no Node anywhere as no npm, and one with Node elsewhere on PATH as npm', async () => {
    await fs.writeFile(path.join(bin, 'npm.cmd'), '@echo off')
    expect(await locateNpm({ PATH: bin, PATHEXT: '.CMD;.EXE' }, 'win32', { refresh: nothing })).toBeNull()
    await fs.writeFile(path.join(other, 'node.exe'), '')
    expect(await locateNpm({ PATH: `${bin};${other}`, PATHEXT: '.CMD;.EXE' }, 'win32', { refresh: nothing })).toBe(path.join(bin, 'npm.cmd'))
  })

  it.skipIf(process.platform !== 'win32')('counts an npm.cmd cmd.exe cannot be given, a % in its path, as no npm', async () => {
    const odd = path.join(bin, '100%')
    await fs.mkdir(odd)
    await fs.writeFile(path.join(odd, 'npm.cmd'), '@echo off')
    await fs.writeFile(path.join(odd, 'node.exe'), '')
    expect(await locateNpm({ PATH: odd, PATHEXT: '.CMD;.EXE' }, 'win32', { refresh: nothing })).toBeNull()
  })

  it('reads PATH again when npm is not on it, once, and finds what was installed meanwhile', async () => {
    const env: NodeJS.ProcessEnv = { PATH: process.platform === 'win32' ? 'C:\\nowhere' : '/nowhere', PATHEXT: '.CMD;.EXE' }
    let refreshed = 0
    const npmFile = path.join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm')
    await fs.writeFile(npmFile, process.platform === 'win32' ? '@echo off' : '#!/bin/sh\n', { mode: 0o755 })
    await fs.writeFile(path.join(bin, process.platform === 'win32' ? 'node.exe' : 'node'), '', { mode: 0o755 })
    const found = await locateNpm(env, process.platform, {
      refresh: async () => {
        refreshed++
        env.PATH = bin
      }
    })
    expect(found).toBe(npmFile)
    expect(refreshed).toBe(1)
  })

  it('never looks in a relative folder', async () => {
    expect(await locateNpm({ PATH: process.platform === 'win32' ? '.;relative' : '.:relative' }, process.platform, { refresh: nothing })).toBeNull()
  })

  it.skipIf(process.platform === 'win32')('finds npm elsewhere with Node beside it, and not without', async () => {
    await fs.writeFile(path.join(bin, 'npm'), '#!/bin/sh\n', { mode: 0o755 })
    expect(await locateNpm({ PATH: bin }, 'linux', { refresh: nothing })).toBeNull()
    await fs.writeFile(path.join(bin, 'node'), '', { mode: 0o755 })
    expect(await locateNpm({ PATH: `.:${bin}` }, 'linux', { refresh: nothing })).toBe(path.join(bin, 'npm'))
  })
})

describe('npmEnv', () => {
  // 2e final review I1: on Windows cmd.exe, and npm's own lookup of git, look in the current folder before PATH.
  it('is the Host environment without what is the Host alone or an Astera session, without npm nags, and with no lookup in the current folder', () => {
    expect(npmEnv({ PATH: 'p', ELECTRON_RUN_AS_NODE: '1', ASTERA_HOST_X: 'h', ASTERA_SESSION: 's', npm_config_registry: 'r' })).toEqual({
      PATH: 'p',
      npm_config_registry: 'r',
      NoDefaultCurrentDirectoryInExePath: '1',
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
      npm_config_audit: 'false'
    })
  })
})

// Spec §12 "install logs redaction": npm's output is the install log, and a registry token can be in it.
describe('npmOutputTail', () => {
  it('keeps the last lines, with registry tokens and passwords taken out', () => {
    const out = [
      'npm error code E401',
      'npm error 401 Unauthorized - GET https://reg.example.com/@acme%2fx',
      'npm verbose config //reg.example.com/:_authToken=npm_SECRET123',
      'npm verbose config //reg.example.com/:_password=cGFzcw==',
      'npm error fetch https://alice:hunter2@reg.example.com/x.tgz'
    ].join('\n')
    const tail = npmOutputTail(out, 4)
    expect(tail.split('\n')).toHaveLength(4)
    expect(tail).not.toContain('npm_SECRET123')
    expect(tail).not.toContain('cGFzcw==')
    expect(tail).not.toContain('hunter2')
    expect(tail).toContain('_authToken=[redacted]')
    expect(tail).toContain('https://[redacted]@reg.example.com/x.tgz')
    // The error code leads, whatever else the tail keeps (2e final review M5).
    expect(tail.split('\n')[0]).toBe('npm error code E401')
  })

  // 2e final review M5: npm's 404 ends with a note that points at sources Astera refuses, which pushed the line that
  // says what went wrong out of the tail; and a password with an @ in it kept its end.
  it('keeps the error code and drops npm’s note about other sources and its log path', () => {
    const out = [
      'npm error code E404',
      'npm error 404 Not Found - GET http://127.0.0.1:48731/@smoke%2fnowhere - not found',
      'npm error 404',
      "npm error 404  '@smoke/nowhere@1.0.0' is not in this registry.",
      'npm error 404',
      'npm error 404 Note that you can also install from a',
      'npm error 404 tarball, folder, http url, or git url.',
      'npm error A complete log of this run can be found in: C:\\Users\\me\\AppData\\Local\\npm-cache\\_logs\\x.log'
    ].join('\n')
    expect(npmOutputTail(out, 3).split('\n')).toEqual([
      'npm error code E404',
      'npm error 404 Not Found - GET http://127.0.0.1:48731/@smoke%2fnowhere - not found',
      "npm error 404  '@smoke/nowhere@1.0.0' is not in this registry."
    ])
    expect(npmOutputTail('npm error fetch https://alice:p@ss@reg.example.com/x.tgz')).toBe('npm error fetch https://[redacted]@reg.example.com/x.tgz')
  })
})

// 2e final review M1: a pack and an install, each to its limit, end inside the wait the CLI and the app give a change.
describe('NPM_TIMEOUT_MS', () => {
  it('lets a pack and an install, with a copy and a move after them, end before the caller stops waiting', () => {
    expect(2 * NPM_TIMEOUT_MS + 60_000).toBeLessThan(DEFAULT_CHECK_TIMEOUT_MS + TIMEOUT_HEADROOM_MS)
  })

  // 2e-2 final review M2: the first inspect without Node.js fetches npm, then packs.
  it('lets the fetch of Astera’s own npm and a pack end before the caller stops waiting', () => {
    expect(DOWNLOAD_TOTAL_MS + NPM_TIMEOUT_MS + 30_000).toBeLessThan(DEFAULT_CHECK_TIMEOUT_MS + TIMEOUT_HEADROOM_MS)
  })
})

describe('packAndExtract and installDependencies', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-npm-unit-'))
  })
  afterEach(async () => {
    await removeFixture(dir)
  })

  /** An npm that writes `tgz` for a pack and records where it ran; for an install, a stub of each dependency. */
  const fake = (tgz: Buffer, o: { stdout?: string; code?: number; stderr?: string } = {}) => {
    const calls: { args: string[]; cwd: string }[] = []
    const run: NpmRun = async (args, { cwd }) => {
      calls.push({ args, cwd })
      if (args[0] === 'pack') {
        await fs.writeFile(path.join(cwd, 'whatever-name.tgz'), tgz)
        return { code: o.code ?? 0, stdout: o.stdout ?? '', stderr: o.stderr ?? '' }
      }
      const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        await fs.mkdir(path.join(cwd, 'node_modules', dep), { recursive: true })
        await fs.writeFile(path.join(cwd, 'node_modules', dep, 'index.js'), dep)
      }
      return { code: o.code ?? 0, stdout: '', stderr: o.stderr ?? '' }
    }
    return { run, calls }
  }
  const plugin = (json: Record<string, unknown>, extra: { name: string; body: string }[] = []): Buffer =>
    tgzOf([{ name: 'package/package.json', body: JSON.stringify(json) }, { name: 'package/index.mjs', body: '' }, ...extra])

  // 2e final review M2, M3: a package of many files writes more JSON than is kept, and the registry's word on a package
  // need not be what its tarball holds; what is extracted is what counts.
  it('finds the tarball npm wrote and reads the name and version from the package itself, not from npm’s JSON', async () => {
    const f = fake(plugin({ name: '@acme/x', version: '1.2.3' }), { stdout: 'not json at all' })
    expect(await packAndExtract('@acme/x@^1', dir, f.run)).toEqual({ name: '@acme/x', version: '1.2.3', folder: path.join(dir, 'package') })
    expect(f.calls[0]).toEqual({ args: ['pack', '@acme/x@^1', '--prefix', '.', '--ignore-scripts', '--pack-destination', '.'], cwd: dir })
  })

  it('counts a missing version as not found, as a missing package is', async () => {
    const f = fake(Buffer.alloc(0), { code: 1, stderr: 'npm error code ETARGET\nnpm error notarget No matching version found for x@9.' })
    const e = await packAndExtract('x@9', dir, f.run).catch((err: unknown) => err)
    expect(e).toBeInstanceOf(NpmFailed)
    expect((e as NpmFailed).notFound).toBe(true)
  })

  // 2e final review I1: npm never runs inside the package, so nothing the package holds (an npm.cmd, a git.cmd, an
  // .npmrc) can be run or read by it; the dependencies are installed in a folder of their own and moved in.
  it('installs the dependencies in a folder of their own beside the package, and moves them in', async () => {
    const f = fake(
      plugin({ name: 'p', version: '1.0.0', dependencies: { a: '1', b: '1' }, devDependencies: { secret: '1' }, overrides: { a: '1.0.1' }, bundleDependencies: ['b'] }, [
        { name: 'package/node_modules/b/index.js', body: 'bundled b' },
        { name: 'package/npm.cmd', body: 'echo pwned' },
        { name: 'package/.npmrc', body: 'registry=http://127.0.0.1:1/' }
      ])
    )
    const got = await packAndExtract('p', dir, f.run)
    expect(await installDependencies(got.folder, dir, f.run)).toBe(true)
    const install = f.calls[1]
    expect(install.cwd).toBe(path.join(dir, 'deps'))
    expect(install.args.slice(0, 3)).toEqual(['install', '--prefix', '.'])
    expect(install.args).toContain('--ignore-scripts')
    expect(JSON.parse(await fs.readFile(path.join(dir, 'deps', 'package.json'), 'utf8'))).toEqual({
      name: 'astera-plugin-dependencies',
      private: true,
      dependencies: { a: '1' },
      overrides: { a: '1.0.1' }
    })
    expect(await fs.readFile(path.join(got.folder, 'node_modules', 'a', 'index.js'), 'utf8')).toBe('a')
    expect(await fs.readFile(path.join(got.folder, 'node_modules', 'b', 'index.js'), 'utf8')).toBe('bundled b')
    // The package's own files are as it shipped them.
    expect(JSON.parse(await fs.readFile(path.join(got.folder, 'package.json'), 'utf8')).devDependencies).toEqual({ secret: '1' })
  })

  // 2f final review: a package.json that starts with a byte order mark, which npm itself reads
  it('reads the dependencies of a package.json that starts with a byte order mark', async () => {
    const f = fake(plugin({ name: 'p', version: '1.0.0', dependencies: { a: '1' } }))
    const got = await packAndExtract('p', dir, f.run)
    const file = path.join(got.folder, 'package.json')
    await fs.writeFile(file, `﻿${await fs.readFile(file, 'utf8')}`)
    expect(await installDependencies(got.folder, dir, f.run)).toBe(true)
    expect(JSON.parse(await fs.readFile(path.join(dir, 'deps', 'package.json'), 'utf8')).dependencies).toEqual({ a: '1' })
  })

  it('runs no npm install for a package whose dependencies are all bundled, or none', async () => {
    const f = fake(plugin({ name: 'p', version: '1.0.0', dependencies: { b: '1' }, bundleDependencies: true }))
    const got = await packAndExtract('p', dir, f.run)
    expect(await installDependencies(got.folder, dir, f.run)).toBe(false)
    expect(f.calls.map((c) => c.args[0])).toEqual(['pack'])
    expect(existsSync(path.join(dir, 'deps'))).toBe(false)
  })
})

/** A spawn that answers with `code`, or fails to start with `error`. */
const fakeSpawn = (o: { code?: number; error?: NodeJS.ErrnoException; stdout?: string; stderr?: string; hang?: boolean }) => {
  const calls: { file: string; args: readonly string[]; opts: Record<string, unknown> }[] = []
  const spawn = ((file: string, args: readonly string[], opts: Record<string, unknown>) => {
    calls.push({ file, args, opts })
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; exitCode: number | null; signalCode: null; kill(): boolean }
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.pid = 4242
    child.exitCode = null
    child.signalCode = null
    child.kill = () => {
      child.exitCode = 1
      setImmediate(() => child.emit('close', null))
      return true
    }
    setImmediate(() => {
      if (o.error) return void child.emit('error', o.error)
      if (o.hang) return
      child.stdout.end(o.stdout ?? '')
      child.stderr.end(o.stderr ?? '')
      child.exitCode = o.code ?? 0
      setImmediate(() => child.emit('close', o.code ?? 0))
    })
    return child
  }) as unknown as typeof nodeSpawn
  return { spawn, calls }
}

describe('createNpmRunner', () => {
  it('runs npm in the folder it is given, and answers its code and output', async () => {
    const f = fakeSpawn({ code: 0, stdout: '[{"name":"x"}]', stderr: 'npm warn x' })
    const run = createNpmRunner({ env: { PATH: 'p' }, spawn: f.spawn, platform: 'linux', locate: async () => '/usr/bin/npm' })
    expect(await run(['pack', 'x'], { cwd: '/tmp/a b' })).toEqual({ code: 0, stdout: '[{"name":"x"}]', stderr: 'npm warn x' })
    expect(f.calls[0]).toMatchObject({ file: '/usr/bin/npm', args: ['pack', 'x'], opts: { cwd: '/tmp/a b', env: { PATH: 'p' }, windowsHide: true } })
  })

  it('runs Astera’s own npm with its Node run as Node, whatever the Host binary is', async () => {
    const f = fakeSpawn({ code: 0 })
    await createNpmRunner({ env: { PATH: 'p' }, spawn: f.spawn, platform: 'win32', own: { node: 'electron.exe', cli: 'npm-cli.js' } })(['pack', 'x'], { cwd: '.' })
    expect(f.calls[0]).toMatchObject({ file: 'electron.exe', args: ['npm-cli.js', 'pack', 'x'], opts: { env: { PATH: 'p', ELECTRON_RUN_AS_NODE: '1' }, windowsVerbatimArguments: false } })
  })

  it('says npm is missing when it is not on PATH, without starting anything, or when it cannot be started', async () => {
    const none = fakeSpawn({ code: 0 })
    expect(await createNpmRunner({ env: {}, spawn: none.spawn, platform: 'win32', locate: async () => null })(['pack', 'x'], { cwd: '.' }).catch((e: unknown) => e)).toBeInstanceOf(NpmMissing)
    expect(none.calls).toEqual([])
    const enoent = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' })
    expect(
      await createNpmRunner({ env: {}, spawn: fakeSpawn({ error: enoent }).spawn, platform: 'linux', locate: async () => '/usr/bin/npm' })(['pack', 'x'], { cwd: '.' }).catch((e: unknown) => e)
    ).toBeInstanceOf(NpmMissing)
  })

  // 2e final review M8: a Host that leaves while npm runs ends it rather than leave it behind.
  it('ends every npm still running when told to stop', async () => {
    let killed = 0
    const run = createNpmRunner({ env: {}, spawn: fakeSpawn({ hang: true }).spawn, platform: 'linux', locate: async () => '/usr/bin/npm', kill: (c) => void (killed++, c.kill()) })
    const pending = run(['install'], { cwd: '.' }).catch((err: unknown) => err)
    await new Promise((r) => setImmediate(r))
    run.stopAll()
    expect(((await pending) as Error).message).toBe('npm was stopped: the Host is leaving')
    expect(killed).toBe(1)
  })

  it('ends an npm that runs past its time, and says so', async () => {
    const run = createNpmRunner({ env: {}, spawn: fakeSpawn({ hang: true }).spawn, platform: 'linux', locate: async () => '/usr/bin/npm', kill: (c) => void c.kill() })
    const e = await run(['install'], { cwd: '.', timeoutMs: 50 }).catch((err: unknown) => err)
    expect((e as Error).message).toBe('npm did not finish within 0.05 s')
  })
})

// Plugins 2e-2 (the user's decision 2026-10-13): the person's npm when there is one, Astera's own when there is not.
describe('createNpm', () => {
  const ok = { code: 0, stdout: 'ok', stderr: '' }
  const runner = (o: { missing?: boolean; code?: number } = {}) => {
    const calls: string[][] = []
    let stopped = 0
    const run: NpmRun = async (args) => {
      calls.push(args)
      if (o.missing) throw new NpmMissing()
      return { ...ok, code: o.code ?? 0 }
    }
    return { run: Object.assign(run, { stopAll: () => void stopped++ }) as NpmRunner, calls, stopped: () => stopped }
  }

  it('runs the person’s npm when it starts, and fetches nothing', async () => {
    const system = runner()
    let ensured = 0
    const npm = createNpm({ profileDir: '/p', env: {}, node: 'node', system: system.run, ensure: async () => (ensured++, 'cli'), own: () => runner().run })
    expect(await npm(['pack', 'x'], { cwd: '.' })).toEqual(ok)
    expect(system.calls).toEqual([['pack', 'x']])
    expect(ensured).toBe(0)
  })

  it('reports a person’s npm that fails, rather than hide it behind its own', async () => {
    const system = runner({ code: 1 })
    let ensured = 0
    const npm = createNpm({ profileDir: '/p', env: {}, node: 'node', system: system.run, ensure: async () => (ensured++, 'cli'), own: () => runner().run })
    expect((await npm(['pack', 'x'], { cwd: '.' })).code).toBe(1)
    expect(ensured).toBe(0)
  })

  it('runs its own npm where none starts, and goes straight to it after', async () => {
    const system = runner({ missing: true })
    const own = runner()
    const made: string[] = []
    const npm = createNpm({
      profileDir: '/p',
      env: {},
      node: 'node',
      system: system.run,
      ensure: async () => 'C:/p/npm/bin/npm-cli.js',
      own: (cli) => (made.push(cli), own.run)
    })
    await npm(['pack', 'x'], { cwd: '.' })
    await npm(['install'], { cwd: '.' })
    expect(system.calls).toEqual([['pack', 'x']])
    expect(own.calls).toEqual([['pack', 'x'], ['install']])
    expect(made).toEqual(['C:/p/npm/bin/npm-cli.js'])
    npm.stopAll()
    expect([system.stopped(), own.stopped()]).toEqual([1, 1])
  })

  it('says why it could not fetch its own, and tries again the next time', async () => {
    let tries = 0
    const npm = createNpm({
      profileDir: '/p',
      env: {},
      node: 'node',
      system: runner({ missing: true }).run,
      ensure: async () => {
        tries++
        throw new NpmUnavailable('PLUGIN_NPM_BLOCKED', 'blocked')
      },
      own: () => runner().run
    })
    expect(await npm(['pack', 'x'], { cwd: '.' }).catch((e: unknown) => e)).toBeInstanceOf(NpmUnavailable)
    await npm(['pack', 'x'], { cwd: '.' }).catch(() => {})
    expect(tries).toBe(2)
  })
})
