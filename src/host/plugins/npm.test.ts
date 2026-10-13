import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { spawn as nodeSpawn } from 'node:child_process'
import { NpmMissing, createNpmRunner, npmCommand, npmEnv, npmOutputTail } from './npm'

// Plugins 2e (design P14): the person's own npm, reached through cmd.exe on Windows with every argument quoted.
describe('npmCommand', () => {
  it('quotes every argument for cmd.exe on Windows, so ^ and other characters reach npm as written', () => {
    expect(npmCommand(['pack', '@acme/x@^1.0.0', '--json'], 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' })).toEqual({
      file: 'C:\\Windows\\system32\\cmd.exe',
      args: ['/d', '/s', '/c', '"npm "pack" "@acme/x@^1.0.0" "--json""'],
      verbatim: true
    })
    expect(npmCommand(['pack', 'x'], 'win32', {}).file).toBe('cmd.exe')
  })

  it('runs npm itself elsewhere', () => {
    expect(npmCommand(['pack', '@acme/x@^1.0.0'], 'linux', {})).toEqual({ file: 'npm', args: ['pack', '@acme/x@^1.0.0'], verbatim: false })
  })

  it('refuses an argument cmd.exe would read anyway', () => {
    for (const bad of ['a"b', '%PATH%', 'a\nb']) expect(() => npmCommand(['pack', bad], 'win32', {}), bad).toThrow(/cannot be passed to npm/)
  })
})

describe('npmEnv', () => {
  it('is the Host environment without what is the Host alone or an Astera session, and without npm nags', () => {
    expect(npmEnv({ PATH: 'p', ELECTRON_RUN_AS_NODE: '1', ASTERA_HOST_X: 'h', ASTERA_SESSION: 's', npm_config_registry: 'r' })).toEqual({
      PATH: 'p',
      npm_config_registry: 'r',
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
    expect(tail).not.toContain('npm error code E401')
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
    const run = createNpmRunner({ env: { PATH: 'p' }, spawn: f.spawn, platform: 'linux' })
    expect(await run(['pack', 'x'], { cwd: '/tmp/a b' })).toEqual({ code: 0, stdout: '[{"name":"x"}]', stderr: 'npm warn x' })
    expect(f.calls[0]).toMatchObject({ file: 'npm', args: ['pack', 'x'], opts: { cwd: '/tmp/a b', env: { PATH: 'p' }, windowsHide: true } })
  })

  it('says npm is missing when it cannot be started, or cmd.exe cannot find it', async () => {
    const enoent = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' })
    expect(await createNpmRunner({ env: {}, spawn: fakeSpawn({ error: enoent }).spawn, platform: 'linux' })(['pack', 'x'], { cwd: '.' }).catch((e: unknown) => e)).toBeInstanceOf(NpmMissing)
    const notFound = fakeSpawn({ code: 9009, stderr: "'npm' is not recognized as an internal or external command" })
    expect(await createNpmRunner({ env: {}, spawn: notFound.spawn, platform: 'win32' })(['pack', 'x'], { cwd: '.' }).catch((e: unknown) => e)).toBeInstanceOf(NpmMissing)
  })

  it('ends an npm that runs past its time, and says so', async () => {
    const run = createNpmRunner({ env: {}, spawn: fakeSpawn({ hang: true }).spawn, platform: 'linux', kill: (c) => void c.kill() })
    const e = await run(['install'], { cwd: '.', timeoutMs: 50 }).catch((err: unknown) => err)
    expect((e as Error).message).toBe('npm did not finish within 0.05 s')
  })
})
