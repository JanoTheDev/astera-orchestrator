// The pty supervisor's protocol end to end over a fake transport: the Host's client (client.ts) against the supervisor's
// state (supervisor.ts), every message through JSON as on the wire, the ptys fakes.
import { describe, it, expect } from 'vitest'
import type { PtyMeta, PtyOpenOptions } from '../../core/host/protocol'
import type { RegistryPty } from '../registry'
import { createPtySupervisorClient, startPtySupervisor, type SpawnRequester, type SupervisorLink } from './client'
import { RING_CHARS, SUPERVISOR_IDLE_MS, type FromSupervisor } from './protocol'
import { createSupervisor } from './supervisor'

let nextPid = 7000
class FakePty implements RegistryPty {
  pid = nextPid++
  dataCbs: ((d: string) => void)[] = []
  exitCbs: ((e: { exitCode: number }) => void)[] = []
  written: string[] = []
  resized: [number, number][] = []
  kills = 0
  paused = 0
  resumed = 0
  onData(cb: (d: string) => void): void {
    this.dataCbs.push(cb)
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitCbs.push(cb)
  }
  write(d: string): void {
    this.written.push(d)
  }
  resize(c: number, r: number): void {
    this.resized.push([c, r])
  }
  kill(): void {
    this.kills++
  }
  pause(): void {
    this.paused++
  }
  resume(): void {
    this.resumed++
  }
  emit(d: string): void {
    for (const cb of this.dataCbs) cb(d)
  }
  end(exitCode: number): void {
    for (const cb of this.exitCbs) cb({ exitCode })
  }
}

const OPTS: PtyOpenOptions = { cwd: '/w', cols: 80, rows: 24, env: { A: '1' } }
const SESSION: PtyMeta = { kind: 'session', id: 's1', restore: { title: 'worker' } }
const wire = <T>(m: T): T => JSON.parse(JSON.stringify(m)) as T
const settle = (): Promise<void> => new Promise((r) => setImmediate(r))

function rig(o: { spawnThrows?: boolean } = {}) {
  const spawned: { file: string; args: string[] | string; opts: PtyOpenOptions; pty: FakePty }[] = []
  const treeKills: number[] = []
  const timers: { ms: number; fn: () => void; cancelled: boolean }[] = []
  let idled = 0
  const sup = createSupervisor({
    spawn: (file, args, opts) => {
      if (o.spawnThrows) throw new Error('File not found: claude')
      const pty = new FakePty()
      spawned.push({ file, args, opts, pty })
      return pty
    },
    killTree: async (pid) => {
      treeKills.push(pid)
    },
    log: () => {},
    onIdle: () => idled++,
    after: (ms, fn) => {
      const t = { ms, fn, cancelled: false }
      timers.push(t)
      return () => (t.cancelled = true)
    }
  })
  /** One Host connection: what the client's link would be over a pipe. `drop` is the pipe breaking. */
  const link = (): SupervisorLink & { drop(): void } => {
    let cb: (m: FromSupervisor | null) => void = () => {}
    const conn = sup.connect((m) => cb(wire(m)))
    return {
      send: (m) => conn.receive(wire(m)),
      listen: (f) => (cb = f),
      close: () => conn.close(),
      drop: () => {
        conn.close()
        cb(null)
      }
    }
  }
  /** The worker's round trip: its own connection, one request, one answer. */
  const request: SpawnRequester = (m) => {
    let answer: FromSupervisor | undefined
    const c = sup.connect((r) => (answer = wire(r)))
    c.receive(wire(m))
    c.close()
    return answer ?? 'no-answer'
  }
  const pending = () => timers.filter((t) => !t.cancelled)
  return { sup, spawned, treeKills, timers, pending, idled: () => idled, link, request }
}

function client(r: ReturnType<typeof rig>, o: { request?: SpawnRequester; link?: SupervisorLink } = {}) {
  const logs: string[] = []
  const here: { file: string; args: string[] | string }[] = []
  const c = createPtySupervisorClient({
    link: o.link ?? r.link(),
    request: o.request ?? r.request,
    fallback: (file, args) => {
      here.push({ file, args })
      return new FakePty()
    },
    log: (m) => logs.push(m)
  })
  return { c, logs, here }
}

describe('pty supervisor protocol', () => {
  it("spawns an agent session's pty in the supervisor; the Host reads, writes, resizes and kills it through the registry's pty shape", async () => {
    const r = rig()
    const { c, here } = client(r)
    const p = c.spawn('claude', ['--resume'], OPTS, SESSION)
    expect(here).toEqual([])
    expect(r.spawned.map((s) => [s.file, s.args, s.opts])).toEqual([['claude', ['--resume'], OPTS]])
    const fake = r.spawned[0].pty
    expect(p.pid).toBe(fake.pid)

    const out: string[] = []
    const exits: number[] = []
    p.onData((d) => out.push(d))
    p.onExit((e) => exits.push(e.exitCode))
    fake.emit('before attach ')
    await settle()
    fake.emit('live')
    expect(out).toEqual(['before attach ', 'live'])

    p.write('hi\r')
    p.resize(120, 40)
    p.pause()
    p.resume()
    expect(fake.written).toEqual(['hi\r'])
    expect(fake.resized).toEqual([[120, 40]])
    expect([fake.paused, fake.resumed]).toEqual([1, 1])

    // The whole tree first, then the pty's one kill; a second kill sends nothing (one kill per pty).
    p.kill()
    p.kill()
    await settle()
    expect(r.treeKills).toEqual([fake.pid])
    expect(fake.kills).toBe(1)
    fake.end(0)
    expect(exits).toEqual([0])
    // Told to a Host, so forgotten.
    expect(await c.list()).toEqual([])
  })

  it('spawns everything that is not an agent session in the Host, as before', () => {
    const r = rig()
    const { c, here } = client(r)
    c.spawn('pwsh', [], OPTS, { kind: 'terminal', id: 't1', restore: {} })
    c.spawn('npm', 'run dev', OPTS, { kind: 'run', id: 'r1', restore: {} })
    c.spawn('bash', [], OPTS)
    expect(here.map((h) => h.file)).toEqual(['pwsh', 'npm', 'bash'])
    expect(r.spawned).toEqual([])
  })

  it('keeps a pty running when its Host goes, buffering its output for the next Host to replay', async () => {
    const r = rig()
    const link = r.link()
    const host1 = createPtySupervisorClient({ link, request: r.request, fallback: () => new FakePty(), log: () => {} })
    host1.spawn('codex', [], OPTS, SESSION).onData(() => {})
    await settle()
    const fake = r.spawned[0].pty
    fake.emit('a')
    link.drop() // the Host died
    fake.emit('b')
    fake.emit('c')
    expect(fake.kills).toBe(0)
    expect(r.treeKills).toEqual([])

    const host2 = client(r).c
    const [held] = await host2.list()
    expect(held).toEqual({ id: expect.any(String), pid: fake.pid, note: SESSION, alive: true })
    const p = host2.attach(held.id, held.pid)
    const out: string[] = []
    p.onData((d) => out.push(d))
    await settle()
    expect(out).toEqual(['abc'])
    fake.emit('d')
    expect(out).toEqual(['abc', 'd'])
    p.write('x')
    expect(fake.written).toEqual(['x'])
  })

  it("bounds each pty's ring while no Host is attached", async () => {
    const r = rig()
    const host1 = createPtySupervisorClient({ link: r.link(), request: r.request, fallback: () => new FakePty(), log: () => {} })
    host1.spawn('claude', [], OPTS, SESSION)
    host1.close()
    const fake = r.spawned[0].pty
    for (let i = 0; i < 100; i++) fake.emit(String(i % 10).repeat(10_000))
    const { c } = client(r)
    const [held] = await c.list()
    let replay = ''
    c.attach(held.id, held.pid).onData((d) => (replay += d))
    await settle()
    expect(replay.length).toBeGreaterThan(0)
    expect(replay.length).toBeLessThanOrEqual(RING_CHARS)
    expect(replay.endsWith('9'.repeat(10_000))).toBe(true)
  })

  it('keeps a pty that ended with no Host attached until the next one attaches, then tells it how it ended', async () => {
    const r = rig()
    const host1 = createPtySupervisorClient({ link: r.link(), request: r.request, fallback: () => new FakePty(), log: () => {} })
    host1.spawn('claude', [], OPTS, SESSION)
    host1.close()
    const fake = r.spawned[0].pty
    fake.emit('last words')
    fake.end(3)
    const { c } = client(r)
    const [held] = await c.list()
    expect(held.alive).toBe(false)
    const out: string[] = []
    const exits: number[] = []
    const p = c.attach(held.id, held.pid)
    p.onData((d) => out.push(d))
    p.onExit((e) => exits.push(e.exitCode))
    await settle()
    expect(out).toEqual(['last words'])
    expect(exits).toEqual([3])
    expect(await c.list()).toEqual([])
  })

  it('exits by itself after 60 s with no pty and no Host, and not while either is there', () => {
    const r = rig()
    // Started and never reached: it leaves too.
    expect(r.pending().map((t) => t.ms)).toEqual([SUPERVISOR_IDLE_MS])
    const host = createPtySupervisorClient({ link: r.link(), request: r.request, fallback: () => new FakePty(), log: () => {} })
    expect(r.pending()).toEqual([])
    host.spawn('claude', [], OPTS, SESSION)
    host.close()
    // A live pty with no Host: it stays.
    expect(r.pending()).toEqual([])
    r.spawned[0].pty.end(0)
    expect(r.pending().map((t) => t.ms)).toEqual([SUPERVISOR_IDLE_MS])
    r.pending()[0].fn()
    expect(r.idled()).toBe(1)
  })

  it('falls back to spawning in the Host when the supervisor cannot be reached, and says so once', () => {
    const r = rig()
    const { c, logs, here } = client(r, { request: () => 'unreachable' })
    c.spawn('claude', [], OPTS, SESSION)
    c.spawn('codex', [], OPTS, { ...SESSION, id: 's2' })
    expect(here.map((h) => h.file)).toEqual(['claude', 'codex'])
    expect(logs.filter((l) => l.includes('pty supervisor'))).toHaveLength(1)
  })

  it('falls back when the supervisor process could not be started, and says so once', () => {
    const logs: string[] = []
    const here: string[] = []
    const c = startPtySupervisor({
      profileDir: '/no/such/profile',
      execPath: process.execPath,
      entryPath: '/no/such/pty-supervisor.js',
      env: {},
      platform: process.platform,
      fallback: (file) => {
        here.push(file)
        return new FakePty()
      },
      log: (m) => logs.push(m)
    })
    c.spawn('claude', [], OPTS, SESSION)
    c.spawn('claude', [], OPTS, SESSION)
    expect(here).toEqual(['claude', 'claude'])
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('could not be started')
  })

  it('throws a spawn the supervisor refused, and never spawns it a second time in the Host', () => {
    const r = rig({ spawnThrows: true })
    const { c, here } = client(r)
    expect(() => c.spawn('claude', [], OPTS, SESSION)).toThrow('File not found: claude')
    expect(here).toEqual([])
  })

  it('throws a spawn that got no answer and ends it in case it started', () => {
    const r = rig()
    const sent: unknown[] = []
    const link: SupervisorLink = { send: (m) => sent.push(m), listen: () => {}, close: () => {} }
    const { c, here } = client(r, { request: () => 'no-answer', link })
    expect(() => c.spawn('claude', [], OPTS, SESSION)).toThrow('did not answer')
    expect(here).toEqual([])
    expect(sent).toEqual([{ t: 'kill', id: expect.any(String) }])
  })

  it('ends the Host\'s handles when the supervisor goes away, and starts later sessions in the Host', async () => {
    const r = rig()
    const link = r.link()
    const { c, here, logs } = client(r, { link })
    const exits: (number | null)[] = []
    c.spawn('claude', [], OPTS, SESSION).onExit((e) => exits.push(e.exitCode))
    await settle()
    link.drop()
    expect(exits).toEqual([null])
    c.spawn('claude', [], OPTS, SESSION)
    expect(here.map((h) => h.file)).toEqual(['claude'])
    expect(logs).toHaveLength(1)
    await expect(c.list()).rejects.toThrow('cannot be reached')
  })
})
