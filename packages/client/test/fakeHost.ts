// A Host for the package's tests: a server on a named pipe (win32) or a socket in a private temp folder (posix) that
// answers hello the way the Host does, proven with a test profile's key. Not part of the package: the builds compile
// src/ only.
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createLineReader, encodeLine } from '../src/framing.js'
import { ensureHostKey, hostProof } from '../src/hostKey.js'
import { HOST_PROTOCOL } from '../src/protocol.js'

/** A profile folder with a Host key made the way the Host makes it. */
export async function makeProfile(): Promise<{ dir: string; key: string; cleanup(): Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astera-sdk-profile-'))
  const key = await ensureHostKey(dir)
  return { dir, key, cleanup: () => fs.rm(dir, { recursive: true, force: true }) }
}

/** A fresh address: a pipe name on win32, a socket in its own 0700 temp folder on posix (what unsafeSocketDir
 *  accepts). */
export async function freshAddress(): Promise<string> {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\astera-sdk-test-${Math.random().toString(16).slice(2)}`
    : path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'astera-')), 'sock')
}

/** A server whose first line from each client is its hello: `onHello` gets the socket, the client's nonce and the
 *  hello itself, and answers as the test needs. */
export async function listen(
  onHello: (sock: net.Socket, nonce: string, hello: Record<string, unknown>) => void
): Promise<{ address: string; close(): Promise<void> }> {
  const address = await freshAddress()
  const sockets = new Set<net.Socket>()
  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
    sock.setEncoding('utf8')
    sock.once('data', (d: string) => {
      const sent = JSON.parse(d.split('\n')[0]) as Record<string, unknown>
      onHello(sock, typeof sent.nonce === 'string' ? sent.nonce : '', sent)
    })
  })
  await new Promise<void>((r) => server.listen(address, r))
  return {
    address,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy()
        server.close(() => r())
      })
  }
}

/** The Host's hello, proven with `key`. */
export const helloLine = (key: string, nonce: string, extra: Record<string, unknown> = {}): string =>
  encodeLine({ t: 'hello', protocol: HOST_PROTOCOL, host: '1.4.11', pid: 7, startedAt: 'T', features: [], proof: hostProof(key, nonce), ...extra })

export interface FakeReply {
  status: number
  body: unknown
  replayed?: true
  observed?: true
}

/** A Host that answers hello (proven with `key`, announcing `features`) and then `orch-call`s through `onCall`.
 *  `onCall` may answer later, never, or close the socket; by default every call answers 200 with `{ cmd, args }`. */
export interface FakeHost {
  address: string
  /** How many hellos it has answered: one per connection. */
  hellos(): number
  /** Every `orch-call` it received, in order. */
  calls(): Array<{ call: string; cmd: string; args: Record<string, unknown>; session?: string; request?: string }>
  /** Ends every client connection, as a Host that went away would. */
  dropClients(): void
  close(): Promise<void>
}

export async function startHost(o: {
  key: string
  features?: string[]
  onCall?: (m: { call: string; cmd: string; args: Record<string, unknown> }, reply: (r: FakeReply) => void, sock: net.Socket) => void
}): Promise<FakeHost> {
  const address = await freshAddress()
  const sockets = new Set<net.Socket>()
  const calls: ReturnType<FakeHost['calls']> = []
  let hellos = 0
  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))
    sock.on('error', () => {})
    sock.setEncoding('utf8')
    const read = createLineReader({
      onMessage: (v) => {
        const m = v as Record<string, unknown>
        if (m.t === 'hello') {
          hellos++
          sock.write(helloLine(o.key, String(m.nonce ?? ''), { features: o.features ?? ['requests'] }))
          return
        }
        if (m.t !== 'orch-call') return
        const msg = m as unknown as ReturnType<FakeHost['calls']>[number]
        calls.push(msg)
        const reply = (r: FakeReply): void => {
          if (!sock.destroyed) sock.write(encodeLine({ t: 'orch-result', call: msg.call, ...r }))
        }
        if (o.onCall) o.onCall(msg, reply, sock)
        else reply({ status: 200, body: { cmd: msg.cmd, args: msg.args } })
      },
      onBadLine: () => {},
      onHandlerError: () => {}
    })
    sock.on('data', (c: string) => read(c))
  })
  await new Promise<void>((r) => server.listen(address, r))
  return {
    address,
    hellos: () => hellos,
    calls: () => calls,
    dropClients: () => {
      for (const s of sockets) s.destroy()
    },
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy()
        server.close(() => r())
      })
  }
}
