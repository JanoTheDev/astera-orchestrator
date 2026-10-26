// A client's side of the Host handshake: the `astera` CLI's, its MCP server's and @astera-app/client's.
// Deliberately smaller than the app's own Host client: no reconnect cycle, no spawn and no
// retry here; those belong to the caller.
import net from 'node:net'
import { HOST_PROTOCOL, type ClientHelloMessage, type HostHelloMessage, type OrchCallMessage, type OrchResultMessage, type ProtocolMismatchMessage } from './protocol.js'
import { createLineReader, encodeLine } from './framing.js'
import { unsafeSocketDir } from './socketDir.js'
import { newHostNonce, proofMatches, readHostKey } from './hostKey.js'

/** What a connection may send after the handshake, and what it hands to its listeners: the client's side of
 *  the protocol this package knows. The app reads the same socket as its wider HostMessage type, whose union
 *  includes these; a listener here checks `t` before it reads anything else, since
 *  the Host also sends messages this package does not know. */
export type ConnectionClientMessage = ClientHelloMessage | OrchCallMessage
export type ConnectionHostMessage = HostHelloMessage | ProtocolMismatchMessage | OrchResultMessage

export interface HostConnection {
  /** `legacyApp`: the Host has an app 1.3.25 or older attached (ConnectionHostMessage `hello`). Absent otherwise. */
  hello: { host: string; pid: number; startedAt: string; features: string[]; legacyApp?: true }
  call(m: ConnectionClientMessage): void
  onMessage(cb: (m: ConnectionHostMessage) => void): () => void
  /** Fires once the connection ends, however that happens — including the Host closing its side,
   *  which is what `astera host stop` reads as "it left": a `retire` that is
   *  honoured gets no reply, only a socket that goes away. */
  onClose(cb: () => void): () => void
  /** Keeps Node running while this connection is open (a call is waiting), or lets it exit while the connection
   *  is idle: the socket's own ref and unref. A new connection is ref'd. */
  ref(): void
  unref(): void
  close(): void
}

/** `impostor`: something answered at the address but could not prove it is this profile's Host
 *  key — another account holding the pipe, most likely. Nothing was sent to it. */
export type ConnectFailure = { error: 'unreachable' | 'protocol' | 'timeout' | 'impostor' }

export async function connectHost(a: {
  address: string
  /** The profile whose Host key the answer is checked against. */
  profileDir: string
  app: string
  /** What the hello announces; the CLI's is `cli`. */
  role?: 'cli' | 'mcp'
  /** The MCP client an `mcp` connection serves, sent as given and left out when absent. The app cleans it
   *  first (its connect step, `mcpClientOf`). */
  client?: { name: string; version?: string }
  /** The network address an `mcp` connection serves over HTTP, stored by the Host as given. Left out for stdio. */
  remote?: string
  timeoutMs?: number
  /** Where a malformed line or a handler that threw gets reported. Every other real caller of
   *  `createLineReader` in this repo — `main/host/client.ts`'s `attach()`, `host/server.ts`'s
   *  connection handler — logs both rather than swallowing them; before this, `connectHost` did not,
   *  and the only visible effect of a broken line was the generic `unreachable`/`timeout`, which
   *  sends whoever is debugging it looking in the wrong place. */
  log(m: string): void
}): Promise<HostConnection | ConnectFailure> {
  // A socket in a directory another user could have made is not this user's Host, whatever answers
  // there (see socketDir.ts): read as no Host, and said so in the log.
  const unsafe = await unsafeSocketDir(a.address)
  if (unsafe !== null) {
    a.log(`${unsafe} — not connecting there`)
    return { error: 'unreachable' }
  }
  // Read before connecting: a Host always makes its key before it binds, so a missing key means no
  // Host of this profile can be at the address, whatever answers there.
  const key = await readHostKey(a.profileDir)
  const nonce = newHostNonce()
  return new Promise((resolve) => {
    const listeners = new Set<(m: ConnectionHostMessage) => void>()
    const closeListeners = new Set<() => void>()
    let settled = false
    const socket = net.connect(a.address)
    socket.setEncoding('utf8')
    socket.on('close', () => { for (const cb of closeListeners) cb() })
    const done = (v: HostConnection | ConnectFailure): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if ('error' in v) socket.destroy()
      resolve(v)
    }
    const timer = setTimeout(() => done({ error: 'timeout' }), a.timeoutMs ?? 5000)
    timer.unref?.()
    socket.on('error', () => done({ error: 'unreachable' }))
    const read = createLineReader({
      onMessage: (v) => {
        const m = v as ConnectionHostMessage
        if (!settled) {
          if (m.t === 'protocol-mismatch') return done({ error: 'protocol' })
          if (m.t === 'hello' && (key === null || !proofMatches(key, nonce, m.proof))) {
            a.log(
              `something at ${a.address} answered as a Host but could not prove it is this profile's Host${key === null ? ' (this profile has no Host key)' : ''} — nothing was sent to it`
            )
            return done({ error: 'impostor' })
          }
          if (m.t === 'hello')
            return done({
              hello: {
                host: m.host,
                pid: m.pid,
                startedAt: m.startedAt,
                features: m.features ?? [],
                ...(m.legacyApp === true ? { legacyApp: true as const } : {})
              },
              call: (out) => socket.write(encodeLine(out)),
              onMessage: (cb) => {
                listeners.add(cb)
                return () => listeners.delete(cb)
              },
              onClose: (cb) => {
                closeListeners.add(cb)
                return () => closeListeners.delete(cb)
              },
              ref: () => {
                socket.ref()
              },
              unref: () => {
                socket.unref()
              },
              close: () => socket.destroy()
            })
          return
        }
        for (const cb of listeners) cb(m)
      },
      // Same wording as `main/host/client.ts`'s `attach()` — this is the same failure reported at the
      // same seam, just without a persistent log file to write it to.
      onBadLine: (raw) => a.log(`the Host sent a line that is not JSON: ${raw.slice(0, 200)}`),
      onHandlerError: (v, err) =>
        a.log(`a message from the Host failed: ${JSON.stringify(v).slice(0, 200)} — ${String(err)}`)
    })
    socket.on('data', (c: string) => read(c))
    const client = a.client
    socket.on('connect', () =>
      socket.write(
        encodeLine({ t: 'hello', protocol: HOST_PROTOCOL, app: a.app, role: a.role ?? 'cli', nonce, ...(client ? { client } : {}), ...(a.remote ? { remote: a.remote } : {}) })
      )
    )
  })
}
