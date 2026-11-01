// The Host's side of the pty supervisor (protocol.ts has the whole picture and the API). Two connections: the link
// carries everything asynchronous (output, exits, writes, lists), and a worker thread makes the one synchronous call,
// a spawn, whose pid the Host registry needs before `open` returns. The link is held for the Host's whole life: an
// attached Host is what keeps the supervisor from leaving.
import { spawn as spawnChild } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { MessageChannel, Worker, receiveMessageOnPort } from 'node:worker_threads'
import type { PtyMeta, PtyOpenOptions } from '../../core/host/protocol'
import { createLineReader, encodeLine } from '../framing'
import type { RegistryPty, RegistrySpawn } from '../registry'
import { SUPERVISOR_PROFILE_ENV, supervisorAddress, type FromSupervisor, type SpawnRequest, type SupervisorPtyInfo, type ToSupervisor } from './protocol'

/** How long after the Host starts the supervisor it may take to listen; past it, sessions start in the Host. */
export const SUPERVISOR_START_MS = 10_000
/** How long a spawn waits for its answer once the request is sent: node-pty's own spawn is far quicker. */
const SPAWN_ANSWER_MS = 10_000

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
  /** Already known to be out of reach, and why. */
  down?: string
}): PtySupervisorClient {
  const handles = new Map<string, { data: ((s: string) => void)[]; exit: ((e: { exitCode: number }) => void)[] }>()
  const lists: { resolve(p: SupervisorPtyInfo[]): void; reject(e: Error): void }[] = []
  let down = false
  let gone = false
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

  d.link.listen((m) => {
    if (m === null) {
      gone = true
      fallBack('the pty supervisor cannot be reached')
      for (const l of lists.splice(0)) l.reject(new Error('the pty supervisor cannot be reached'))
      // Its ptys end with it: the ConPTYs it held are closed.
      for (const id of [...handles.keys()]) ended(id, null)
      return
    }
    if (m.t === 'listed') lists.shift()?.resolve(m.ptys)
    else if (m.t === 'data') for (const cb of handles.get(m.id)?.data ?? []) cb(m.data)
    else if (m.t === 'exit') ended(m.id, m.exitCode)
  })

  const attach = (id: string, pid: number): RegistryPty => {
    const h = { data: [] as ((s: string) => void)[], exit: [] as ((e: { exitCode: number }) => void)[] }
    handles.set(id, h)
    // After the caller's own onData/onExit, which it adds right after this returns: the replay must find them.
    queueMicrotask(() => d.link.send({ t: 'attach', id }))
    return {
      pid,
      onData: (cb) => void h.data.push(cb),
      onExit: (cb) => void h.exit.push(cb),
      write: (data) => d.link.send({ t: 'write', id, data }),
      resize: (cols, rows) => d.link.send({ t: 'resize', id, cols, rows }),
      kill: () => d.link.send({ t: 'kill', id }),
      pause: () => d.link.send({ t: 'pause', id }),
      resume: () => d.link.send({ t: 'resume', id })
    }
  }

  return {
    spawn(file, args, opts, meta) {
      // Agent sessions only: a shell or a run nobody adopts after a crash would keep the supervisor alive for good.
      if (meta?.kind !== 'session' || down) return d.fallback(file, args, opts)
      const id = randomBytes(8).toString('hex')
      const r = d.request({ t: 'spawn', id, file, args, opts, note: meta })
      if (r === 'unreachable') {
        fallBack('the pty supervisor cannot be reached')
        return d.fallback(file, args, opts)
      }
      if (r === 'no-answer') {
        // Never a second spawn here: the first may be running. Ended if it is.
        d.link.send({ t: 'kill', id })
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
        d.link.send({ t: 'list' })
      }),
    attach,
    close: () => d.link.close()
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
function connect(address, until, done) {
  const s = net.connect(address)
  s.setEncoding('utf8')
  s.once('connect', () => done(s))
  s.on('error', () => {})
  s.on('close', () => {
    if (sock === s) { sock = null; buf = ''; return answer({ t: 'no-answer' }) }
    if (Date.now() < until) setTimeout(() => connect(address, until, done), 100)
    else done(null)
  })
  s.on('data', (chunk) => {
    buf += chunk
    for (let i = buf.indexOf('\\n'); i >= 0; i = buf.indexOf('\\n')) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      let m
      try { m = JSON.parse(line) } catch { continue }
      if (waiting && m.id === waiting.id) answer(m)
    }
  })
}
parentPort.on('message', (w) => {
  waiting = w
  if (sock) return void sock.write(w.line)
  connect(w.address, Date.now() + w.connectMs, (s) => {
    if (!s) return answer({ t: 'unreachable' })
    sock = s
    s.write(w.line)
  })
})
`

/** The spawn round trip on a worker thread while this one waits on Atomics: the registry's spawn is synchronous, and
 *  so is node-pty's, which blocks for about as long. */
export function workerRequester(address: string, deadline: number): SpawnRequester {
  let worker: Worker | null = null
  return (m) => {
    if (!worker) {
      worker = new Worker(SPAWN_WORKER, { eval: true })
      worker.unref()
    }
    const flag = new Int32Array(new SharedArrayBuffer(4))
    const { port1, port2 } = new MessageChannel()
    const connectMs = Math.max(1_000, deadline - Date.now())
    worker.postMessage({ address, line: encodeLine(m), id: m.id, flag, port: port2, connectMs }, [port2])
    Atomics.wait(flag, 0, 0, connectMs + SPAWN_ANSWER_MS)
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
  const deadline = Date.now() + SUPERVISOR_START_MS
  let failed: string | null = existsSync(a.entryPath) ? null : `${a.entryPath} is missing`
  if (!failed) {
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
    } catch (err) {
      failed = String(err)
    }
  }
  if (failed) {
    const dead: SupervisorLink = { send() {}, listen() {}, close() {} }
    return createPtySupervisorClient({ link: dead, request: () => 'unreachable', fallback: a.fallback, log: a.log, down: `the pty supervisor could not be started (${failed})` })
  }
  return createPtySupervisorClient({ link: netLink(address, deadline, a.log), request: workerRequester(address, deadline), fallback: a.fallback, log: a.log })
}
