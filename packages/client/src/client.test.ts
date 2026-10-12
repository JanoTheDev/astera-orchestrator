// createAsteraClient against a fake Host on a real pipe or socket (test/fakeHost.ts): the handshake, calls in flight,
// the CLI's error codes, request ids, AbortSignal, timeouts, the Host going away and close().
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createAsteraClient, CLIENT_VERSION, type AsteraClient } from './client.js'
import { AsteraError } from './errors.js'
import { hostAddress } from './address.js'
import { profilePath } from './discovery.js'
import { HOST_PROTOCOL } from './protocol.js'
import os from 'node:os'
import { listen, makeProfile, startHost, type FakeHost, type FakeReply } from '../test/fakeHost.js'

let profile: Awaited<ReturnType<typeof makeProfile>>
beforeAll(async () => {
  profile = await makeProfile()
})
afterAll(async () => {
  await profile.cleanup()
})

const opened: Array<{ close(): unknown }> = []
afterEach(async () => {
  for (const o of opened.splice(0)) await o.close()
})

const host = async (o: Partial<Parameters<typeof startHost>[0]> = {}): Promise<FakeHost> => {
  const h = await startHost({ key: profile.key, ...o })
  opened.push(h)
  return h
}
const client = async (h: { address: string }, o: Parameters<typeof createAsteraClient>[0] = {}): Promise<AsteraClient> => {
  const c = await createAsteraClient({ profileDir: profile.dir, address: h.address, ...o })
  opened.push(c)
  return c
}
/** The AsteraError a promise rejects with (or fails the test). */
const rejection = async (p: Promise<unknown>): Promise<AsteraError> => {
  try {
    await p
  } catch (e) {
    if (e instanceof AsteraError) return e
    throw e
  }
  throw new Error('expected a rejection')
}
const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('createAsteraClient', () => {
  it('connects and reports the Host', async () => {
    const h = await host({ features: ['orch', 'requests'] })
    const c = await client(h)
    expect(c.host).toMatchObject({ version: '1.4.11', pid: 7, startedAt: 'T', features: ['orch', 'requests'] })
    expect(c.hasFeature('orch')).toBe(true)
    expect(c.hasFeature('nope')).toBe(false)
    expect(c.address).toBe(h.address)
    expect(c.profileDir).toBe(profilePath(profile.dir, process.platform))
  })

  it('sends one orch-call with no session and answers with the publicly shaped body', async () => {
    const h = await host({ onCall: (_m, reply) => reply({ status: 200, body: [{ id: 'job_1', objective: 'o', secretBookkeeping: 1 }] }) })
    const c = await client(h)
    const r = await c.call('jobs-list', { status: 'open' })
    expect(r).toEqual({ body: [{ id: 'job_1', objective: 'o' }], replayed: false, observed: false })
    const sent = h.calls()[0]
    expect(sent).toMatchObject({ t: 'orch-call', cmd: 'jobs-list', args: { status: 'open' } })
    expect('session' in sent).toBe(false)
    expect('request' in sent).toBe(false)
  })

  it('gives two calls in flight their own answers, whatever order they come in', async () => {
    const waiting: Array<() => void> = []
    const h = await host({ onCall: (m, reply) => waiting.push(() => reply({ status: 200, body: { said: m.args.n } })) })
    const c = await client(h)
    const a = c.call('x-cmd', { n: 1 })
    const b = c.call('x-cmd', { n: 2 })
    await tick()
    waiting[1]()
    waiting[0]()
    expect((await a).body).toEqual({ said: 1 })
    expect((await b).body).toEqual({ said: 2 })
  })

  it('turns a refusal into the CLI code, with the Host sentence and body', async () => {
    const answers: Record<string, FakeReply> = {
      'a-404': { status: 404, body: { error: 'no such job' } },
      'a-409': { status: 409, body: { code: 'RUNTIME_BUSY', error: 'busy' } },
      'a-501': { status: 501, body: { error: 'unknown command' } },
      'a-500': { status: 500, body: 'nothing useful' }
    }
    const h = await host({ onCall: (m, reply) => reply(answers[m.cmd]) })
    const c = await client(h)
    const e404 = await rejection(c.call('a-404'))
    expect([e404.code, e404.message, e404.details]).toEqual(['NOT_FOUND', 'no such job', { error: 'no such job' }])
    expect((await rejection(c.call('a-409'))).code).toBe('RUNTIME_BUSY')
    expect((await rejection(c.call('a-501'))).code).toBe('VERSION_MISMATCH')
    const e500 = await rejection(c.call('a-500'))
    expect([e500.code, e500.message]).toEqual(['FAILED', 'the Host answered 500 to a-500'])
  })

  it('sends a requestId as the request and reports a replay', async () => {
    const h = await host({ onCall: (_m, reply) => reply({ status: 200, body: {}, replayed: true }) })
    const c = await client(h)
    expect(await c.call('jobs-create', {}, { requestId: 'r-1' })).toEqual({ body: {}, replayed: true, observed: false })
    expect(h.calls()[0].request).toBe('r-1')
  })

  it('refuses a requestId the Host cannot honour, and sends nothing', async () => {
    const h = await host({ features: ['orch'] })
    const c = await client(h)
    const e = await rejection(c.call('jobs-create', {}, { requestId: 'r-1' }))
    expect([e.code, e.message]).toEqual(['VERSION_MISMATCH', 'the Host 1.4.11 keeps no request receipts, so a requestId cannot make jobs-create safe to retry'])
    expect(h.calls()).toEqual([])
  })

  it('an AbortSignal ends the call with its reason, and the late answer changes nothing', async () => {
    const answerLater: Array<() => void> = []
    const h = await host({ onCall: (_m, reply) => answerLater.push(() => reply({ status: 200, body: {} })) })
    const c = await client(h)
    const ac = new AbortController()
    const p = c.call('jobs-list', {}, { signal: ac.signal })
    await tick()
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    answerLater[0]()
    await tick()
    // the same client goes on, on the same connection, and the late answer did not land on the next call
    const next = c.call('x-next')
    await tick()
    answerLater[1]()
    expect((await next).body).toEqual({})
    expect(h.hellos()).toBe(1)
  })

  it('an AbortSignal already aborted sends nothing', async () => {
    const h = await host()
    const c = await client(h)
    const ac = new AbortController()
    ac.abort(new Error('stop'))
    await expect(c.call('jobs-list', {}, { signal: ac.signal })).rejects.toThrow('stop')
    expect(h.calls()).toEqual([])
  })

  it('times out a call nobody answers', async () => {
    const h = await host({ onCall: () => {} })
    const c = await client(h)
    expect((await rejection(c.call('jobs-list', {}, { timeoutMs: 100 }))).code).toBe('TIMEOUT')
  })

  it('fails a call the Host drops with HOST_NOT_RUNNING, and connects again for the next', async () => {
    let n = 0
    const h = await host({ onCall: (_m, reply) => (++n === 1 ? undefined : reply({ status: 200, body: { n } })) })
    const c = await client(h)
    // a command outside the shaping table, so the body comes back as the Host sent it
    const p = c.call('x-cmd')
    await tick()
    h.dropClients()
    expect((await rejection(p)).code).toBe('HOST_NOT_RUNNING')
    expect((await c.call('x-cmd')).body).toEqual({ n: 2 })
    expect(h.hellos()).toBe(2)
  })

  it('close() fails the call in flight as closed and refuses later calls without sending them', async () => {
    const h = await host({ onCall: () => {} })
    const c = await client(h)
    const p = c.call('jobs-list')
    await tick()
    c.close()
    const e = await rejection(p)
    expect([e.code, e.message]).toEqual(['FAILED', 'the client was closed before the Host answered'])
    const later = await rejection(c.call('jobs-list'))
    expect([later.code, later.message]).toEqual(['FAILED', 'the client is closed'])
    expect(h.calls()).toHaveLength(1)
  })

  it('says why it could not connect', async () => {
    const nobody = (await import('../test/fakeHost.js')).freshAddress
    expect((await rejection(createAsteraClient({ profileDir: profile.dir, address: await nobody(), connectTimeoutMs: 1000 }))).code).toBe('HOST_NOT_RUNNING')
    const impostor = await listen((sock) => sock.write(JSON.stringify({ t: 'hello', protocol: HOST_PROTOCOL, host: 'x', pid: 1, startedAt: 'T', proof: '0'.repeat(64) }) + '\n'))
    opened.push(impostor)
    expect((await rejection(createAsteraClient({ profileDir: profile.dir, address: impostor.address }))).code).toBe('PERMISSION_DENIED')
    const older = await listen((sock) => sock.write(JSON.stringify({ t: 'protocol-mismatch', protocol: 3 }) + '\n'))
    opened.push(older)
    expect((await rejection(createAsteraClient({ profileDir: profile.dir, address: older.address }))).code).toBe('VERSION_MISMATCH')
    const silent = await listen(() => {})
    opened.push(silent)
    expect((await rejection(createAsteraClient({ profileDir: profile.dir, address: silent.address, connectTimeoutMs: 300 }))).code).toBe('TIMEOUT')
  })

  it('refuses a mode it does not speak yet', async () => {
    const e = await rejection(createAsteraClient({ mode: 'http' as unknown as 'local' }))
    expect(e.code).toBe('INVALID_ARGUMENTS')
  })

  it('finds the Host the way the CLI does, and an explicit profile is that profile', async () => {
    const h = await host()
    const viaEnv = await createAsteraClient({ env: { ASTERA_PROFILE_DIR: profile.dir, ASTERA_HOST: h.address } })
    opened.push(viaEnv)
    expect(viaEnv.address).toBe(h.address)
    expect(h.hellos()).toBe(1)
    // An explicit profileDir ignores ASTERA_HOST: the address comes from that profile
    const derived = hostAddress({ profileDir: profilePath(profile.dir, process.platform), platform: process.platform, tmpDir: os.tmpdir(), protocol: HOST_PROTOCOL }).address
    const e = await rejection(createAsteraClient({ profileDir: profile.dir, env: { ASTERA_HOST: h.address }, connectTimeoutMs: 1000 }))
    expect(e.code).toBe('HOST_NOT_RUNNING')
    expect(e.details).toMatchObject({ address: derived })
  })

  it('CLIENT_VERSION is the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    expect(CLIENT_VERSION).toBe(pkg.version)
  })
})

// Final review of SDK 1b
describe('createAsteraClient: the review fixes', () => {
  // Important 1: close() during a reconnect left the new connection open (the process and the Host stayed up)
  it('close() during a reconnect fails the waiting call as closed and leaves no connection behind', async () => {
    const h = await host()
    const c = await client(h)
    h.dropClients()
    await tick()
    h.setHelloDelay(300)
    const started = Date.now()
    const p = c.call('x-cmd')
    await tick(50)
    c.close()
    const e = await rejection(p)
    expect([e.code, e.message]).toEqual(['FAILED', 'the client was closed before the Host answered'])
    expect(Date.now() - started).toBeLessThan(250)
    await tick(450)
    expect(h.openSockets()).toBe(0)
  })

  // Important 2: the AbortSignal and the deadline did not cover the connect
  it('an AbortSignal and a deadline cover the reconnect too', async () => {
    const h = await host()
    const c = await client(h)
    h.dropClients()
    await tick()
    h.setHelloDelay(1500)
    let started = Date.now()
    expect((await rejection(c.call('x-cmd', {}, { timeoutMs: 100 }))).code).toBe('TIMEOUT')
    expect(Date.now() - started).toBeLessThan(600)
    const ac = new AbortController()
    started = Date.now()
    const p = c.call('x-cmd', {}, { signal: ac.signal })
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - started).toBeLessThan(600)
  })

  // Important 3: a fixed default cut the Host's own long polls short
  it('waits for a waiting command as long as the Host does, past the ordinary deadline', async () => {
    const h = await host({ onCall: (m, reply) => setTimeout(() => reply({ status: 200, body: { cmd: m.cmd } }), 250) })
    const c = await client(h, { callTimeoutMs: 100 })
    expect((await c.call('runs-wait', { id: 'run_1', timeoutMs: 300 })).body).toEqual({ cmd: 'runs-wait' })
    expect((await rejection(c.call('x-cmd'))).code).toBe('TIMEOUT')
  })

  // Minor 1: Infinity, 3e9, 0 and NaN made setTimeout fire at once
  it('refuses a deadline setTimeout cannot hold', async () => {
    for (const bad of [Infinity, 3e9, 0, -1, Number.NaN, 1.5]) {
      expect((await rejection(createAsteraClient({ callTimeoutMs: bad }))).code, String(bad)).toBe('INVALID_ARGUMENTS')
      expect((await rejection(createAsteraClient({ connectTimeoutMs: bad }))).code, String(bad)).toBe('INVALID_ARGUMENTS')
    }
    const h = await host()
    const c = await client(h)
    for (const bad of [Infinity, 3e9, 0, Number.NaN]) expect((await rejection(c.call('x-cmd', {}, { timeoutMs: bad }))).code, String(bad)).toBe('INVALID_ARGUMENTS')
    expect(h.calls()).toEqual([])
  })

  // Minor 3: the CLI and the MCP link refuse a Host without orch; the client waited for an answer that never came
  it('refuses a Host that does not run commands, and sends nothing', async () => {
    const h = await host({ features: ['requests'] })
    const c = await client(h)
    expect((await rejection(c.call('jobs-list'))).code).toBe('VERSION_MISMATCH')
    expect(h.calls()).toEqual([])
  })

  // Minor 5: the Host info steers hasFeature and the receipts check, so nobody may change it
  it('hands out a frozen Host info', async () => {
    const h = await host()
    const c = await client(h)
    expect(Object.isFrozen(c.host)).toBe(true)
    expect(Object.isFrozen(c.host.features)).toBe(true)
  })

  // Minor 6: with the default silent log, why a connect failed was lost
  it('puts the reason a connect failed in the error details', async () => {
    const impostor = await listen((sock) => sock.write(JSON.stringify({ t: 'hello', protocol: HOST_PROTOCOL, host: 'x', pid: 1, startedAt: 'T', proof: '0'.repeat(64) }) + '\n'))
    opened.push(impostor)
    const e = await rejection(createAsteraClient({ profileDir: profile.dir, address: impostor.address }))
    expect((e.details as { reason?: string }).reason).toMatch(/could not prove it is this profile's Host/)
  })

  // Minor 7: a drop said nothing about which call, nor that a requestId makes a retry safe
  it('names the call a drop cut off, and says a retry with the same requestId is safe', async () => {
    const h = await host({ onCall: () => {} })
    const c = await client(h)
    const plain = c.call('jobs-list')
    const keyed = c.call('jobs-create', {}, { requestId: 'r-9' })
    await tick()
    h.dropClients()
    expect((await rejection(plain)).message).toBe(`the Host at ${h.address} closed the connection before answering jobs-list`)
    expect((await rejection(keyed)).message).toBe(
      `the Host at ${h.address} closed the connection before answering jobs-create; retrying with the same requestId (r-9) is safe`
    )
  })
})
