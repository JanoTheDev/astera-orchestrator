// The process a plugin runs in (plugin runtime design P9, P10): it speaks JSON-RPC with the Host on its stdin and
// stdout, loads the plugin's entry when the Host says `initialize`, and gives the plugin its context, whose `astera` is
// the Host's own copy of @astera-app/client over this same channel. The Host answers the plugin's calls as the
// plugin, within the permissions the person granted (P12); nothing here decides what a plugin may do.
import type { Readable } from 'node:stream'
import {
  AsteraError,
  createAsteraClientOver,
  type AsteraClient,
  type ConnectionClientMessage,
  type ConnectionHostMessage,
  type HostConnection
} from '../core/publicContract'
import { RPC_CLOSED, RPC_INTERNAL_ERROR, RPC_INVALID_PARAMS, RPC_METHOD_NOT_FOUND, RPC_NOT_READY, RpcError, createRpcPeer } from '../core/plugins/rpc'
import type { PluginContext, PluginDefinition } from '../core/pluginContract'

interface InitializeParams {
  apiVersion: string
  plugin: { id: string; version: string; dir: string; entry: string; permissions: string[]; settings?: Record<string, string | number | boolean> }
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
    (p.settings === undefined || isObject(p.settings)) &&
    typeof h.version === 'string' &&
    typeof h.pid === 'number' &&
    typeof h.startedAt === 'string' &&
    isStrings(h.features)
  return ok ? (v as unknown as InitializeParams) : null
}

/** What a plugin's entry may define for the Host to call, beside activate and deactivate (plugin Phase 3 N5). */
const HANDLERS = ['onEvent', 'send', 'listItems', 'getItem', 'buildJobContext', 'runCheck'] as const
const MEMBERS = ['activate', 'deactivate', ...HANDLERS] as const

/** The plugin an entry exports as its default (`definePlugin`), one default deeper for CommonJS compiled from ESM. */
function definitionOf(mod: unknown): PluginDefinition | null {
  let d: unknown = isObject(mod) && 'default' in mod ? mod.default : mod
  if (isObject(d)) {
    const outer = d
    if (MEMBERS.every((k) => outer[k] === undefined) && isObject(outer.default)) d = outer.default
  }
  if (!isObject(d)) return null
  for (const k of MEMBERS) if (d[k] !== undefined && typeof d[k] !== 'function') return null
  return d as PluginDefinition
}

/** How long deactivate may take once the Host has closed the channel: the same grace the Host gives a stop. */
const END_GRACE_MS = 5_000

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
  /** How long deactivate may take once the Host has closed the channel (2b final review I3). */
  endGraceMs?: number
}): void {
  const endGraceMs = o.endGraceMs ?? END_GRACE_MS
  const lifetime = new AbortController()
  const toClient = new Set<(m: ConnectionHostMessage) => void>()
  const closers = new Set<() => void>()
  let started = false
  let definition: PluginDefinition | null = null
  /** The plugin's context, once activate has it: what its handlers are called with. */
  let context: PluginContext | null = null
  let client: AsteraClient | null = null
  let stopping: Promise<void> | null = null
  /** The Host closed the channel: no call can be answered from here on. */
  let ended = false

  const peer = createRpcPeer({
    send: (line) => o.output(line),
    onBadMessage: (m) => o.log(`[launcher] ${m}`),
    onRequest: async (method, params, signal) => {
      if (method === 'initialize') return initialize(params)
      if (method === 'events.deliver') return handOver('onEvent', 'event', method, params, signal)
      if (method === 'notifications.send') return handOver('send', 'notification', method, params, signal)
      // Plugin Phase 4 J6: a job source answers with what its function returned
      if (method === 'jobSource.list') {
        const q = isObject(params) ? params : {}
        const input = { ...(typeof q.query === 'string' ? { query: q.query } : {}), ...(typeof q.cursor === 'string' ? { cursor: q.cursor } : {}) }
        return sendable('listItems', [input], signal)
      }
      if (method === 'jobSource.get' || method === 'jobSource.context') {
        const id = isObject(params) && typeof params.id === 'string' && params.id !== '' ? params.id : null
        if (id === null) throw new RpcError(RPC_INVALID_PARAMS, `${method} needs { id }`)
        return sendable(method === 'jobSource.get' ? 'getItem' : 'buildJobContext', [id], signal)
      }
      // Plugin Phase 5 C2: a completion check answers with what runCheck returned; the Host checks and cuts it (C5)
      if (method === 'completionCheck.run') {
        if (!isObject(params) || !isObject(params.input)) throw new RpcError(RPC_INVALID_PARAMS, 'completionCheck.run needs { input }')
        return sendable('runCheck', [params.input], signal)
      }
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

  /** A secrets request to the Host, its refusal turned into an Error with the Host's words. */
  const secretCall = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    peer.request(method, params).catch((e: unknown) => {
      throw new Error(messageOf(e))
    })

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
    client = await createAsteraClientOver({
      // Once the Host has closed the channel a call fails at once instead of waiting out its deadline.
      connect: async () => {
        if (ended) throw new AsteraError('HOST_NOT_RUNNING', 'the Host closed the plugin channel')
        return connection
      },
      address: 'the plugin channel',
      profileDir: p.plugin.dir
    })
    const ctx: PluginContext = {
      astera: client,
      plugin: { id: p.plugin.id, version: p.plugin.version, dir: p.plugin.dir },
      permissions: Object.freeze([...p.plugin.permissions]),
      settings: Object.freeze({ ...(p.plugin.settings ?? {}) }),
      // Kept by the Host in the plugin's own store (spec §23); a refusal comes back as the Host worded it.
      secrets: {
        get: async (name) => {
          const r = (await secretCall('secrets.get', { name })) as { value?: unknown } | null
          return typeof r?.value === 'string' ? r.value : undefined
        },
        set: async (name, value) => void (await secretCall('secrets.set', { name, value })),
        delete: async (name) => void (await secretCall('secrets.delete', { name }))
      },
      log: {
        info: (m) => o.log(`[info] ${m}`),
        warn: (m) => o.log(`[warn] ${m}`),
        error: (m) => o.log(`[error] ${m}`)
      },
      signal: lifetime.signal
    }
    context = ctx
    try {
      await definition.activate?.(ctx)
    } catch (e) {
      o.log(`[launcher] activate threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
      throw new RpcError(RPC_INTERNAL_ERROR, `activate threw: ${messageOf(e)}`)
    }
    // The Host fails the start of a plugin whose capability has no handler here (plugin Phase 3 N5)
    const own = definition as unknown as Record<string, unknown>
    return { handlers: HANDLERS.filter((h) => typeof own[h] === 'function') }
  }

  /** One event for onEvent, or one notification for send (plugin Phase 3 N5): answered once the handler's promise
   *  settles, with its message when it threw. The Host logs the failure and hands the same one over again. */
  async function handOver(handler: (typeof HANDLERS)[number], param: string, method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (!definition || !context) throw new RpcError(RPC_NOT_READY, 'the plugin is not started')
    if (stopping) throw new RpcError(RPC_NOT_READY, 'the plugin is stopping')
    const item = isObject(params) && isObject(params[param]) ? params[param] : null
    if (!item) throw new RpcError(RPC_INVALID_PARAMS, `${method} needs { ${param} }`)
    await answer(handler, [item], signal)
    return {}
  }

  /** Calls `handler` with `args` and the plugin's context, and answers what it returned (null for nothing), or the
   *  message it threw. The context's `signal` is this call's (5d): it aborts when the Host stops waiting for it, as
   *  well as when the plugin stops. */
  async function answer(handler: (typeof HANDLERS)[number], args: unknown[], signal: AbortSignal): Promise<unknown> {
    if (!definition || !context) throw new RpcError(RPC_NOT_READY, 'the plugin is not started')
    if (stopping) throw new RpcError(RPC_NOT_READY, 'the plugin is stopping')
    const own = definition as unknown as Record<string, unknown>
    const fn = own[handler]
    if (typeof fn !== 'function') throw new RpcError(RPC_METHOD_NOT_FOUND, `the plugin has no ${handler}`)
    const ctx: PluginContext = { ...context, signal: AbortSignal.any([context.signal, signal]) }
    try {
      return (await (fn as (...a: unknown[]) => unknown).call(definition, ...args, ctx)) ?? null
    } catch (e) {
      throw new RpcError(RPC_INTERNAL_ERROR, `${handler} threw: ${messageOf(e)}`)
    }
  }

  /** A job source's or a check's answer (plugin Phase 4 J6, Phase 5 C2), refused with why when JSON cannot hold it: a
   *  BigInt or a loop would otherwise be lost on its way to the Host (4a final review I3). An event's or a
   *  notification's answer is not sent, so it is not checked. */
  async function sendable(handler: (typeof HANDLERS)[number], args: unknown[], signal: AbortSignal): Promise<unknown> {
    const result = await answer(handler, args, signal)
    try {
      JSON.stringify(result)
    } catch (e) {
      throw new RpcError(RPC_INTERNAL_ERROR, `${handler} answered with something that cannot be sent: ${messageOf(e)}`)
    }
    return result
  }

  o.input.setEncoding('utf8')
  o.input.on('data', (chunk: string) => peer.feed(chunk))
  const onEnd = (): void => {
    if (ended) return
    ended = true
    peer.close('the Host closed the plugin channel')
    closers.forEach((c) => c())
    // With the Host gone a plugin must not outlive it, whatever its deactivate does.
    let done = false
    const leave = (): void => {
      if (done) return
      done = true
      o.exit(0)
    }
    const grace = setTimeout(() => {
      o.log(`[launcher] deactivate did not finish within ${endGraceMs / 1000} s of the Host leaving; exiting`)
      leave()
    }, endGraceMs)
    void stop().then(() => {
      clearTimeout(grace)
      leave()
    })
  }
  o.input.on('end', onEnd)
  o.input.on('close', onEnd)
}
