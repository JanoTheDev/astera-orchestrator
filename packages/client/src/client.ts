// @astera-app/client: talks to this machine's Astera Host the way the `astera` CLI does (SDK spec §4, local mode).
// One connection, many calls in flight (each `orch-call` carries its own id), the CLI's error codes, request ids for
// safe retries, and the CLI's public field shaping on every answer.
//
// **The client does not start a Host.** The CLI and its MCP server can, with the installed app's binary; an
// application using this package gets HOST_NOT_RUNNING and decides for itself. **It says `role: 'cli'`**: a Host
// reads an unknown role as `cli` anyway, and an SDK principal of its own comes with the plugin role.
import os from 'node:os'
import { connectHost, type ConnectFailure, type HostConnection } from './connect.js'
import { hostAddress } from './address.js'
import { hostTarget, profilePath } from './discovery.js'
import { AsteraError, codeForStatus, remoteCodeOf } from './errors.js'
import { HOST_FEATURE_REQUESTS, HOST_PROTOCOL, type OrchResultMessage } from './protocol.js'
import { publicFor } from './shape.js'

/** This package's version, sent in the hello as `sdk-<version>`. Kept equal to package.json by a test. */
export const CLIENT_VERSION = '0.1.0'

const CONNECT_TIMEOUT_MS = 5000
const CALL_TIMEOUT_MS = 60_000

export interface AsteraClientOptions {
  /** How to reach the Host. Only `'local'` (this machine's Host, over its pipe or socket) for now. */
  mode?: 'local'
  /** The profile folder whose Host to talk to. Default: `ASTERA_PROFILE_DIR`, else the installed app's, else the
   *  dev app's with `ASTERA_PROFILE=dev`. */
  profileDir?: string
  /** The Host's address. Default: `ASTERA_HOST` for the discovered profile, else the address `profileDir`'s Host
   *  listens on. An explicit `profileDir` without an `address` is always that profile's own Host. */
  address?: string
  /** How long the handshake may take. */
  connectTimeoutMs?: number
  /** How long a call may wait for its answer, unless the call says otherwise. */
  callTimeoutMs?: number
  /** The environment discovery reads: `process.env` by default. */
  env?: Record<string, string | undefined>
  /** Where a malformed line from the Host or a failed handshake check is reported. Silent by default. */
  log?: (message: string) => void
}

/** The Host this client is connected to, from its last handshake. */
export interface HostInfo {
  version: string
  pid: number
  startedAt: string
  /** What the Host can do beyond the base protocol (`requests`, `orch`, `remote-runtime`, ...). */
  features: readonly string[]
}

export interface CallOptions {
  /** Makes a retry safe: the Host runs a command once per id and answers a repeat from its receipt. Refused with
   *  VERSION_MISMATCH by a Host that keeps no receipts. */
  requestId?: string
  /** Ends the wait for the answer. The Host may still finish the command: cancelling a call is not cancelling a
   *  Run (SDK spec §34). */
  signal?: AbortSignal
  /** How long to wait for this answer. */
  timeoutMs?: number
}

export interface CallResult {
  /** The answer in the public shape the CLI prints (internal fields left out). */
  body: unknown
  /** The answer came from a receipt: the command did not run again. */
  replayed: boolean
  /** The command committed earlier and this is what is true now (a repeated id on a command that waits). */
  observed: boolean
}

export interface AsteraClient {
  readonly host: HostInfo
  readonly profileDir: string
  readonly address: string
  hasFeature(name: string): boolean
  /** Runs one Host command. Rejects with an AsteraError carrying the CLI's code. */
  call(cmd: string, args?: Record<string, unknown>, options?: CallOptions): Promise<CallResult>
  /** Ends the connection; a call in flight fails, and later calls are refused. */
  close(): void
}

const connectError = (error: ConnectFailure['error'], address: string, profileDir: string): AsteraError => {
  if (error === 'unreachable')
    return new AsteraError('HOST_NOT_RUNNING', `no Astera Host is answering at ${address}: open the Astera app, or run \`astera host start\``, { address, profileDir })
  if (error === 'impostor')
    return new AsteraError('PERMISSION_DENIED', `something at ${address} answered but could not prove it is the Host of ${profileDir}; nothing was sent to it`, { address, profileDir })
  if (error === 'protocol')
    return new AsteraError('VERSION_MISMATCH', `the Host at ${address} speaks a different protocol version than this client (${HOST_PROTOCOL})`, { address })
  return new AsteraError('TIMEOUT', `the Host at ${address} accepted the connection but did not say hello`, { address })
}

/** A refusal as the CLI reads it: the Runtime's own code when its body names one, else the status's, never one
 *  picked from the sentence. */
const callError = (cmd: string, status: number, body: unknown): AsteraError => {
  const said = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined
  const message = typeof said === 'string' && said.length > 0 ? said : `the Host answered ${status} to ${cmd}`
  return new AsteraError(remoteCodeOf(body) ?? codeForStatus(status), message, body)
}

const CLOSED_IN_FLIGHT = 'the client was closed before the Host answered'
const CLOSED = 'the client is closed'

export async function createAsteraClient(options: AsteraClientOptions = {}): Promise<AsteraClient> {
  if (options.mode !== undefined && options.mode !== 'local')
    throw new AsteraError('INVALID_ARGUMENTS', `mode '${String(options.mode)}' is not supported yet; this client speaks 'local'`)
  const platform = process.platform
  const target = hostTarget({ env: options.env ?? process.env, platform, home: os.homedir(), tmpDir: os.tmpdir() })
  const profileDir = options.profileDir !== undefined ? profilePath(options.profileDir, platform) : target.profileDir
  // An explicit profile is that profile's Host, whatever ASTERA_HOST says; ASTERA_HOST goes with the discovered one
  const address =
    options.address ??
    (options.profileDir !== undefined ? hostAddress({ profileDir, platform, tmpDir: os.tmpdir(), protocol: HOST_PROTOCOL }).address : target.address)
  const log = options.log ?? (() => {})
  const callTimeoutMs = options.callTimeoutMs ?? CALL_TIMEOUT_MS

  let conn: HostConnection | null = null
  let connecting: Promise<HostConnection> | null = null
  let host: HostInfo | null = null
  let closed = false
  let seq = 0
  /** Calls in flight: how to answer one, and how to fail one when its connection ends. */
  const inflight = new Map<string, { answer(m: OrchResultMessage): void; fail(e: unknown): void }>()

  const open = (): Promise<HostConnection> => {
    if (conn !== null) return Promise.resolve(conn)
    connecting ??= (async () => {
      const c = await connectHost({
        address,
        profileDir,
        app: `sdk-${CLIENT_VERSION}`,
        role: 'cli',
        timeoutMs: options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
        log
      })
      if ('error' in c) throw connectError(c.error, address, profileDir)
      host = { version: c.hello.host, pid: c.hello.pid, startedAt: c.hello.startedAt, features: [...c.hello.features] }
      c.onMessage((m) => {
        if (m.t === 'orch-result') inflight.get(m.call)?.answer(m)
      })
      c.onClose(() => {
        if (conn === c) conn = null
        const why = closed
          ? new AsteraError('FAILED', CLOSED_IN_FLIGHT)
          : new AsteraError('HOST_NOT_RUNNING', `the Host at ${address} closed the connection before answering`, { address })
        for (const call of [...inflight.values()]) call.fail(why)
      })
      conn = c
      return c
    })().finally(() => {
      connecting = null
    })
    return connecting
  }

  const call = async (cmd: string, args: Record<string, unknown> = {}, o: CallOptions = {}): Promise<CallResult> => {
    if (closed) throw new AsteraError('FAILED', CLOSED)
    o.signal?.throwIfAborted()
    const c = await open()
    if (closed) throw new AsteraError('FAILED', CLOSED)
    const h = host as HostInfo
    if (o.requestId !== undefined && !h.features.includes(HOST_FEATURE_REQUESTS))
      throw new AsteraError('VERSION_MISMATCH', `the Host ${h.version} keeps no request receipts, so a requestId cannot make ${cmd} safe to retry`, { requestId: o.requestId })
    o.signal?.throwIfAborted()
    const id = `sdk_${++seq}`
    const ms = o.timeoutMs ?? callTimeoutMs
    return new Promise<CallResult>((resolve, reject) => {
      let done = false
      const finish = (settle: () => void): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        inflight.delete(id)
        o.signal?.removeEventListener('abort', onAbort)
        settle()
      }
      const onAbort = (): void => finish(() => reject(o.signal?.reason))
      const timer = setTimeout(() => finish(() => reject(new AsteraError('TIMEOUT', `the Host did not answer ${cmd} within ${ms} ms`, { cmd }))), ms)
      o.signal?.addEventListener('abort', onAbort, { once: true })
      inflight.set(id, {
        answer: (m) =>
          finish(() =>
            m.status >= 200 && m.status < 300
              ? resolve({ body: publicFor(cmd, m.body), replayed: m.replayed === true, observed: m.observed === true })
              : reject(callError(cmd, m.status, m.body))
          ),
        fail: (e) => finish(() => reject(e))
      })
      c.call({ t: 'orch-call', call: id, cmd, args, ...(o.requestId !== undefined ? { request: o.requestId } : {}) })
    })
  }

  await open()
  return {
    get host(): HostInfo {
      return host as HostInfo
    },
    profileDir,
    address,
    hasFeature: (name) => (host as HostInfo).features.includes(name),
    call,
    close: () => {
      if (closed) return
      closed = true
      conn?.close()
      const why = new AsteraError('FAILED', CLOSED_IN_FLIGHT)
      for (const c of [...inflight.values()]) c.fail(why)
    }
  }
}
