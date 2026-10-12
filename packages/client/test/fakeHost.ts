// A Host for the package's tests: a server on a named pipe (win32) or a socket in a private temp folder (posix) that
// answers hello the way the Host does, proven with a test profile's key. Not part of the package: the builds compile
// src/ only.
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { encodeLine } from '../src/framing.js'
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
