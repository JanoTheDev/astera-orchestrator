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
let answer: (res: http.ServerResponse, req: http.IncomingMessage) => void
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera own npm 플러그인 '))
  profile = path.join(dir, 'profile')
  await fs.mkdir(profile)
  requests = 0
  answer = (res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(FAKE)
  }
  server = http.createServer((req, res) => {
    requests++
    answer(res, req)
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
    expect(e.message).toMatch(/^npm is not installed, and Astera could not fetch its own npm 0\.0\.1-test: 127\.0\.0\.1:9 could not be reached or refused it \(.+\)\. A company network, a firewall or a proxy may block it: ask for access to 127\.0\.0\.1:9, install Node\.js, which brings npm, or install the plugin from a folder with --path$/)
    // The reason on its own, for the app to show beside its own words (2e-2 final review M1).
    expect(e.reason).toMatch(/^E[A-Z]+/)
    expect(existsSync(path.join(npmRoot(), '0.0.1-test'))).toBe(false)
  })

  it('says a server that refuses is blocking it, and keeps nothing', async () => {
    answer = (res) => {
      res.writeHead(403)
      res.end()
    }
    const e = await refusal(createOwnNpm({ profileDir: profile, pinned: pin() }).ensure())
    expect(e.code).toBe('PLUGIN_NPM_BLOCKED')
    expect(e.reason).toBe('answered 403')
    expect(existsSync(npmRoot()) ? await fs.readdir(npmRoot()) : []).toEqual([])
  })

  // 2e-2 final review I1: a company network that goes out only through a proxy is the case the user named.
  it('goes through the proxy the environment names, as npm itself does', async () => {
    const seen: string[] = []
    const proxy = http.createServer((req, res) => {
      seen.push(req.url ?? '')
      res.writeHead(200)
      res.end(FAKE)
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
    try {
      const at = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
      const own = createOwnNpm({ profileDir: profile, pinned: pin({ url: 'http://registry.example.invalid/npm/-/npm.tgz' }), env: { HTTP_PROXY: at, http_proxy: at } })
      expect(await own.ensure()).toBe(path.join(npmRoot(), '0.0.1-test', 'bin', 'npm-cli.js'))
      expect(seen).toEqual(['http://registry.example.invalid/npm/-/npm.tgz'])
    } finally {
      await new Promise<void>((r) => proxy.close(() => r()))
    }
  })

  it('says a proxy that asks for a sign-in refused it, with what it answered', async () => {
    const proxy = http.createServer()
    proxy.on('connect', (_req, socket) => {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic\r\n\r\n')
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
    try {
      const at = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
      const e = await refusal(createOwnNpm({ profileDir: profile, pinned: pin({ url: 'https://registry.example.invalid/npm.tgz' }), env: { HTTPS_PROXY: at, https_proxy: at } }).ensure())
      expect(e.code).toBe('PLUGIN_NPM_BLOCKED')
      expect(e.reason).toContain('407')
      expect(existsSync(npmRoot()) ? await fs.readdir(npmRoot()) : []).toEqual([])
    } finally {
      await new Promise<void>((r) => proxy.close(() => r()))
    }
  })

  // 2e-2 final review I2: a Location that is no URL, or not http or https, threw outside the promise and ended the Host.
  it('says a redirect it cannot follow blocks it, and stays up', async () => {
    for (const location of ['http://[bad', 'ftp://x/y']) {
      answer = (res) => {
        res.writeHead(302, { location })
        res.end()
      }
      const e = await refusal(createOwnNpm({ profileDir: profile, pinned: pin() }).ensure())
      expect(e.code, location).toBe('PLUGIN_NPM_BLOCKED')
      expect(e.reason, location).toBe('answered a redirect Astera cannot follow')
    }
  })

  // 2e-2 final review M6: redirects are followed, up to three.
  it('follows up to three redirects, and no more', async () => {
    answer = (res, req) => {
      const n = Number(/\/r(\d)$/.exec(req.url ?? '')?.[1] ?? '0')
      if (n < 3) {
        res.writeHead(302, { location: `/r${n + 1}` })
        return void res.end()
      }
      res.writeHead(200)
      res.end(FAKE)
    }
    expect(await createOwnNpm({ profileDir: profile, pinned: pin() }).ensure()).toBe(path.join(npmRoot(), '0.0.1-test', 'bin', 'npm-cli.js'))
    await fs.rm(npmRoot(), { recursive: true, force: true })
    answer = (res, req) => {
      res.writeHead(302, { location: `${req.url ?? ''}x` })
      res.end()
    }
    const e = await refusal(createOwnNpm({ profileDir: profile, pinned: pin() }).ensure())
    expect(e.reason).toBe('answered 302')
  })

  // 2e-2 final review M2, M6: a body past the cap, a server that stops sending, and one that sends too slowly.
  it('refuses a body past its cap, and gives up on a server that stops or trickles', async () => {
    answer = (res) => {
      res.writeHead(200)
      res.end(Buffer.alloc(4096))
    }
    expect((await refusal(createOwnNpm({ profileDir: profile, pinned: pin(), limits: { bytes: 1024 } }).ensure())).code).toBe('PLUGIN_NPM_ALTERED')
    answer = (res) => {
      res.writeHead(200)
      res.write(Buffer.alloc(10))
    }
    const idle = await refusal(createOwnNpm({ profileDir: profile, pinned: pin(), limits: { idleMs: 150 } }).ensure())
    expect([idle.code, idle.reason]).toEqual(['PLUGIN_NPM_BLOCKED', 'no answer within 0.15 s'])
    answer = (res) => {
      res.writeHead(200)
      const timer = setInterval(() => res.write(Buffer.alloc(1)), 40)
      res.on('close', () => clearInterval(timer))
    }
    const slow = await refusal(createOwnNpm({ profileDir: profile, pinned: pin(), limits: { totalMs: 300 } }).ensure())
    expect([slow.code, slow.reason]).toEqual(['PLUGIN_NPM_BLOCKED', 'took longer than 0.3 s'])
  })

  // 2e-2 final review M4: a file a virus scanner took leaves an npm that fails every install; it is fetched again.
  it('fetches it again when a file of it has gone, and keeps only the version it pins', async () => {
    await createOwnNpm({ profileDir: profile, pinned: pin() }).ensure()
    await fs.rm(path.join(npmRoot(), '0.0.1-test', 'package.json'))
    await fs.mkdir(path.join(npmRoot(), '0.0.0-older'), { recursive: true })
    await createOwnNpm({ profileDir: profile, pinned: pin() }).ensure()
    expect(requests).toBe(2)
    expect(existsSync(path.join(npmRoot(), '0.0.1-test', 'package.json'))).toBe(true)
    expect((await fs.readdir(npmRoot())).sort()).toEqual(['0.0.1-test'])
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

  // Found planning the dev check: setting up the folder failed outside the reasons, with no code for the app to word.
  it('says it could not set npm up when its folder cannot be made', async () => {
    await fs.mkdir(pluginsRoot(profile), { recursive: true })
    await fs.writeFile(npmRoot(), 'in the way')
    const e = await refusal(createOwnNpm({ profileDir: profile, pinned: pin() }).ensure())
    expect(e.code).toBe('PLUGIN_NPM_FETCH_FAILED')
    expect(e.message).toMatch(/^npm is not installed, and Astera could not set up its own npm 0\.0\.1-test: /)
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
