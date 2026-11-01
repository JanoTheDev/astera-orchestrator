// The Host's side of the pty supervisor (protocol.ts has the whole picture and the API). Two connections: the link
// carries everything asynchronous (output, exits, writes, lists), and a worker thread makes the one synchronous call,
// a spawn, whose pid the Host registry needs before `open` returns. The link is held for the Host's whole life: an
// attached Host is what keeps the supervisor from leaving. The supervisor is started and connected in the background:
// a session spawned before it is connected starts in the Host, and the one synchronous call is bounded.
import { spawn as spawnChild } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads'
import type { PtyMeta, PtyOpenOptions } from '../../core/host/protocol'
import { createLineReader, encodeLine } from '../framing'
import type { RegistryPty, RegistrySpawn } from '../registry'
import { ensureHostKey, newHostNonce } from '../../core/publicContract'
import { HELLO_MS, SPAWN_BOUND_MS, SUPERVISOR_PROFILE_ENV, helloProof, supervisorAddress, welcomeProof, type FromSupervisor, type SpawnRequest, type SupervisorPtyInfo, type ToSupervisor } from './protocol'

/** How long after the Host starts the supervisor it may take to listen; past it, sessions start in the Host. */
export const SUPERVISOR_START_MS = 10_000
/** How long the spawn worker retries a connect to a supervisor the link has just met: it is listening already. */
const SPAWN_CONNECT_MS = 1_000

export interface PtySupervisorClient {
  spawn(file: string, args: string[] | string, opts: PtyOpenOptions, meta?: PtyMeta): RegistryPty
  list(): Promise<SupervisorPtyInfo[]>
  attach(id: string, pid: number): RegistryPty
  close(): void
}

/** The asynchronous connection. `listen` hears every message, then null once when the link is gone for good: it
 *  closed, or it never connected by its deadline. */
export interface SupervisorLink {
  send(m: ToSupervisor): void
  listen(cb: (m: FromSupervisor | null) => void): void
  close(): void
}

/** The synchronous spawn round trip: the answer, 'unreachable' when nothing could be sent (safe to spawn elsewhere),
 *  'no-answer' when it was sent and nothing came back (the pty may exist). */
export type SpawnRequester = (m: SpawnRequest) => FromSupervisor | 'unreachable' | 'no-answer'

export function createPtySupervisorClient(d: {
  link: SupervisorLink
  request: SpawnRequester
  fallback: RegistrySpawn
  log(m: string): void
  /** The profile's Host key (null: none, so the supervisor cannot be told from a squatter and is not used). */
  key: Promise<string | null>
  /** The supervisor went away after it had been connected: start it again, in the background, and its new link. */
  restart?(): SupervisorLink | null
  helloMs?: number
  /** Already known to be out of reach, and why. */
  down?: string
}): PtySupervisorClient {
  const handles = new Map<string, { data: ((s: string) => void)[]; exit: ((e: { exitCode: number }) => void)[] }>()
  const lists: { resolve(p: SupervisorPtyInfo[]): void; reject(e: Error): void }[] = []
  let down = false
  let gone = false
  let link = d.link
  /** The supervisor answered the hello with the right proof on `link`. */
  let ready = false
  let wasReady = false
  let notReadyLogged = false
  let helloSent = false
  let beforeHello: ToSupervisor[] = []
  let helloTimer: NodeJS.Timeout | undefined
  /** Everything goes after the hello: the supervisor refuses a connection whose first line is anything else. */
  const send = (m: ToSupervisor): void => (helloSent ? link.send(m) : void beforeHello.push(m))
  /** Logged once (acceptance: a supervisor that cannot start is said once, not at every session). */
  const fallBack = (why: string): void => {
    if (down) return
    down = true
    d.log(`${why}; agent sessions start in the Host from now on and end with it`)
  }
  if (d.down) fallBack(d.down)

  const ended = (id: string, exitCode: number | null): void => {
    const h = handles.get(id)
    if (!h) return
    handles.delete(id)
    // null: how it ended is not known, which the registry already takes from node-pty (`exits.ts` ENDED_WITHOUT_A_CODE).
    for (const cb of h.exit) cb({ exitCode: exitCode as number })
  }

  /** The link is over (it closed, never connected, or the supervisor failed the hello). */
  const lost = (l: SupervisorLink): void => {
    if (l !== link) return
    clearTimeout(helloTimer)
    const restart = wasReady && !gone ? d.restart : undefined
    ready = false
    wasReady = false
    for (const x of lists.splice(0)) x.reject(new Error('the pty supervisor cannot be reached'))
    // Its ptys end with it: the ConPTYs it held are closed.
    for (const id of [...handles.keys()]) ended(id, null)
    const next = restart?.()
    if (next) {
      d.log('the pty supervisor went away; starting it again in the background')
      return open(next)
    }
    gone = true
    fallBack('the pty supervisor cannot be reached')
  }

  const open = (l: SupervisorLink): void => {
    link = l
    ready = false
    helloSent = false
    beforeHello = []
    let expect = ''
    l.listen((m) => {
      if (l !== link) return
      if (m === null) return lost(l)
      if (!ready) {
        // The first thing a supervisor says is its proof; one that says anything else, or the wrong proof, is not ours.
        if (m.t === 'welcome' && m.proof === expect) {
          ready = wasReady = true
          clearTimeout(helloTimer)
        } else {
          d.log('the pty supervisor did not answer the hello with the Host key; it is not used')
          l.close()
          lost(l)
        }
        return
      }
      if (m.t === 'listed') lists.shift()?.resolve(m.ptys)
      else if (m.t === 'data') for (const cb of handles.get(m.id)?.data ?? []) cb(m.data)
      else if (m.t === 'exit') ended(m.id, m.exitCode)
    })
    void d.key.then((key) => {
      if (l !== link) return
      if (!key) {
        d.log('the Host key is missing; the pty supervisor is not used')
        l.close()
        return lost(l)
      }
      const nonce = newHostNonce()
      expect = welcomeProof(key, nonce)
      helloTimer = setTimeout(() => {
        if (ready || l !== link) return
        d.log('the pty supervisor did not answer the hello; it is not used')
        l.close()
        lost(l)
      }, d.helloMs ?? HELLO_MS)
      helloTimer.unref()
      l.send({ t: 'hello', nonce, proof: helloProof(key, nonce) })
      helloSent = true
      for (const q of beforeHello.splice(0)) l.send(q)
    })
  }
  if (!d.down) open(link)

  const attach = (id: string, pid: number): RegistryPty => {
    const h = { data: [] as ((s: string) => void)[], exit: [] as ((e: { exitCode: number }) => void)[] }
    handles.set(id, h)
    // After the caller's own onData/onExit, which it adds right after this returns: the replay must find them.
    queueMicrotask(() => send({ t: 'attach', id }))
    return {
      pid,
      onData: (cb) => void h.data.push(cb),
      onExit: (cb) => void h.exit.push(cb),
      write: (data) => send({ t: 'write', id, data }),
      resize: (cols, rows) => send({ t: 'resize', id, cols, rows }),
      kill: () => send({ t: 'kill', id }),
      pause: () => send({ t: 'pause', id }),
      resume: () => send({ t: 'resume', id })
    }
  }

  return {
    spawn(file, args, opts, meta) {
      // Agent sessions only: a shell or a run nobody adopts after a crash would keep the supervisor alive for good.
      if (meta?.kind !== 'session' || down) return d.fallback(file, args, opts)
      if (!ready) {
        // Still starting or connecting (it is started in the background): never wait for it on the Host's main thread.
        if (!notReadyLogged) {
          notReadyLogged = true
          d.log('the pty supervisor is not connected yet; sessions started meanwhile start in the Host and end with it')
        }
        return d.fallback(file, args, opts)
      }
      const id = randomBytes(8).toString('hex')
      const r = d.request({ t: 'spawn', id, file, args, opts, note: meta })
      if (r === 'unreachable') {
        fallBack('the pty supervisor cannot be reached')
        return d.fallback(file, args, opts)
      }
      if (r === 'no-answer') {
        // Never a second spawn here: the first may be running. Ended if it is.
        send({ t: 'kill', id })
        throw new Error('the pty supervisor did not answer the spawn')
      }
      if (r.t === 'spawn-failed') throw new Error(r.error)
      if (r.t !== 'spawned') throw new Error(`the pty supervisor answered a spawn with ${r.t}`)
      return attach(id, r.pid)
    },
    list: () =>
      new Promise((resolve, reject) => {
        if (gone) return reject(new Error('the pty supervisor cannot be reached'))
        lists.push({ resolve, reject })
        send({ t: 'list' })
      }),
    attach,
    close: () => {
      clearTimeout(helloTimer)
      link.close()
    }
  }
}

/** The link over a pipe or socket, retrying the connect until `deadline` (the supervisor may still be starting).
 *  What is sent before it connects waits in order. */
export function netLink(address: string, deadline: number, log: (m: string) => void): SupervisorLink {
  let sock: net.Socket | null = null
  let queue: string[] | null = []
  let cb: (m: FromSupervisor | null) => void = () => {}
  let closed = false
  const gone = (): void => {
    if (closed) return
    closed = true
    cb(null)
  }
  const read = createLineReader({
    onMessage: (v) => cb(v as FromSupervisor),
    onBadLine: (raw) => log(`pty supervisor: a line that is not JSON: ${raw.slice(0, 80)}`),
    onHandlerError: (_v, err) => log(`pty supervisor: a message could not be handled: ${String(err)}`)
  })
  const connect = (): void => {
    if (closed) return
    const s = net.connect(address)
    s.setEncoding('utf8')
    s.once('connect', () => {
      sock = s
      for (const l of queue ?? []) s.write(l)
      queue = null
    })
    s.on('data', read)
    s.on('error', () => {})
    s.on('close', () => {
      if (sock === s) return gone()
      if (Date.now() < deadline) setTimeout(connect, 150).unref()
      else gone()
    })
  }
  connect()
  return {
    send(m) {
      if (closed) return
      const l = encodeLine(m)
      if (queue) queue.push(l)
      else sock?.write(l)
    },
    listen(f) {
      cb = f
    },
    close() {
      closed = true
      sock?.destroy()
    }
  }
}

// The worker's whole program. Plain CommonJS for `eval`: it has no bundle to import from, so it reads lines itself.
const SPAWN_WORKER = `
const { parentPort } = require('node:worker_threads')
const net = require('node:net')
let sock = null, waiting = null, buf = ''
function answer(r) {
  const w = waiting
  if (!w) return
  waiting = null
  w.port.postMessage(r)
  w.port.close()
  Atomics.store(w.flag, 0, 1)
  Atomics.notify(w.flag, 0)
}
function connect(address, until, hello, done) {
  const s = net.connect(address)
  let welcomed = false
  s.setEncoding('utf8')
  // A supervisor that does not answer the hello is not one: dropped, and the connect is tried again until its deadline.
  const t = setTimeout(() => s.destroy(), 1000)
  s.once('connect', () => s.write(hello.line))
  s.on('error', () => {})
  s.on('close', () => {
    clearTimeout(t)
    if (sock === s) { sock = null; buf = ''; return answer({ t: 'no-answer' }) }
    if (Date.now() < until) setTimeout(() => connect(address, until, hello, done), 100)
    else done(null)
  })
  s.on('data', (chunk) => {
    buf += chunk
    for (let i = buf.indexOf('\\n'); i >= 0; i = buf.indexOf('\\n')) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      let m
      try { m = JSON.parse(line) } catch { continue }
      if (!welcomed) {
        if (m.t !== 'welcome' || m.proof !== hello.expect) return void s.destroy()
        welcomed = true
        clearTimeout(t)
        done(s)
      } else if (waiting && m.id === waiting.id) answer(m)
    }
  })
}
parentPort.on('message', (w) => {
  waiting = w
  if (sock) return void sock.write(w.line)
  connect(w.address, Date.now() + w.connectMs, w.hello, (s) => {
    if (!s) return answer({ t: 'unreachable' })
    sock = s
    s.write(w.line)
  })
})
`

/** The spawn round trip on a worker thread while this one waits on Atomics: the registry's spawn is synchronous, and
 *  so is node-pty's, which blocks for about as long. The wait is bounded by SPAWN_BOUND_MS, connect and hello included
 *  (it is only asked once the link has met the supervisor, so the connect is quick); past it the answer is 'no-answer'. */
export function workerRequester(address: string, key: () => string | null): SpawnRequester {
  let worker: Worker | null = null
  return (m) => {
    const k = key()
    if (!k) return 'unreachable'
    if (!worker) {
      worker = new Worker(SPAWN_WORKER, { eval: true })
      worker.unref()
    }
    const nonce = newHostNonce()
    const hello = { line: encodeLine({ t: 'hello', nonce, proof: helloProof(k, nonce) }), expect: welcomeProof(k, nonce) }
    const flag = new Int32Array(new SharedArrayBuffer(4))
    const { port1, port2 } = new MessageChannel()
    worker.postMessage({ address, line: encodeLine(m), id: m.id, flag, port: port2, connectMs: SPAWN_CONNECT_MS, hello }, [port2])
    Atomics.wait(flag, 0, 0, SPAWN_BOUND_MS)
    const got = receiveMessageOnPort(port1)?.message as FromSupervisor | { t: 'unreachable' } | { t: 'no-answer' } | undefined
    port1.close()
    if (!got || got.t === 'no-answer') return 'no-answer'
    return got.t === 'unreachable' ? 'unreachable' : got
  }
}

/** Starts the supervisor (a second one finds the first listening and leaves) and connects to it. One fixed command
 *  line, hidden, detached, its working folder the profile's. `fallback` is the Host's own spawn, used for everything
 *  but agent sessions and for those too while the supervisor cannot be reached. */
export function startPtySupervisor(a: {
  profileDir: string
  execPath: string
  entryPath: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  fallback: RegistrySpawn
  log(m: string): void
}): PtySupervisorClient {
  const address = supervisorAddress(a.profileDir, a.platform)
  /** Starts the process, in the background: nothing here waits for it. The error, or null. */
  const launch = (): string | null => {
    if (!existsSync(a.entryPath)) return `${a.entryPath} is missing`
    try {
      const child = spawnChild(a.execPath, [a.entryPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: a.profileDir,
        env: { ...a.env, [SUPERVISOR_PROFILE_ENV]: a.profileDir }
      })
      // Later than this call (the executable is gone): the link's deadline then says it, once.
      child.on('error', (err) => a.log(`the pty supervisor could not be started: ${String(err)}`))
      child.unref()
      return null
    } catch (err) {
      return String(err)
    }
  }
  const failed = launch()
  if (failed) {
    const dead: SupervisorLink = { send() {}, listen() {}, close() {} }
    return createPtySupervisorClient({ link: dead, request: () => 'unreachable', key: Promise.resolve(null), fallback: a.fallback, log: a.log, down: `the pty supervisor could not be started (${failed})` })
  }
  // The same key file the Host's own address answers with (ensureHostKey: whoever makes it first, both agree).
  let key: string | null = null
  const keyReady = ensureHostKey(a.profileDir).then(
    (k) => (key = k),
    (err) => {
      a.log(`the Host key could not be read for the pty supervisor: ${String(err)}`)
      return null
    }
  )
  return createPtySupervisorClient({
    link: netLink(address, Date.now() + SUPERVISOR_START_MS, a.log),
    request: workerRequester(address, () => key),
    key: keyReady,
    // After it went away (it only leaves idle, and a connected Host keeps it from that): started again, once.
    restart: () => (launch() ? null : netLink(address, Date.now() + SUPERVISOR_START_MS, a.log)),
    fallback: a.fallback,
    log: a.log
  })
}
