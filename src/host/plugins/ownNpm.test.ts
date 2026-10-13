import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { NpmUnavailable, OWN_NPM, createOwnNpm } from './ownNpm'
import { pluginsRoot } from './registry'
import { tgzOf } from './tarballFixture'

// Plugins 2e-2 (design P14; the user's decision 2026-10-13): without Node.js, Astera fetches a pinned npm once,
// checks it against the hash in its code, and runs it on its own Node. A network that blocks the fetch gets its own
// notice.
const FAKE = tgzOf([
  { name: 'package/package.json', body: '{"name":"npm","version":"0.0.1-test"}' },
  { name: 'package/bin/npm-cli.js', body: "console.log('fake npm ' + process.argv.slice(2).join(' '))\n" }
])
const sha512 = (b: Buffer): string => `sha512-${createHash('sha512').update(b).digest('base64')}`

let dir: string
let profile: string
let server: http.Server
let base: string
let requests = 0
let answer: (res: http.ServerResponse) => void
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera own npm 플러그인 '))
  profile = path.join(dir, 'profile')
  await fs.mkdir(profile)
  requests = 0
  answer = (res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(FAKE)
  }
  server = http.createServer((_req, res) => {
    requests++
    answer(res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 })
})

const pin = (over: Partial<typeof OWN_NPM> = {}) => ({ version: '0.0.1-test', integrity: sha512(FAKE), url: `${base}/npm/-/npm-0.0.1-test.tgz`, ...over })
const npmRoot = (): string => path.join(pluginsRoot(profile), 'npm')
const refusal = async (p: Promise<unknown>): Promise<NpmUnavailable> => {
  const e = await p.catch((err: unknown) => err)
  expect(e).toBeInstanceOf(NpmUnavailable)
  return e as NpmUnavailable
}

describe('OWN_NPM', () => {
  it('is npm 11.21.0 from the npm registry, by the hash the registry publishes for it', () => {
    expect(OWN_NPM).toEqual({
      version: '11.21.0',
      integrity: 'sha512-Zov8KhamNneiLdELtj5YALtNmJW4L4fCLTzjfpzXG2w6MSHcf0UxgdlK5uloCuksWT+7mGUU7wi79cO6RqivPg==',
      url: 'https://registry.npmjs.org/npm/-/npm-11.21.0.tgz'
    })
  })
})

describe('createOwnNpm', () => {
  it('fetches it once, checks it, and keeps it under the profile, where it runs on Node', async () => {
    const own = createOwnNpm({ profileDir: profile, pinned: pin() })
    const [cli, again] = await Promise.all([own.ensure(), own.ensure()])
    expect(cli).toBe(path.join(npmRoot(), '0.0.1-test', 'bin', 'npm-cli.js'))
    expect(again).toBe(cli)
    expect(await createOwnNpm({ profileDir: profile, pinned: pin() }).ensure()).toBe(cli)
    expect(requests).toBe(1)
    expect(spawnSync(process.execPath, [cli, 'pack', 'x'], { encoding: 'utf8' }).stdout.trim()).toBe('fake npm pack x')
    expect((await fs.readdir(npmRoot())).sort()).toEqual(['0.0.1-test'])
  })

  it('fetches it again over a folder a stopped fetch left half written', async () => {
    await fs.mkdir(path.join(npmRoot(), '0.0.1-test', 'bin'), { recursive: true })
    await fs.writeFile(path.join(npmRoot(), '0.0.1-test', 'bin', 'npm-cli.js'), 'half')
    const cli = await createOwnNpm({ profileDir: profile, pinned: pin() }).ensure()
    expect(requests).toBe(1)
    expect(await fs.readFile(cli, 'utf8')).toContain('fake npm')
  })

  // The user's decision: a network that blocks the fetch gets a notice of its own.
  it('says a registry that does not answer may be blocked by the network, and keeps nothing', async () => {
    const e = await refusal(createOwnNpm({ profileDir: profile, pinned: pin({ url: 'http://127.0.0.1:9/npm.tgz' }) }).ensure())
    expect(e.code).toBe('PLUGIN_NPM_BLOCKED')
    expect(e.message).toMatch(/^npm is not installed, and Astera could not fetch its own npm 0\.0\.1-test: 127\.0\.0\.1:9 did not answer \(.+\)\. A company network, a firewall or a proxy may block it: ask for access to 127\.0\.0\.1:9, install Node\.js, which brings npm, or install the plugin from a folder with --path$/)
    expect(existsSync(path.join(npmRoot(), '0.0.1-test'))).toBe(false)
  })

  it('says a proxy that refuses is blocking it', async () => {
    answer = (res) => {
      res.writeHead(407, { 'proxy-authenticate': 'Basic' })
      res.end()
    }
    const e = await refusal(createOwnNpm({ profileDir: profile, pinned: pin() }).ensure())
    expect(e.code).toBe('PLUGIN_NPM_BLOCKED')
    expect(e.message).toContain(`${new URL(base).host} answered 407`)
  })

  it('refuses a download that is not the npm it pins, as a page a network put in its place, and keeps nothing', async () => {
    answer = (res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>Sign in to the guest network</html>')
    }
    const e = await refusal(createOwnNpm({ profileDir: profile, pinned: pin() }).ensure())
    expect(e.code).toBe('PLUGIN_NPM_ALTERED')
    expect(e.message).toBe(
      'npm is not installed, and the npm 0.0.1-test Astera fetched is not the one it expects (its hash differs), so it was not used: something on the network may have changed it. Install Node.js, which brings npm, or install the plugin from a folder with --path'
    )
    expect(existsSync(npmRoot()) ? await fs.readdir(npmRoot()) : []).toEqual([])
  })

  it('tries again on the next ask after a failed fetch', async () => {
    answer = (res) => {
      res.writeHead(503)
      res.end()
    }
    const own = createOwnNpm({ profileDir: profile, pinned: pin() })
    await refusal(own.ensure())
    answer = (res) => {
      res.writeHead(200)
      res.end(FAKE)
    }
    expect(await own.ensure()).toBe(path.join(npmRoot(), '0.0.1-test', 'bin', 'npm-cli.js'))
    expect(requests).toBe(2)
  })
})
