import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { hostAddress } from '../../host/address'
import { startHostServer, type HostServer } from '../../host/server'
import { encodeLine, createLineReader } from '../../host/framing'
import { HOST_PROTOCOL, HOST_YIELD_WORKTREES, HOST_YIELD_DISPATCH, HOST_YIELD_ROLLING, HOST_YIELD_CHAT_TAKEOVER, HOST_YIELD_JOURNAL, HOST_YIELD_UNDERSTANDING, HOST_YIELD_WORKSPACE, HOST_YIELD_ORCH_STATE_LATEST, HOST_YIELD_WORK_UNITS, HOST_YIELD_SLACK, HOST_YIELD_RECOVERY, type HostMessage } from '../../core/host/protocol'
import { HostClient } from './client'
import { hostSpeaksDispatch } from './outdated'
import { hostProof } from '../../core/host/hostKey'
import { chatRespawnOf, handoverOf, leftBehind, writeHandover } from '../../host/sessionRestore'
import { PTY_LOST_SIGHT_EXIT_CODE } from '../../core/sessions/pty'
import { ChatSessionManager, type ChatManagerDeps } from '../../core/chat/manager'
import { chatSpawnOptsOf } from '../../core/chat/respawn'
import type { ChatAdapter, ChatState } from '../../core/chat/types'
import { makeDescriptors } from '../../core/providers/descriptor'
import type { ProcLike } from '../../core/sessions/proc'
import type { Account } from '../../core/types'

/** The profile's Host key every test Host holds (protocol 4, core/host/hostKey.ts), and the read the
 *  client makes of it. */
const KEY = 'e'.repeat(64)
const hostKey = async (): Promise<string | null> => KEY

let dir: string
let servers: HostServer[] = []
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-host-client-'))
  servers = []
})
afterEach(async () => {
  for (const s of servers) await s.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})

// **tmpDir is os.tmpdir(), the same value the app passes (host/index.ts, main/ipc.ts) — not the
// fixture directory.** A posix socket path has to fit in sun_path, 104 bytes on macOS, and
// address.ts picks KEY_LENGTH to stay well inside it. Putting the socket under the fixture adds a
// layer the app never has, and on macOS, where os.tmpdir() is already 48 bytes, that pushed the
// path to 107 and every test in this file died on `listen EINVAL` — a failure about the fixture,
// not the client. (Measured on this machine: 104 binds, 105 does not. Linux CI never saw it,
// because os.tmpdir() there is /tmp.)
//
// Nothing is leaked by moving it out: the directory is named from a hash of profileDir, which is
// still under the fixture and so still unique per test, and it starts with `astera-`, which is what
// vitest.globalSetup.ts sweeps at the end of the run.
const addressFor = (name: string): ReturnType<typeof hostAddress> =>
  hostAddress({
    profileDir: path.join(dir, name),
    platform: process.platform,
    tmpDir: os.tmpdir(),
    protocol: HOST_PROTOCOL
  })

const serveAt = async (
  addr: ReturnType<typeof hostAddress>,
  over: {
    version?: string
    onIdle?: (o?: { resume?: boolean }) => void
    workingTasks?: () => number
    onAppGreeted?: Parameters<typeof startHostServer>[0]['onAppGreeted']
  } = {}
): Promise<HostServer> => {
  const s = await startHostServer({
    address: addr.address,
    dirToPrepare: addr.dirToPrepare,
    version: over.version ?? '9.9.9',
    idleMs: 60_000,
    onIdle: over.onIdle ?? ((): void => {}),
    workingTasks: over.workingTasks,
    onAppGreeted: over.onAppGreeted,
    hostKey: KEY,
    log: { write: () => {}, close: () => {} }
  })
  servers.push(s)
  return s
}

const settled = async (c: HostClient, want: (s: ReturnType<HostClient['status']>) => boolean): Promise<void> => {
  for (let i = 0; i < 60; i++) {
    if (want(c.status())) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`status never settled: ${JSON.stringify(c.status())}`)
}

/** Same shape as `settled`, for a condition that is not the client's status — here, whether a
 *  message broadcast from the server has made it across the real socket to a subscriber yet. */
const waitFor = async (want: () => boolean): Promise<void> => {
  for (let i = 0; i < 60; i++) {
    if (want()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('condition never became true')
}

/** A peer that speaks the handshake itself, so a test decides what happens after it: which features
 *  the hello names, and whether anything ever answers a ping. `startHostServer` cannot be made to
 *  ignore a ping — it answers one — and ignoring it is the whole case under test here. */
const rawHost = async (
  addr: ReturnType<typeof hostAddress>,
  features: string[]
): Promise<{ sockets: net.Socket[]; got: Array<{ t: string }>; close(): Promise<void> }> => {
  if (addr.dirToPrepare) await fs.mkdir(addr.dirToPrepare, { recursive: true, mode: 0o700 })
  const sockets: net.Socket[] = []
  const got: Array<{ t: string }> = []
  const server = net.createServer((sock) => {
    sockets.push(sock)
    sock.setEncoding('utf8')
    sock.on(
      'data',
      createLineReader({
        onMessage: (v) => {
          const m = v as { t: string; nonce?: string }
          got.push(m)
          if (m.t === 'hello') {
            sock.write(
              encodeLine({
                t: 'hello',
                protocol: HOST_PROTOCOL,
                host: '9.9.9',
                pid: 4242,
                startedAt: '2026-09-22T00:00:00.000Z',
                features,
                proof: hostProof(KEY, m.nonce ?? '')
              })
            )
          }
        },
        onBadLine: () => {},
        onHandlerError: () => {}
      })
    )
  })
  await new Promise<void>((r) => server.listen(addr.address, r))
  return {
    sockets,
    got,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy()
        server.close(() => r())
      })
  }
}

describe('HostClient — the Host proves itself (protocol 4)', () => {
  /** Something at the address that says hello the way a Host does but holds no key of this profile:
   *  another account's process on a shared Windows machine. Records every line it is sent. */
  const squatter = async (
    addr: ReturnType<typeof hostAddress>,
    proofFor: (nonce: string) => string | undefined,
    before: HostMessage[] = []
  ): Promise<{ got: Array<{ t: string }>; close(): Promise<void> }> => {
    if (addr.dirToPrepare) await fs.mkdir(addr.dirToPrepare, { recursive: true, mode: 0o700 })
    const got: Array<{ t: string }> = []
    const sockets: net.Socket[] = []
    const server = net.createServer((sock) => {
      sockets.push(sock)
      sock.setEncoding('utf8')
      sock.on(
        'data',
        createLineReader({
          onMessage: (v) => {
            const m = v as { t: string; nonce?: string }
            got.push(m)
            if (m.t !== 'hello') return
            for (const b of before) sock.write(encodeLine(b))
            const proof = proofFor(m.nonce ?? '')
            sock.write(encodeLine({ t: 'hello', protocol: HOST_PROTOCOL, host: '9.9.9', pid: 4242, startedAt: 't', features: ['ping'], ...(proof ? { proof } : {}) }))
          },
          onBadLine: () => {},
          onHandlerError: () => {}
        })
      )
    })
    await new Promise<void>((r) => server.listen(addr.address, r))
    return {
      got,
      close: () =>
        new Promise<void>((r) => {
          for (const s of sockets) s.destroy()
          server.close(() => r())
        })
    }
  }

  for (const [name, proofFor] of [
    ['no proof', (): undefined => undefined],
    ['a proof under another key', (nonce: string): string => hostProof('f'.repeat(64), nonce)]
  ] as const) {
    it(`does not connect to a hello with ${name}, and sends it nothing after the hello`, async () => {
      const addr = addressFor(`squat-${name.length}`)
      const sq = await squatter(addr, proofFor)
      const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {}, attempts: 3, retryMs: 20 })
      c.start()
      await settled(c, (s) => s.problem !== null)
      expect(c.status().connected).toBe(false)
      expect(c.status().problem).toContain('could not prove')
      await new Promise((r) => setTimeout(r, 150))
      expect(sq.got.map((m) => m.t)).toEqual(['hello'])
      await c.stop()
      await sq.close()
    })
  }

  it('hands a subscriber nothing a peer sends before it has proven itself', async () => {
    const addr = addressFor('squat-early')
    const sq = await squatter(addr, () => undefined, [{ t: 'pty-data', id: 'x', data: 'rm -rf ~\r' } as HostMessage])
    const heard: string[] = []
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {}, attempts: 3, retryMs: 20 })
    c.onMessage((m) => heard.push(m.t))
    c.start()
    await settled(c, (s) => s.problem !== null)
    expect(heard).toEqual([])
    await c.stop()
    await sq.close()
  })

  it('does not trust any hello while this profile has no key', async () => {
    const addr = addressFor('no-key')
    await serveAt(addr)
    const c = new HostClient({ hostKey: async () => null, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {}, attempts: 3, retryMs: 20 })
    c.start()
    await settled(c, (s) => s.problem !== null)
    expect(c.status().connected).toBe(false)
    expect(c.status().problem).toContain('has no Host key')
    await c.stop()
  })

  it('connects to a Host that proves itself with this profile key', async () => {
    const addr = addressFor('proven')
    await serveAt(addr)
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await settled(c, (s) => s.connected)
    expect(c.status().problem).toBeNull()
    await c.stop()
  })
})

describe('HostClient', () => {
  // Security review 2026-09-28: the Host refused to serve from a directory another user could have
  // made (server.test.ts), but the app connected to whatever answered there — and then sent it every
  // terminal's environment and keystrokes. The app now asks the same question before connecting.
  it.skipIf(process.platform === 'win32')('never attaches to a socket in a directory open to everyone', async () => {
    const addr = addressFor('squat')
    await fs.mkdir(addr.dirToPrepare!, { recursive: true })
    await fs.chmod(addr.dirToPrepare!, 0o777)
    const squatter = net.createServer((sock) => {
      sock.setEncoding('utf8')
      sock.write(encodeLine({ t: 'hello', protocol: HOST_PROTOCOL, host: '9.9.9', pid: 4242, startedAt: 't', features: [] }))
    })
    await new Promise<void>((r) => squatter.listen(addr.address, r))
    const logs: string[] = []
    let spawnAsked = 0
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => { spawnAsked += 1 }, log: (m) => logs.push(m), attempts: 2, retryMs: 10 })
    c.start()
    await waitFor(() => spawnAsked > 0)
    await c.stop()
    squatter.close()
    expect(c.status().connected).toBe(false)
    expect(logs.some((l) => l.includes('not a directory only this user can open'))).toBe(true)
  })

  it('connects to a Host that is already there and reports what it found', async () => {
    const addr = addressFor('already')
    await serveAt(addr, { version: '1.2.3' })
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await settled(c, (s) => s.connected)
    expect(c.status()).toMatchObject({ connected: true, protocol: HOST_PROTOCOL, hostVersion: '1.2.3', problem: null })
    expect(c.status().pid).toBe(process.pid)
    await c.stop()
  })

  it('reports the features a hello names', async () => {
    const addr = addressFor('features')
    await serveAt(addr)
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await settled(c, (s) => s.connected)
    expect(c.status().features).toEqual(['proc', 'ping', 'handover', 'handover-chats', 'pty-seq'])
    await c.stop()
  })

  it('says hello as the app and yields worktrees to the Host (S3 ruling R4)', async () => {
    const addr = addressFor('yields')
    const host = await rawHost(addr, [])
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await waitFor(() => host.got.some((m) => m.t === 'hello'))
    expect(host.got.find((m) => m.t === 'hello')).toMatchObject({ role: 'app' })
    expect((host.got.find((m) => m.t === 'hello') as { yields?: string[] }).yields).toContain('worktrees')
    // Leftovers Task 1 (S6-3): its own pid too, so the Host can ask whether it lives without app.pid.
    expect(host.got.find((m) => m.t === 'hello')).toMatchObject({ pid: process.pid })
    await c.stop()
    await host.close()
  })

  // S4 (§4.2): the app hands the Host dispatch as well, S6 (R3) rolling, and chat takeover its chat
  // sessions, and the Host journal the journal (only once the app stops writing it, Task 7). It reads
  // `orch-state` as the latest (stage 3 T4), so the Host may skip a push a newer one replaces. An older
  // Host ignores the names (D5).
  it('says it yields dispatch, rolling, chat-takeover and journal as well as worktrees', async () => {
    const addr = addressFor('yields-dispatch')
    const host = await rawHost(addr, [])
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await waitFor(() => host.got.some((m) => m.t === 'hello'))
    expect((host.got.find((m) => m.t === 'hello') as { yields?: string[] }).yields).toEqual([HOST_YIELD_WORKTREES, HOST_YIELD_DISPATCH, HOST_YIELD_ROLLING, HOST_YIELD_CHAT_TAKEOVER, HOST_YIELD_JOURNAL, HOST_YIELD_UNDERSTANDING, HOST_YIELD_WORKSPACE, HOST_YIELD_ORCH_STATE_LATEST, HOST_YIELD_WORK_UNITS, HOST_YIELD_RECOVERY, HOST_YIELD_SLACK])
    expect((host.got.find((m) => m.t === 'hello') as { yields?: string[] }).yields).toContain('slack')
    await c.stop()
    await host.close()
  })

  // Slack in the Host Task 8 carry 3: an app holding its Slack socket leaves the slack yield out of that
  // hello, or the Host opens its socket beside the app's before the app hears the reply. Asked at every
  // hello; a throwing question is read as "keeps" (no second socket), logged.
  it('leaves the slack yield out of a hello while keepsSlack says this app holds Slack', async () => {
    const addr = addressFor('yields-slack')
    const host = await rawHost(addr, [])
    let keeps: () => boolean = () => true
    const logs: string[] = []
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: (m) => logs.push(m), keepsSlack: () => keeps() })
    c.start()
    await waitFor(() => host.got.some((m) => m.t === 'hello'))
    const yields = (host.got.find((m) => m.t === 'hello') as { yields?: string[] }).yields
    expect(yields).not.toContain('slack')
    expect(yields).toContain('rolling')
    await c.stop()
    await host.close()
    keeps = () => { throw new Error('boom') }
    const addr2 = addressFor('yields-slack-throw')
    const host2 = await rawHost(addr2, [])
    const c2 = new HostClient({ hostKey, address: addr2.address, appVersion: '9.0.0', spawnHost: () => {}, log: (m) => logs.push(m), keepsSlack: () => keeps() })
    c2.start()
    await waitFor(() => host2.got.some((m) => m.t === 'hello'))
    expect((host2.got.find((m) => m.t === 'hello') as { yields?: string[] }).yields).not.toContain('slack')
    expect(logs.some((m) => m.includes('keepsSlack'))).toBe(true)
    await c2.stop()
    await host2.close()
    keeps = () => false
    const addr3 = addressFor('yields-slack-free')
    const host3 = await rawHost(addr3, [])
    const c3 = new HostClient({ hostKey, address: addr3.address, appVersion: '9.0.0', spawnHost: () => {}, log: (m) => logs.push(m), keepsSlack: () => keeps() })
    c3.start()
    await waitFor(() => host3.got.some((m) => m.t === 'hello'))
    expect((host3.got.find((m) => m.t === 'hello') as { yields?: string[] }).yields).toContain('slack')
    await c3.stop()
    await host3.close()
  })

  // Task 14 review I1: the app's `hostDrives()` over the real status. An unresponsive Host that announced
  // dispatch is still driving, so the app keeps yielding; a real drop hands the drive back in the same
  // turn the close is seen (the disconnect subscribers run after the status is set).
  it('keeps a dispatch Host driving while unresponsive, and gives the drive back in the turn it drops', async () => {
    const addr = addressFor('dispatch-drop')
    const host = await rawHost(addr, ['proc', 'ping', 'spawn', 'worktrees', 'dispatch'])
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await settled(c, (st) => st.connected)
    expect(hostSpeaksDispatch(c.status())).toBe(true)
    c.markUnresponsive('the Host did not answer a ping')
    expect(hostSpeaksDispatch(c.status())).toBe(true)
    let atDrop: boolean | null = null
    c.onDisconnect(() => {
      atDrop ??= hostSpeaksDispatch(c.status())
    })
    await host.close()
    await waitFor(() => atDrop !== null)
    expect(atDrop).toBe(false)
    await c.stop()
  })

  // An older Host's hello carries no `features` at all — absent means none, not a parse failure.
  it('defaults to no features for a hello that does not name any', async () => {
    const addr = addressFor('no-features')
    // The same line the two silent servers below carry. A raw listener does not go through
    // startHostServer, which is what creates this directory, and on posix the address is a socket
    // inside it — so without this the listen fails and the test times out waiting to connect. Windows
    // passed regardless: its address is a named pipe and `dirToPrepare` is null there.
    if (addr.dirToPrepare) await fs.mkdir(addr.dirToPrepare, { recursive: true, mode: 0o700 })
    const raw = net.createServer((sock) => {
      sock.setEncoding('utf8')
      const read = createLineReader({
        onMessage: (v) => {
          const nonce = (v as { nonce?: string }).nonce ?? ''
          sock.write(encodeLine({ t: 'hello', protocol: HOST_PROTOCOL, host: '1.0.0', pid: process.pid, startedAt: new Date().toISOString(), proof: hostProof(KEY, nonce) }))
        },
        onBadLine: () => {},
        onHandlerError: () => {}
      })
      sock.on('data', read)
    })
    await new Promise<void>((resolve) => raw.listen(addr.address, resolve))
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await settled(c, (s) => s.connected)
    expect(c.status().features).toEqual([])
    await c.stop()
    await new Promise<void>((resolve) => raw.close(() => resolve()))
  })

  it('asks for a Host when none answers, and connects once it appears', async () => {
    const addr = addressFor('spawned')
    let asked = 0
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      spawnHost: () => {
        asked += 1
        void serveAt(addr)
      },
      log: () => {}
    })
    c.start()
    await settled(c, (s) => s.connected)
    expect(asked).toBe(1)
    await c.stop()
  })

  // Stage 3 task 2: spawnHost now waits for the runtime install before it spawns, and a first install
  // after an update can run for many seconds (87 MB of node.exe, then an antivirus scan). The attempts
  // to reach the address are for the Host binding after its process starts — counting them while the
  // spawn has not even happened would give up on a Host that was never started.
  it('waits for an asynchronous spawnHost before counting its attempts', async () => {
    const addr = addressFor('slow-spawn')
    let spawned = false
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      attempts: 3,
      retryMs: 10,
      spawnHost: async () => {
        // Far longer than attempts × retryMs.
        await new Promise((r) => setTimeout(r, 200))
        spawned = true
        void serveAt(addr)
      },
      log: () => {}
    })
    c.start()
    await settled(c, (s) => s.connected || s.problem !== null)
    expect(spawned).toBe(true)
    expect(c.status().connected).toBe(true)
    await c.stop()
  })

  // Review of S3-T2, finding 1: the install is awaited between the client's own `stopped` check and
  // the spawn. The updater's stop() — or the app quitting — landing during a slow repair must not end
  // with a detached Host started behind the update.
  it('tells spawnHost it is no longer wanted once the client was stopped during the wait', async () => {
    const addr = addressFor('stop-during-install')
    let release!: () => void
    const installed = new Promise<void>((r) => (release = r))
    const wantedAfter: boolean[] = []
    let asked = false
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      attempts: 2,
      retryMs: 10,
      spawnHost: async (ctx) => {
        asked = true
        await installed
        wantedAfter.push(ctx.wanted())
      },
      log: () => {}
    })
    c.start()
    await waitFor(() => asked)
    await c.stop()
    release()
    await waitFor(() => wantedAfter.length === 1)
    expect(wantedAfter).toEqual([false])
    // A stopped client gives no reason: nothing failed, it was asked to stop.
    expect(c.status().problem).toBeNull()
  })

  it('tells a superseded cycle its spawn is not wanted when a restart began another', async () => {
    const addr = addressFor('restart-during-install')
    const releases: Array<() => void> = []
    const wanted: boolean[] = []
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      attempts: 2,
      retryMs: 10,
      spawnHost: async (ctx) => {
        await new Promise<void>((r) => releases.push(r))
        wanted.push(ctx.wanted())
      },
      log: () => {}
    })
    c.start()
    await waitFor(() => releases.length === 1)
    await c.stop()
    c.restart()
    await waitFor(() => releases.length === 2)
    releases[0]()
    releases[1]()
    await waitFor(() => wanted.length === 2)
    expect(wanted).toEqual([false, true])
    await c.stop()
  })

  // Review of S3-T2, minor 3: `ready(ms)` is what reattach and *Restart now* wait on, and both used to
  // read an install still running as "no Host". Time spent inside an asynchronous spawnHost — the
  // runtime being installed — does not count against it.
  // The install outlasts the wait (1.2 s against 1 s), so a wait that counted it would run out; the wait then has its
  // whole second to connect, since a loaded CI runner took about 190 ms to connect after a 300 ms install against a 100 ms
  // wait (macOS, 2026-10-15). The Host listens before the install returns, as a started Host soon does.
  it('does not let ready() run out while spawnHost is still installing', async () => {
    const addr = addressFor('ready-during-install')
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      retryMs: 10,
      spawnHost: async () => {
        await new Promise((r) => setTimeout(r, 1_200))
        await serveAt(addr)
      },
      log: () => {}
    })
    c.start()
    await c.ready(1_000)
    expect(c.status().connected).toBe(true)
    await c.stop()
  })

  it('reports a rejected asynchronous spawnHost as a problem, not an unhandled rejection', async () => {
    const addr = addressFor('spawn-rejects')
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      attempts: 2,
      retryMs: 10,
      spawnHost: async () => {
        throw new Error('EACCES')
      },
      log: () => {}
    })
    c.start()
    await settled(c, (s) => s.problem !== null)
    expect(c.status().problem).toContain('EACCES')
    await c.stop()
  })

  // A Host on another protocol holds nothing in slice 1, so the app tells it to leave. What comes
  // next is the ordinary reconnect: the Host the app then starts is from its own build, so it speaks
  // the app's protocol. Slice 2 has to answer this differently.
  it('retires a Host on another protocol', async () => {
    const addr = addressFor('mismatch')
    let retired = false
    let old: HostServer | null = null
    old = await serveAt(addr, { onIdle: () => { retired = true; void old?.close() } })
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      protocol: HOST_PROTOCOL + 1,
      spawnHost: () => {},
      log: () => {}
    })
    c.start()
    await settled(c, () => retired)
    expect(retired).toBe(true)
    await c.stop()
  })

  it('reports the reason when there is no Host and none can be started', async () => {
    const addr = addressFor('never')
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {}, attempts: 2, retryMs: 10 })
    c.start()
    await settled(c, (s) => s.problem !== null)
    expect(c.status().connected).toBe(false)
    expect(c.status().problem).toContain('no Host')
    await c.stop()
  })

  // A peer that accepts and then says nothing is not a dropped connection: nothing closes, so the
  // close-and-backoff path never runs. Without a deadline of its own the status would sit at
  // "not connected, no reason" for the app's whole life, with no retry.
  //
  // **And it is not a peer to try again, either.** A Host whose event loop is stuck answers the next
  // connect exactly as it answered this one — measured 2026-09-22, where `end()` never brought a
  // 'close' back from one and the client therefore never retried and never updated its status. So the
  // socket is destroyed, the state says `unresponsive`, and the way on is the Info tab's button.
  it('marks a peer that accepts and never says hello as unresponsive, and does not try again', async () => {
    const addr = addressFor('silent')
    if (addr.dirToPrepare) await fs.mkdir(addr.dirToPrepare, { recursive: true, mode: 0o700 })
    const held: net.Socket[] = []
    let connections = 0
    const silent = net.createServer((sock) => {
      connections += 1
      held.push(sock)
    })
    await new Promise<void>((r) => silent.listen(addr.address, r))
    try {
      const c = new HostClient({ hostKey,
        address: addr.address,
        appVersion: '9.0.0',
        spawnHost: () => {},
        log: () => {},
        helloMs: 60
      })
      c.start()
      await settled(c, (s) => s.unresponsive)
      expect(c.status().connected).toBe(false)
      expect(c.status().problem).toContain('did not answer')
      expect(c.sawPeer()).toBe(true)
      await new Promise((r) => setTimeout(r, 200))
      expect(connections).toBe(1)
      await c.stop()
    } finally {
      for (const sock of held) sock.destroy()
      await new Promise<void>((r) => silent.close(() => r()))
    }
  })

  // The 2026-10 blank start: the app was opened while the previous Host was leaving. That Host keeps its
  // address bound for about a minute and destroys every new connection on arrival, and the hang-up
  // landed while the client was still reading the Host key — before `attach` listened for it. The hello
  // went nowhere, the handshake deadline called the Host unresponsive, and nothing ever retried.
  it('waits out a Host that hangs up during the key read, then starts and reaches the next one', async () => {
    const addr = addressFor('retiring')
    if (addr.dirToPrepare) await fs.mkdir(addr.dirToPrepare, { recursive: true, mode: 0o700 })
    let hangUps = 0
    const leaving = net.createServer((sock) => {
      hangUps += 1
      sock.destroy()
    })
    await new Promise<void>((r) => leaving.listen(addr.address, r))
    let spawned = 0
    const seen: Array<ReturnType<HostClient['status']>> = []
    const c = new HostClient({
      // Slower than the hang-up, so the 'close' fires before `attach` runs.
      hostKey: () => new Promise((r) => setTimeout(() => r(KEY), 30)),
      address: addr.address,
      appVersion: '9.0.0',
      spawnHost: async () => {
        spawned += 1
        await serveAt(addr)
      },
      log: () => {},
      helloMs: 60,
      retiringRetryMs: 20
    })
    c.onStatusChange((s) => seen.push(s))
    c.start()
    const ready = c.ready(100)
    await settled(c, (s) => s.waitingForPreviousHost === true)
    await waitFor(() => hangUps >= 3)
    // Still waiting, not written off: the handshake deadline (60ms) has long passed by now.
    expect(c.status()).toMatchObject({ connected: false, unresponsive: false, waitingForPreviousHost: true })
    expect(spawned).toBe(0)
    // The old Host finally lets go of the address; the next try finds nothing there and starts one.
    await new Promise<void>((r) => leaving.close(() => r()))
    await settled(c, (s) => s.connected)
    // `ready()` waited the whole time rather than expiring into "no Host".
    await ready
    expect(spawned).toBe(1)
    expect(c.status()).toMatchObject({ connected: true, waitingForPreviousHost: false, problem: null })
    expect(seen.some((s) => s.unresponsive)).toBe(false)
    await c.stop()
  })

  it('gives up waiting for a leaving Host after the bound and says why', async () => {
    const addr = addressFor('stuck-leaving')
    if (addr.dirToPrepare) await fs.mkdir(addr.dirToPrepare, { recursive: true, mode: 0o700 })
    const leaving = net.createServer((sock) => sock.destroy())
    await new Promise<void>((r) => leaving.listen(addr.address, r))
    try {
      const c = new HostClient({ hostKey,
        address: addr.address,
        appVersion: '9.0.0',
        spawnHost: () => {},
        log: () => {},
        retiringRetryMs: 20,
        retiringWaitMs: 100
      })
      c.start()
      await settled(c, (s) => s.problem?.includes('had not finished shutting down') === true)
      expect(c.status()).toMatchObject({ connected: false, unresponsive: false, waitingForPreviousHost: false })
      await c.stop()
    } finally {
      await new Promise<void>((r) => leaving.close(() => r()))
    }
  })

  // The 2026-09-22 failure, in the case the app was already connected for: the Host had answered
  // every message for a day, then stopped answering anything at all mid-spawn. Nothing closed, so
  // nothing in the client noticed.
  it('marks a Host that stops answering pings as unresponsive, and takes it back when one arrives', async () => {
    const addr = addressFor('heartbeat')
    const h = await rawHost(addr, ['proc', 'ping'])
    try {
      const c = new HostClient({ hostKey,
        address: addr.address,
        appVersion: '9.0.0',
        spawnHost: () => {},
        log: () => {},
        pingMs: 20,
        pingMisses: 3
      })
      const seen: boolean[] = []
      c.onStatusChange((s) => seen.push(s.unresponsive))
      c.start()
      await settled(c, (s) => s.connected)
      await settled(c, (s) => s.unresponsive)
      expect(c.status()).toMatchObject({ connected: false, unresponsive: true, pid: 4242 })
      expect(c.status().problem).toContain('stopped answering')
      // Waited for, not read at once: the client reaches its verdict as it sends the third ping, and
      // that ping still has to cross the socket to this peer.
      await waitFor(() => h.got.filter((m) => m.t === 'ping').length >= 3)
      // A late answer is the one thing that takes the state back — which is why the pings do not stop.
      //
      // **Caught as the status change, not polled.** This peer never answers the pings after it, so the
      // heartbeat calls it unresponsive again `pingMisses` intervals later: the recovered state lasts
      // about 60ms here. `settled` samples every 50ms, and on a loaded runner (ubuntu CI, or WSL under
      // load: 19 of 20 runs) it lands on both sides of that window and never sees it.
      const back = new Promise<ReturnType<HostClient['status']>>((resolve) => {
        const off = c.onStatusChange((s) => {
          if (!s.connected || s.unresponsive) return
          off()
          resolve(s)
        })
      })
      h.sockets[0].write(encodeLine({ t: 'pong', seq: 1 }))
      expect(await back).toMatchObject({ connected: true, unresponsive: false, problem: null })
      expect(seen).toContain(true)
      expect(seen).toContain(false)
      await c.stop()
    } finally {
      await h.close()
    }
  })

  it('never pings a Host that did not announce the feature, and never calls it unresponsive for that', async () => {
    const addr = addressFor('no-ping')
    const h = await rawHost(addr, ['proc'])
    try {
      const c = new HostClient({ hostKey,
        address: addr.address,
        appVersion: '9.0.0',
        spawnHost: () => {},
        log: () => {},
        pingMs: 20,
        pingMisses: 3
      })
      c.start()
      await settled(c, (s) => s.connected)
      await new Promise((r) => setTimeout(r, 200))
      expect(h.got.some((m) => m.t === 'ping')).toBe(false)
      expect(c.status()).toMatchObject({ connected: true, unresponsive: false })
      await c.stop()
    } finally {
      await h.close()
    }
  })

  // The judge for a Host too old for the heartbeat: ipc.ts calls this when a request that does have an
  // answer runs its deadline out. Any message from the Host afterwards proves the loop alive again.
  it('can be told the Host is unresponsive, and recovers on the next message from it', async () => {
    const addr = addressFor('told')
    const s = await serveAt(addr)
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await settled(c, (st) => st.connected)
    c.markUnresponsive('the Host did not answer a pty-list within 5s')
    expect(c.status()).toMatchObject({
      connected: false,
      unresponsive: true,
      problem: 'the Host did not answer a pty-list within 5s'
    })
    s.broadcast({ t: 'pty-data', id: 'x', data: 'hello' })
    await settled(c, (st) => st.connected)
    expect(c.status()).toMatchObject({ unresponsive: false, problem: null })
    await c.stop()
  })

  // **The heartbeat must not talk over what came after it.** It reaches the verdict every interval for
  // as long as the silence lasts, and the sentence that matters by then is a later, more specific one:
  // a restart that could not end the Host. Overwriting that four seconds later leaves a person with a
  // button that appears to do nothing and no reason anywhere (measured in the dev app, 2026-09-22).
  it('keeps a later reason for the silence, rather than restating the general one', async () => {
    const addr = addressFor('later-reason')
    const h = await rawHost(addr, ['proc', 'ping'])
    try {
      const c = new HostClient({ hostKey,
        address: addr.address,
        appVersion: '9.0.0',
        spawnHost: () => {},
        log: () => {},
        pingMs: 20,
        pingMisses: 3
      })
      c.start()
      await settled(c, (s) => s.unresponsive)
      const first = c.status().problem
      c.markUnresponsive('pid 80052 is not this app’s Host, so it was not ended')
      // Several heartbeat intervals: the verdict is reached again and again, and says nothing.
      await new Promise((r) => setTimeout(r, 200))
      expect(c.status().problem).toBe('pid 80052 is not this app’s Host, so it was not ended')
      expect(first).not.toBe(c.status().problem)
      await c.stop()
    } finally {
      await h.close()
    }
  })

  // Read at every hello rather than once: the answer belongs to the Host that just answered, and the
  // next one may be started from a runtime that has since been repaired.
  it('reports whether the runtime this Host runs from is incomplete', async () => {
    const addr = addressFor('incomplete')
    await serveAt(addr)
    let incomplete = true
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      spawnHost: () => {},
      log: () => {},
      runtimeIncomplete: () => incomplete
    })
    c.start()
    await settled(c, (s) => s.connected)
    expect(c.status().runtimeIncomplete).toBe(true)
    incomplete = false
    await c.stop()
  })

  // "we could not reach a Host" and "the Host we reached told us nothing" are different answers, and
  // only `problem` distinguishes them today — a sentence, which is the wrong thing to branch on. The
  // boot has to branch on it: it decides whether an open Dispatch is written off as lost.
  it('says it never saw a peer when nothing ever answered the address', async () => {
    const addr = addressFor('saw-none')
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {}, attempts: 2, retryMs: 10 })
    c.start()
    await c.ready(3_000)
    expect(c.sawPeer()).toBe(false)
    await c.stop()
  })

  it('remembers a peer that accepted the connection even though it never said hello', async () => {
    const addr = addressFor('saw-silent')
    if (addr.dirToPrepare) await fs.mkdir(addr.dirToPrepare, { recursive: true, mode: 0o700 })
    const held: net.Socket[] = []
    const silent = net.createServer((sock) => held.push(sock))
    await new Promise<void>((r) => silent.listen(addr.address, r))
    try {
      const c = new HostClient({ hostKey,
        address: addr.address,
        appVersion: '9.0.0',
        spawnHost: () => {},
        log: () => {},
        helloMs: 60
      })
      c.start()
      await settled(c, (s) => s.problem !== null)
      expect(c.status().connected).toBe(false)
      expect(c.sawPeer()).toBe(true)
      await c.stop()
    } finally {
      for (const sock of held) sock.destroy()
      await new Promise<void>((r) => silent.close(() => r()))
    }
  })

  it('remembers a peer it shook hands with', async () => {
    const addr = addressFor('saw-connected')
    await serveAt(addr)
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await c.ready(3_000)
    expect(c.sawPeer()).toBe(true)
    await c.stop()
  })

  it('keeps its status once it is stopped', async () => {
    const addr = addressFor('stopped')
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {}, attempts: 1, retryMs: 10 })
    c.start()
    await c.stop()
    const before = c.status()
    await new Promise((r) => setTimeout(r, 100))
    expect(c.status()).toEqual(before)
  })

  it('does not connect after it has been stopped', async () => {
    const addr = addressFor('stop-races-connect')
    await serveAt(addr)
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await c.stop()
    await new Promise((r) => setTimeout(r, 300))
    expect(c.status().connected).toBe(false)
  })

  // A no-op spawn hides this in a test; in the app this call launches a real detached process.
  it('does not start a Host after it has been stopped', async () => {
    const addr = addressFor('stop-before-spawn')
    let asked = 0
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      spawnHost: () => { asked += 1 },
      log: () => {},
      attempts: 5,
      retryMs: 10
    })
    c.start()
    await c.stop()
    await new Promise((r) => setTimeout(r, 200))
    expect(asked).toBe(0)
  })

  // The pty-* messages this task adds all arrive this way, over a real connection, not through the
  // fake transport ptyFactory.test.ts drives — this is the class actually doing the fan-out.
  it('fans a message out to every subscriber, survives one that throws, and stops after unsubscribe', async () => {
    const addr = addressFor('fan-out')
    const server = await serveAt(addr)
    const logs: string[] = []
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: (m) => logs.push(m) })
    c.start()
    await settled(c, (s) => s.connected)

    const received: HostMessage[] = []
    c.onMessage(() => {
      throw new Error('subscriber one blew up')
    })
    const unsubTwo = c.onMessage((m) => received.push(m))

    server.broadcast({ t: 'pty-data', id: 'p1', data: 'hi' })
    await waitFor(() => received.length > 0)
    expect(received).toEqual([{ t: 'pty-data', id: 'p1', data: 'hi' }])
    expect(logs.some((l) => l.includes('subscriber threw') && l.includes('subscriber one blew up'))).toBe(true)

    unsubTwo()
    server.broadcast({ t: 'pty-data', id: 'p1', data: 'after unsubscribe' })
    // Nothing to wait for that would prove absence, so give the real socket a beat to have delivered
    // it if it were going to.
    await new Promise((r) => setTimeout(r, 150))
    expect(received).toEqual([{ t: 'pty-data', id: 'p1', data: 'hi' }])

    await c.stop()
  })

  // Every pty the Host held went with it, and nothing else says so — ptyFactory.ts's onHostGone
  // handle relies on this firing so a Host-backed pty does not read as "running" forever once the
  // Host itself is gone.
  it('tells its subscribers when the connection to the Host drops, and survives one that throws', async () => {
    const addr = addressFor('disconnect')
    const server = await serveAt(addr)
    const logs: string[] = []
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: (m) => logs.push(m) })
    c.start()
    await settled(c, (s) => s.connected)

    let gone = 0
    c.onDisconnect(() => {
      throw new Error('disconnect subscriber one blew up')
    })
    c.onDisconnect(() => {
      gone += 1
    })
    await server.close()
    await waitFor(() => gone > 0)
    expect(gone).toBe(1)
    expect(logs.some((l) => l.includes('disconnect subscriber threw') && l.includes('blew up'))).toBe(true)

    await c.stop()
  })

  // stop() destroys the socket too, but that is the app choosing to leave, not the Host going away —
  // onHostGone must not treat the two alike, or every ordinary shutdown would read as a dead pty.
  it('does not treat a deliberate stop as the Host disappearing', async () => {
    const addr = addressFor('stop-is-quiet')
    await serveAt(addr)
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    await settled(c, (s) => s.connected)

    let gone = 0
    c.onDisconnect(() => {
      gone += 1
    })
    await c.stop()
    await new Promise((r) => setTimeout(r, 150))
    expect(gone).toBe(0)
  })

  // A dropped-and-reconnected Host is not the same event happening twice. The subscriber set must
  // survive the first firing (no going quiet on the next drop) and each drop must still cost exactly
  // one notification (no double-firing).
  it('re-arms after a reconnect, rather than firing twice for one drop or going quiet for the next', async () => {
    const addr = addressFor('disconnect-rearm')
    let server = await serveAt(addr)
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      spawnHost: () => {
        void serveAt(addr).then((s) => {
          server = s
        })
      },
      log: () => {},
      retryMs: 10
    })
    c.start()
    await settled(c, (s) => s.connected)

    let gone = 0
    c.onDisconnect(() => {
      gone += 1
    })

    await server.close()
    await waitFor(() => gone === 1)
    await settled(c, (s) => s.connected) // reconnected to the Host spawnHost brought back
    expect(gone).toBe(1) // reconnecting on its own must not have fired a second notification

    await server.close()
    await waitFor(() => gone === 2)

    await c.stop()
  })

  // The other half of onDisconnect. A drop ends every pty handle in the app, but the Host may well
  // still be running those ptys — so the reconnect has to be an event somebody can act on, and it has
  // to say *which* Host answered: the same one still holds them, a fresh one holds nothing.
  it('reports each completed handshake, with the Host identity that tells a reconnect from a new Host', async () => {
    const addr = addressFor('connect-identity')
    let server = await serveAt(addr)
    const seen: Array<{ pid: number; startedAt: string }> = []
    const logs: string[] = []
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      spawnHost: () => {
        void serveAt(addr).then((s) => {
          server = s
        })
      },
      log: (m) => logs.push(m),
      retryMs: 10
    })
    c.onConnect((h) => seen.push(h))
    c.onConnect(() => {
      throw new Error('connect subscriber one blew up')
    })
    c.start()
    await waitFor(() => seen.length === 1)
    expect(seen[0].pid).toBe(process.pid)

    await server.close()
    await settled(c, (s) => s.connected)
    await waitFor(() => seen.length === 2)
    // Same process here, so `pid` alone cannot tell them apart — `startedAt` is what does, which is
    // exactly the case a Host that died and was respawned presents.
    expect(seen[1].startedAt).not.toBe(seen[0].startedAt)
    expect(logs.some((l) => l.includes('connect subscriber threw') && l.includes('blew up'))).toBe(true)

    await c.stop()
  })

  // ready() is what lets startup decide the ptyRouter fallback without blocking on a Host that never
  // answers — see reattach.ts and its report for why HostClient grew this beyond what the brief named.
  it('ready() resolves once the handshake completes, well before its own timeout', async () => {
    const addr = addressFor('ready-connects')
    await serveAt(addr)
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '9.0.0', spawnHost: () => {}, log: () => {} })
    c.start()
    const start = Date.now()
    await c.ready(5_000)
    expect(Date.now() - start).toBeLessThan(2_000)
    expect(c.status().connected).toBe(true)
    await c.stop()
  })

  it('ready() resolves once the client gives up, without waiting out the full timeout', async () => {
    const addr = addressFor('ready-gives-up')
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      spawnHost: () => {},
      log: () => {},
      attempts: 2,
      retryMs: 10
    })
    c.start()
    const start = Date.now()
    await c.ready(5_000)
    expect(Date.now() - start).toBeLessThan(2_000)
    expect(c.status().connected).toBe(false)
    expect(c.status().problem).not.toBeNull()
    await c.stop()
  })

  it('ready() gives up waiting at its own timeout while the client is still trying', async () => {
    const addr = addressFor('ready-times-out')
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '9.0.0',
      spawnHost: () => {},
      log: () => {},
      attempts: 100,
      retryMs: 50
    })
    c.start()
    const start = Date.now()
    await c.ready(120)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(100)
    expect(elapsed).toBeLessThan(1_000)
    expect(c.status().connected).toBe(false)
    await c.stop()
  })
})

describe('HostClient.restart', () => {
  // retire() is stop() plus a polite word to the Host; restart() is the counterpart that brings the
  // same cycle back so an outdated Host can be *replaced* rather than merely ended
  // (docs/superpowers/specs/2026-09-14-host-replacement-design.md §5).
  it('connects again after stop(), to whatever is at the address now', async () => {
    const addr = addressFor('restart-a')
    const first = await serveAt(addr, { version: '1.0.0' })
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '2.0.0', log: () => {}, spawnHost: () => {} })
    c.start()
    await settled(c, (s) => s.connected && s.hostVersion === '1.0.0')
    await c.stop()
    await first.close()
    servers = servers.filter((s) => s !== first)
    const second = await serveAt(addr, { version: '2.0.0' })
    void second
    c.restart()
    await settled(c, (s) => s.connected && s.hostVersion === '2.0.0')
    expect(c.status().outdated).toBe(false)
  })

  it('starts a Host when nothing answers after the restart, exactly as the first cycle does', async () => {
    const addr = addressFor('restart-b')
    let spawned = 0
    const c = new HostClient({ hostKey,
      address: addr.address,
      appVersion: '2.0.0',
      log: () => {},
      spawnHost: () => {
        spawned += 1
        void serveAt(addr, { version: '2.0.0' })
      }
    })
    c.start()
    await settled(c, (s) => s.connected)
    expect(spawned).toBe(1)
    await c.stop()
    for (const s of servers) await s.close().catch(() => {})
    servers = []
    c.restart()
    await settled(c, (s) => s.connected)
    expect(spawned).toBe(2)
  })

  it('reports the new Host through onConnect with a different identity', async () => {
    const addr = addressFor('restart-c')
    const first = await serveAt(addr)
    const seen: string[] = []
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '2.0.0', log: () => {}, spawnHost: () => {} })
    c.onConnect((h) => seen.push(`${h.pid}@${h.startedAt}`))
    c.start()
    await waitFor(() => seen.length === 1)
    await c.stop()
    await first.close()
    servers = servers.filter((s) => s !== first)
    await serveAt(addr)
    c.restart()
    await waitFor(() => seen.length === 2)
    // Same test process, so the pid repeats; startedAt is what tells the two servers apart.
    expect(seen[0]).not.toBe(seen[1])
  })

  it('is a no-op while the client is still running', async () => {
    const addr = addressFor('restart-d')
    await serveAt(addr)
    let logs: string[] = []
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '2.0.0', log: (m) => logs.push(m), spawnHost: () => {} })
    c.start()
    await settled(c, (s) => s.connected)
    const before = c.status()
    logs = []
    c.restart()
    await new Promise((r) => setTimeout(r, 100))
    expect(c.status()).toEqual(before)
    expect(logs).toEqual([])
  })

  it('marks a Host older than the app as outdated, and one that is not as not', async () => {
    const addr = addressFor('outdated')
    await serveAt(addr, { version: '1.3.20' })
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '1.3.21', log: () => {}, spawnHost: () => {} })
    c.start()
    await settled(c, (s) => s.connected)
    expect(c.status().outdated).toBe(true)
    await c.stop()

    const addr2 = addressFor('current')
    await serveAt(addr2, { version: '1.3.21' })
    const c2 = new HostClient({ hostKey, address: addr2.address, appVersion: '1.3.21', log: () => {}, spawnHost: () => {} })
    c2.start()
    await settled(c2, (s) => s.connected)
    expect(c2.status().outdated).toBe(false)
    await c2.stop()
  })
})

describe('HostClient.retire announce', () => {
  it('tells disconnect subscribers when asked to, and stays silent by default', async () => {
    const addrA = addressFor('retire-announce')
    await serveAt(addrA)
    let gone = 0
    const a = new HostClient({ hostKey, address: addrA.address, appVersion: '1.0.0', log: () => {}, spawnHost: () => {} })
    a.onDisconnect(() => gone++)
    a.start()
    await settled(a, (s) => s.connected)
    await a.retire({ announce: true })
    expect(gone).toBe(1)

    const addrB = addressFor('retire-quiet')
    await serveAt(addrB)
    let quiet = 0
    const b = new HostClient({ hostKey, address: addrB.address, appVersion: '1.0.0', log: () => {}, spawnHost: () => {} })
    b.onDisconnect(() => quiet++)
    b.start()
    await settled(b, (s) => s.connected)
    await b.retire()
    expect(quiet).toBe(0)
  })

  it('asks the Host for a handover with resume, and for a plain retire without it', async () => {
    const asked: ({ resume?: boolean } | undefined)[] = []
    const addrA = addressFor('retire-resume')
    await serveAt(addrA, { onIdle: (o) => void asked.push(o) })
    const a = new HostClient({ hostKey, address: addrA.address, appVersion: '1.0.0', log: () => {}, spawnHost: () => {} })
    a.start()
    await settled(a, (s) => s.connected)
    await a.retire({ announce: true, resume: true })
    await waitFor(() => asked.length === 1)
    expect(asked).toEqual([{ resume: true }])

    const addrB = addressFor('retire-plain')
    await serveAt(addrB, { onIdle: (o) => void asked.push(o) })
    const b = new HostClient({ hostKey, address: addrB.address, appVersion: '1.0.0', log: () => {}, spawnHost: () => {} })
    b.start()
    await settled(b, (s) => s.connected)
    await b.retire({ announce: true })
    await waitFor(() => asked.length === 2)
    expect(asked[1]).toBeUndefined()
  })

  // The automatic swap must not take a refusal for a Host that left: it would restart onto the very same Host and
  // log a replacement that never happened.
  it('resolves to refused, with the counts, and keeps the connection when the Host refuses a resume retire', async () => {
    const addr = addressFor('retire-refused')
    let left = false
    await serveAt(addr, { workingTasks: () => 2, onIdle: () => void (left = true) })
    let gone = 0
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '1.0.0', log: () => {}, spawnHost: () => {} })
    c.onDisconnect(() => gone++)
    c.start()
    await settled(c, (s) => s.connected)
    // onLeaving is what puts "Updating background service…" in the status bar (main/ipc.ts replaceHost): never for this.
    let leaving = 0
    expect(await c.retire({ announce: true, resume: true, onLeaving: () => leaving++ })).toEqual({ outcome: 'refused', sessions: 0, runs: 0, tasks: 2 })
    expect(leaving).toBe(0)
    expect(left).toBe(false)
    expect(gone).toBe(0)
    expect(c.status().connected).toBe(true)
    expect(c.send({ t: 'ping', seq: 1 })).toBe(true)
  })

  it('resolves to left when the Host takes the retire, resume or not', async () => {
    const addrA = addressFor('retire-left-resume')
    await serveAt(addrA, { workingTasks: () => 0 })
    const a = new HostClient({ hostKey, address: addrA.address, appVersion: '1.0.0', log: () => {}, spawnHost: () => {} })
    a.start()
    await settled(a, (s) => s.connected)
    let leaving = 0
    expect(await a.retire({ announce: true, resume: true, onLeaving: () => leaving++ })).toEqual({ outcome: 'left' })
    expect(leaving).toBe(1)

    const addrB = addressFor('retire-left-plain')
    await serveAt(addrB, { workingTasks: () => 2 })
    const b = new HostClient({ hostKey, address: addrB.address, appVersion: '1.0.0', log: () => {}, spawnHost: () => {} })
    b.start()
    await settled(b, (s) => s.connected)
    expect(await b.retire({ announce: true, onLeaving: () => leaving++ })).toEqual({ outcome: 'left' })
    expect(leaving).toBe(2)
  })
})

// T16: what the automatic swap (main/ipc.ts replaceHost) does — a resume retire, then restart() onto the new build's
// Host — brings the sessions back into the tabs they had. The Hosts are real servers; the handover file is the one
// host/sessionRestore.ts writes and reads; what the next Host does with it on the app's greeting (host/index.ts
// restoreHandover) is reduced to the `pty-opened` it sends for each, under the same ids. What main makes of the two
// events this asserts — every handle ended with the lost-sight code, then the same ids opened again — is the tab
// staying in place (renderer/src/lib/terminalTabs.test.ts) and the session adopted under its note's id (reattach.ts).
describe('session resume after a swap', () => {
  it('ends the handles with the lost-sight code, then the next Host gives the terminal and agent session back under their own ids', async () => {
    const addr = addressFor('swap-handover')
    const profileDir = path.join(dir, 'swap-profile')
    const terminalMeta = { kind: 'terminal' as const, id: 't1', restore: {} }
    const old: { s: HostServer | null } = { s: null }
    old.s = await serveAt(addr, {
      version: '1.0.0',
      workingTasks: () => 0,
      onIdle: (o) => {
        if (!o?.resume) return
        writeHandover(
          profileDir,
          handoverOf({
            sessions: [{ sessionId: 's1', accountId: 'a1', cwd: '/p' }],
            ptys: [{ file: 'bash', args: [], opts: { cwd: '/p', cols: 80, rows: 24, env: {} }, meta: terminalMeta }],
            procs: [],
            state: null,
            baseEnv: {}
          })
        )
        void old.s?.close()
      }
    })
    // The new build's Host: started when nothing answers the address, and on the app's greeting it reopens what the
    // last Host handed over.
    const spawnHost = (): void =>
      void (async () => {
        const { handover } = await leftBehind(profileDir)
        await serveAt(addr, {
          version: '2.0.0',
          onAppGreeted: (send) => {
            for (const p of handover?.ptys ?? []) send({ t: 'pty-opened', entry: { id: 'pty-t1', pid: 1, meta: p.meta, alive: true } })
            for (const row of handover?.sessions ?? [])
              send({ t: 'pty-opened', entry: { id: 'pty-s1', pid: 2, meta: { kind: 'session', id: row.sessionId, restore: {} }, alive: true } })
          }
        })
      })()
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '2.0.0', log: () => {}, spawnHost })
    // What main hears: the announce is what ends every Host-backed handle with the lost-sight code (ptyFactory's
    // onHostGone), and each `pty-opened` is taken back under its note's id.
    const events: string[] = []
    c.onDisconnect(() => events.push(`handles end with ${PTY_LOST_SIGHT_EXIT_CODE}`))
    c.onMessage((m) => {
      if (m.t === 'pty-opened' && m.entry.meta) events.push(`${m.entry.meta.kind} ${m.entry.meta.id} opened`)
    })
    c.start()
    await settled(c, (st) => st.connected && st.hostVersion === '1.0.0')
    expect(c.status().features).toContain('handover')

    expect(await c.retire({ announce: true, resume: true })).toEqual({ outcome: 'left' })
    c.restart()
    await settled(c, (st) => st.connected && st.hostVersion === '2.0.0')
    await waitFor(() => events.length === 3)

    expect(events).toEqual([`handles end with ${PTY_LOST_SIGHT_EXIT_CODE}`, 'terminal t1 opened', 'session s1 opened'])
    expect(c.status().outdated).toBe(false)
    await c.stop()
  })

  // T30: an idle chat rides the handover. The old Host writes each chat proc's note down (handoverOf's `procs`); the new
  // Host respawns it through the chat manager the Host's HostChats.spawn wraps (chatRespawnOf, chatSpawnOptsOf, with
  // `hostStarting` as the Host sets it) and tells the app `proc-opened` once its start settled. What the app makes of
  // that push — the proc adopted under its note's id into the tab it had — is reattach.ts's (reattach.test.ts); what a
  // resume id does to the CLI — `claude --resume`, codex's `thread/resume` — is the adapters' (claudeAdapter.test.ts,
  // codexAdapter.test.ts). Asserted here: the same ids and threads reach the CLIs the new Host starts, and the app.
  it('respawns an idle claude chat and an idle codex chat in the next Host on the same thread under the same id', async () => {
    const addr = addressFor('swap-chats')
    const profileDir = path.join(dir, 'swap-chats-profile')
    const accounts: Account[] = [
      { id: 'acc-cl', label: 'cl', configDir: path.join(dir, 'cl'), provider: 'claude' } as Account,
      { id: 'acc-cx', label: 'cx', configDir: path.join(dir, 'cx'), provider: 'codex' } as Account
    ]
    // The two chat procs' notes, as ChatSessionManager.spawn wrote them and the adapters' `remember` patched the thread in.
    const notes = [
      { kind: 'chat' as const, id: 'chat-cl', restore: { accountId: 'acc-cl', cwd: dir, title: 'Claude tab', provider: 'claude', threadId: 'th-cl', chosenModel: 'opus', unattendedPermission: 'deny-after-60s', startedAt: 111 } },
      { kind: 'chat' as const, id: 'chat-cx', restore: { accountId: 'acc-cx', cwd: dir, title: 'Codex tab', provider: 'codex', threadId: 'th-cx', unattendedPermission: 'hold', startedAt: 222 } }
    ]
    const old: { s: HostServer | null } = { s: null }
    old.s = await serveAt(addr, {
      version: '1.0.0',
      workingTasks: () => 0,
      onIdle: (o) => {
        if (!o?.resume) return
        writeHandover(profileDir, handoverOf({ sessions: [], ptys: [], procs: [...notes, null], state: null, baseEnv: {} }))
        void old.s?.close()
      }
    })
    // The new Host's chat manager: the CLI each respawn launches, and the thread each adapter is started on.
    const launched: Array<{ file: string; args: string[]; id: string; restore: Record<string, unknown> }> = []
    const startedOn: Record<string, string | undefined> = {}
    const proc = (): ProcLike => ({ pid: 1, onLine: () => {}, onExit: () => {}, write: () => {}, kill: () => {} })
    const createAdapter: NonNullable<ChatManagerDeps['createAdapter']> = (a) =>
      ({
        start: (o: { resumeThreadId?: string }) => {
          startedOn[a.provider] = o.resumeThreadId
          return Promise.resolve()
        },
        state: () => ({ status: 'idle' }) as ChatState,
        on: () => () => {},
        kill: () => {}
      }) as unknown as ChatAdapter
    const manager = new ChatSessionManager({
      factory: (file, args, opts) => {
        if (opts.meta) launched.push({ file, args, id: opts.meta.id, restore: opts.meta.restore })
        return proc()
      },
      descriptors: makeDescriptors(process.platform),
      homeDir: dir,
      platform: process.platform,
      version: '2.0.0',
      log: () => {},
      createAdapter
    })
    const procOf = new Map<string, string>()
    const spawnHost = (): void =>
      void (async () => {
        const { handover } = await leftBehind(profileDir)
        await serveAt(addr, {
          version: '2.0.0',
          onAppGreeted: (send) =>
            void (async () => {
              for (const ch of handover?.chats ?? []) {
                const account = accounts.find((x) => x.id === ch.accountId)!
                const info = manager.spawn(chatSpawnOptsOf(chatRespawnOf(ch, account), { unattendedOf: () => 'hold', bypassSignal: null, hostStarting: true }))
                await manager.started(info.id)
                procOf.set(`proc-${info.id}`, info.id)
                send({ t: 'proc-opened', procId: `proc-${info.id}` })
              }
            })()
        })
      })()
    const c = new HostClient({ hostKey, address: addr.address, appVersion: '2.0.0', log: () => {}, spawnHost })
    const reopened: string[] = []
    c.onMessage((m) => {
      if (m.t === 'proc-opened') reopened.push(procOf.get(m.procId) ?? '?')
    })
    c.start()
    await settled(c, (st) => st.connected && st.hostVersion === '1.0.0')
    expect(c.status().features).toEqual(expect.arrayContaining(['handover', 'handover-chats']))

    expect(await c.retire({ announce: true, resume: true })).toEqual({ outcome: 'left' })
    c.restart()
    await settled(c, (st) => st.connected && st.hostVersion === '2.0.0')
    await waitFor(() => reopened.length === 2)

    // The app is told about each under the id its tab is keyed by.
    expect(reopened).toEqual(['chat-cl', 'chat-cx'])
    // Each comes back on its own thread: claude through `--resume`, codex through the adapter's thread/resume.
    expect(launched.map((l) => l.id)).toEqual(['chat-cl', 'chat-cx'])
    expect(launched[0].args.join(' ')).toContain('th-cl')
    expect(startedOn).toEqual({ claude: 'th-cl', codex: 'th-cx' })
    // And keeps its title, model, policy and startedAt, so the reattached tab reads as it did.
    expect(launched[0].restore).toMatchObject({ accountId: 'acc-cl', title: 'Claude tab', threadId: 'th-cl', chosenModel: 'opus', unattendedPermission: 'deny-after-60s', startedAt: 111 })
    expect(launched[1].restore).toMatchObject({ accountId: 'acc-cx', title: 'Codex tab', threadId: 'th-cx', unattendedPermission: 'hold', startedAt: 222 })
    expect(await leftBehind(profileDir)).toMatchObject({ handover: { chats: [{ sessionId: 'chat-cl' }, { sessionId: 'chat-cx' }] } })
    await c.stop()
  })
})
