// The process a plugin runs in (plugin runtime design P9, P10): it speaks JSON-RPC with the Host on its stdin and
// stdout, loads the plugin's entry when the Host says `initialize`, and gives the plugin its context, whose `astera` is
// the Host's own copy of @astera-app/client over this same channel. The Host answers the plugin's calls as the
// plugin, within the permissions the person granted (P12); nothing here decides what a plugin may do.
import type { Readable } from 'node:stream'
import {
  createAsteraClientOver,
  type AsteraClient,
  type ConnectionClientMessage,
  type ConnectionHostMessage,
  type HostConnection
} from '../core/publicContract'
import { RPC_CLOSED, RPC_INTERNAL_ERROR, RPC_INVALID_PARAMS, RPC_METHOD_NOT_FOUND, RpcError, createRpcPeer } from '../core/plugins/rpc'
import type { PluginContext, PluginDefinition } from '../../packages/plugin-sdk/src/index'

interface InitializeParams {
  apiVersion: string
  plugin: { id: string; version: string; dir: string; entry: string; permissions: string[] }
  host: { version: string; pid: number; startedAt: string; features: string[] }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

const initializeParams = (v: unknown): InitializeParams | null => {
  if (!isObject(v) || typeof v.apiVersion !== 'string' || !isObject(v.plugin) || !isObject(v.host)) return null
  const p = v.plugin
  const h = v.host
  const ok =
    typeof p.id === 'string' &&
    typeof p.version === 'string' &&
    typeof p.dir === 'string' &&
    typeof p.entry === 'string' &&
    isStrings(p.permissions) &&
    typeof h.version === 'string' &&
    typeof h.pid === 'number' &&
    typeof h.startedAt === 'string' &&
    isStrings(h.features)
  return ok ? (v as unknown as InitializeParams) : null
}

/** The plugin an entry exports as its default (`definePlugin`), one default deeper for CommonJS compiled from ESM. */
function definitionOf(mod: unknown): PluginDefinition | null {
  let d: unknown = isObject(mod) && 'default' in mod ? mod.default : mod
  if (isObject(d) && d.activate === undefined && d.deactivate === undefined && isObject(d.default)) d = d.default
  if (!isObject(d)) return null
  if (d.activate !== undefined && typeof d.activate !== 'function') return null
  if (d.deactivate !== undefined && typeof d.deactivate !== 'function') return null
  return d as PluginDefinition
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function runLauncher(o: {
  /** The Host's side of the channel: what it sends arrives here. */
  input: Readable
  /** One line to the Host. */
  output(line: string): void
  /** One line to the plugin's log (its stderr). */
  log(line: string): void
  importEntry(file: string): Promise<unknown>
  exit(code: number): void
}): void {
  const lifetime = new AbortController()
  const toClient = new Set<(m: ConnectionHostMessage) => void>()
  const closers = new Set<() => void>()
  let started = false
  let definition: PluginDefinition | null = null
  let client: AsteraClient | null = null
  let stopping: Promise<void> | null = null

  const peer = createRpcPeer({
    send: (line) => o.output(line),
    onBadMessage: (m) => o.log(`[launcher] ${m}`),
    onRequest: async (method, params) => {
      if (method === 'initialize') return initialize(params)
      if (method === 'shutdown') {
        await stop()
        // After the answer is written: the peer writes it as this resolves, before the next turn.
        setImmediate(() => o.exit(0))
        return {}
      }
      throw new RpcError(RPC_METHOD_NOT_FOUND, `no method ${method}`)
    }
  })

  /** Aborts the plugin's signal and runs its deactivate, once. */
  const stop = (): Promise<void> =>
    (stopping ??= (async () => {
      lifetime.abort()
      try {
        await definition?.deactivate?.()
      } catch (e) {
        o.log(`[launcher] deactivate threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
      }
      client?.close()
    })())

  async function initialize(params: unknown): Promise<unknown> {
    const p = initializeParams(params)
    if (!p) throw new RpcError(RPC_INVALID_PARAMS, 'initialize needs apiVersion, plugin { id, version, dir, entry, permissions } and host { version, pid, startedAt, features }')
    if (started) throw new RpcError(RPC_INTERNAL_ERROR, 'the plugin is already started')
    started = true
    let mod: unknown
    try {
      mod = await o.importEntry(p.plugin.entry)
    } catch (e) {
      o.log(`[launcher] the entry could not be loaded: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
      throw new RpcError(RPC_INTERNAL_ERROR, `the entry could not be loaded: ${messageOf(e)}`)
    }
    definition = definitionOf(mod)
    if (!definition) throw new RpcError(RPC_INTERNAL_ERROR, 'the entry does not export a plugin: export default definePlugin({ ... })')
    const connection: HostConnection = {
      hello: { host: p.host.version, pid: p.host.pid, startedAt: p.host.startedAt, features: [...p.host.features] },
      call(m: ConnectionClientMessage) {
        if (m.t !== 'orch-call') return
        const deliver = (r: ConnectionHostMessage): void => toClient.forEach((l) => l(r))
        peer.request('call', { cmd: m.cmd, args: m.args, ...(m.request !== undefined ? { request: m.request } : {}) }).then(
          (r) => {
            const a = (isObject(r) ? r : {}) as { status?: unknown; body?: unknown; replayed?: unknown; observed?: unknown }
            deliver({
              t: 'orch-result',
              call: m.call,
              status: typeof a.status === 'number' ? a.status : 500,
              body: a.body,
              ...(a.replayed === true ? { replayed: true } : {}),
              ...(a.observed === true ? { observed: true } : {})
            })
          },
          (e: unknown) => {
            // A channel that ended has already failed the call through onClose.
            if (e instanceof RpcError && e.code === RPC_CLOSED) return
            deliver({ t: 'orch-result', call: m.call, status: 500, body: { error: messageOf(e) } })
          }
        )
      },
      onMessage(cb) {
        toClient.add(cb)
        return () => toClient.delete(cb)
      },
      onClose(cb) {
        closers.add(cb)
        return () => closers.delete(cb)
      },
      // The channel is the process's own stdio, which keeps it running until the Host lets go.
      ref() {},
      unref() {},
      close() {}
    }
    client = await createAsteraClientOver({ connect: async () => connection, address: 'the plugin channel', profileDir: p.plugin.dir })
    const ctx: PluginContext = {
      astera: client,
      plugin: { id: p.plugin.id, version: p.plugin.version, dir: p.plugin.dir },
      permissions: Object.freeze([...p.plugin.permissions]),
      log: {
        info: (m) => o.log(`[info] ${m}`),
        warn: (m) => o.log(`[warn] ${m}`),
        error: (m) => o.log(`[error] ${m}`)
      },
      signal: lifetime.signal
    }
    try {
      await definition.activate?.(ctx)
    } catch (e) {
      o.log(`[launcher] activate threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
      throw new RpcError(RPC_INTERNAL_ERROR, `activate threw: ${messageOf(e)}`)
    }
    return {}
  }

  o.input.setEncoding('utf8')
  o.input.on('data', (chunk: string) => peer.feed(chunk))
  let ended = false
  const onEnd = (): void => {
    if (ended) return
    ended = true
    peer.close('the Host closed the plugin channel')
    closers.forEach((c) => c())
    void stop().then(() => o.exit(0))
  }
  o.input.on('end', onEnd)
  o.input.on('close', onEnd)
}
