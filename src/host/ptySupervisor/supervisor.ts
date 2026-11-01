// What the pty supervisor holds (protocol.ts has the whole picture): its ptys, each with a bounded ring of output, and
// the connections attached to them. No `net` and no node-pty: the spawn, the tree kill and the clock are dependencies,
// so the protocol is tested over a fake transport and entry.ts wires the real ones.
import type { PtyOpenOptions } from '../../core/host/protocol'
import { createPtyRing, type PtyRing } from '../ptyRing'
import type { RegistryPty } from '../registry'
import { RING_CHARS, SUPERVISOR_IDLE_MS, helloMatches, welcomeProof, type FromSupervisor, type SupervisorPtyInfo, type ToSupervisor } from './protocol'

export interface SupervisorDeps {
  spawn(file: string, args: string[] | string, opts: PtyOpenOptions): RegistryPty
  /** Ends a process and everything it started (`workspace/native`'s killTree). */
  killTree(pid: number): Promise<void>
  log(m: string): void
  /** No live pty and no connection for `idleMs`: time to leave. */
  onIdle(): void
  /** A pty has ended, after the supervisor counted it out (the conhost reaper's cue). */
  exited?(): void
  /** The profile's Host key, read when a connection says hello; null when there is none (every hello is refused). */
  key(): string | null
  idleMs?: number
  ringChars?: number
  /** Test injection; setTimeout otherwise. Returns the cancel. */
  after?(ms: number, fn: () => void): () => void
}

export interface SupervisorConnection {
  receive(m: ToSupervisor): void
  close(): void
}

interface Conn {
  send(m: FromSupervisor): void
}

interface Held {
  id: string
  pid: number
  note: SupervisorPtyInfo['note']
  pty: RegistryPty
  ring: PtyRing
  alive: boolean
  exitCode: number | null
  /** One kill per pty, ever: node-pty 1.1.0's ConPTY kill frees its handle again on a repeat (pty.ts withExitedPtyGuard). */
  killSent: boolean
  attached: Set<Conn>
}

export function createSupervisor(d: SupervisorDeps): {
  connect(send: (m: FromSupervisor) => void, refuse?: () => void): SupervisorConnection
  liveCount(): number
} {
  const ptys = new Map<string, Held>()
  const conns = new Set<Conn>()
  const after: NonNullable<SupervisorDeps['after']> =
    d.after ??
    ((ms, fn) => {
      const t = setTimeout(fn, ms)
      return () => clearTimeout(t)
    })
  let cancelIdle: (() => void) | null = null
  const liveCount = (): number => [...ptys.values()].filter((h) => h.alive).length
  const idle = (): boolean => conns.size === 0 && liveCount() === 0
  const checkIdle = (): void => {
    if (!idle()) {
      cancelIdle?.()
      cancelIdle = null
    } else if (!cancelIdle) {
      cancelIdle = after(d.idleMs ?? SUPERVISOR_IDLE_MS, () => {
        cancelIdle = null
        if (idle()) d.onIdle()
      })
    }
  }

  const tell = (c: Conn, m: FromSupervisor): void => {
    try {
      c.send(m)
    } catch (err) {
      d.log(`a connection could not be sent ${m.t}: ${String(err)}`)
    }
  }

  /** The exit goes to whoever is attached, and then the pty is forgotten; with nobody attached it waits for the next. */
  const deliverExit = (h: Held): void => {
    if (h.attached.size === 0) return
    for (const c of h.attached) tell(c, { t: 'exit', id: h.id, exitCode: h.exitCode })
    ptys.delete(h.id)
  }

  const spawn = (c: Conn, m: Extract<ToSupervisor, { t: 'spawn' }>): void => {
    if (ptys.has(m.id)) return tell(c, { t: 'spawn-failed', id: m.id, error: `a pty with id ${m.id} is already held` })
    let pty: RegistryPty
    try {
      pty = d.spawn(m.file, m.args, m.opts)
    } catch (err) {
      d.log(`pty ${m.id} could not be started: ${String(err)}`)
      return tell(c, { t: 'spawn-failed', id: m.id, error: String(err) })
    }
    const h: Held = { id: m.id, pid: pty.pid, note: m.note ?? null, pty, ring: createPtyRing({ bound: d.ringChars ?? RING_CHARS }), alive: true, exitCode: null, killSent: false, attached: new Set() }
    ptys.set(m.id, h)
    pty.onData((data) => {
      // Always into the ring, attached or not: a Host that dies right after this chunk leaves it for the next one.
      h.ring.push({ kind: 'data', data })
      for (const a of h.attached) tell(a, { t: 'data', id: h.id, data })
    })
    pty.onExit(({ exitCode }) => {
      h.alive = false
      h.exitCode = typeof exitCode === 'number' ? exitCode : null
      d.log(`pty ${h.id} exited ${h.exitCode}`)
      deliverExit(h)
      d.exited?.()
      checkIdle()
    })
    d.log(`pty ${m.id} started, pid ${pty.pid}`)
    tell(c, { t: 'spawned', id: m.id, pid: pty.pid })
    checkIdle()
  }

  const kill = (h: Held): void => {
    if (!h.alive || h.killSent) return
    h.killSent = true
    // The tree first, while its root still links it (T22, src/host/registry.ts `kill`): node-pty's kill ends the
    // agent only, and what its tools started outlived it. Then the pty's one kill, unless the tree kill ended it.
    d.killTree(h.pid)
      .catch((err) => d.log(`pty ${h.id}: its process tree (pid ${h.pid}) could not be ended: ${String(err)}`))
      .finally(() => {
        if (!h.alive) return
        try {
          h.pty.kill()
        } catch (err) {
          d.log(`pty ${h.id} could not be killed: ${String(err)}`)
        }
      })
  }

  const receive = (c: Conn, m: ToSupervisor): void => {
    if (m.t === 'hello') return // already said
    if (m.t === 'spawn') return spawn(c, m)
    if (m.t === 'list') return tell(c, { t: 'listed', ptys: [...ptys.values()].map((h) => ({ id: h.id, pid: h.pid, note: h.note, alive: h.alive })) })
    const h = ptys.get(m.id)
    if (m.t === 'attach') {
      if (!h) return tell(c, { t: 'exit', id: m.id, exitCode: null })
      h.attached.add(c)
      const replay = h.ring.text()
      if (replay) tell(c, { t: 'data', id: h.id, data: replay })
      if (!h.alive) deliverExit(h)
      return
    }
    if (!h?.alive) return
    // A write or resize can throw for a pty whose exit is still on its way (pty.ts withExitedPtyGuard): nothing to do.
    try {
      if (m.t === 'write') h.pty.write(m.data)
      else if (m.t === 'resize') h.pty.resize(m.cols, m.rows)
      else if (m.t === 'pause') h.pty.pause()
      else if (m.t === 'resume') h.pty.resume()
      else if (m.t === 'kill') kill(h)
    } catch {
      // the pty is on its way out
    }
  }

  checkIdle()
  return {
    connect(send, refuse) {
      const c: Conn = { send }
      let authed = false
      let refused = false
      return {
        receive(m) {
          if (refused) return
          if (!authed) {
            // Only a connection that proved the key counts as a Host or reaches a pty.
            const key = d.key()
            const ok = m.t === 'hello' && key !== null && typeof m.nonce === 'string' && m.nonce.length > 0 && m.nonce.length <= 256 && helloMatches(key, m.nonce, m.proof)
            if (!ok) {
              refused = true
              d.log(`a connection was refused: its first line was ${m.t === 'hello' ? 'a hello with the wrong key' : String(m.t)}`)
              return refuse?.()
            }
            authed = true
            conns.add(c)
            tell(c, { t: 'welcome', proof: welcomeProof(key, m.nonce) })
            return checkIdle()
          }
          // Nothing after the close: an attach then would take a pty's exit to a Host that is gone.
          if (conns.has(c)) receive(c, m)
        },
        close() {
          refused = true
          if (!conns.delete(c)) return
          for (const h of ptys.values()) h.attached.delete(c)
          checkIdle()
        }
      }
    },
    liveCount
  }
}
