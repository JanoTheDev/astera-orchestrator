// The paired Runtimes as the app's main process reaches them (remote runtime design §2.7, C2 D1.1): one client and one
// mirror per Runtime, from this profile's controller registry (`astera runtimes add` and, from Phase 6, the app's own
// pairing dialog fill it). Kept per pairing: a re-pair (a new token or key for the same Runtime) opens a new client and
// closes the old, as MCP's kept links do.
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { openRemoteLink, type RemoteLink, type RemoteTarget } from '../../core/remote/link'
import type { RuntimeRegistry } from '../../core/runtimes/registry'
import os from 'node:os'
import { controllerRegistry, resolveRuntime, runRuntimesCommand } from '../../cli/runtimes'
import { connectRuntime } from '../../core/remote/client'
import type { RemoteRuntimeInfo } from '../../core/types'
import { createRemoteRuntimeClient, type RemoteRuntimeClient } from './runtimeClient'

/** How long a lost call from the app keeps trying to reach the Runtime again: a view waiting on it shows offline after
 *  this, where the CLI's one-shot command waits the link's full minute. */
export const APP_RECONNECT_FOR_MS = 10_000
/** How long `follow` gives a Runtime at a new address to answer its sign-in. */
export const FOLLOW_SIGN_IN_MS = 10_000

export interface RemoteRuntimes {
  client(runtimeId: string): Promise<RemoteRuntimeClient | { code: string; message: string }>
  /** The paired Runtimes, never with their tokens (Settings › Remote Runtimes). */
  list(): Promise<RemoteRuntimeInfo[]>
  /** Pairs from the string `astera runtime pair` printed there (the CLI's own `runtimes add`). */
  add(pairing: string, name?: string): Promise<{ ok: true; runtime: Record<string, unknown> } | { ok: false; code: string; message: string }>
  /** Forgets a Runtime here; it does not revoke the pairing there (§4.5). */
  remove(runtimeId: string): Promise<{ ok: true } | { ok: false; code: string; message: string }>
  /** Each paired Runtime's address and pin, never its token (main/remote/discovery.ts marks what it finds by them). */
  pins(): Promise<Array<{ runtimeId: string; address: string; port: number; fingerprint: string }>>
  /** A paired Runtime heard at a new address under its pin: signs in there (pinned TLS and hello), and only then moves
   *  its address in the registry and its client there. True when it moved; a wrong pin or a failed sign-in changes
   *  nothing. */
  follow(runtimeId: string, fingerprint: string, address: string, port: number): Promise<boolean>
  close(): void
}

type Found = RemoteRuntimeClient | { code: string; message: string }

export function createRemoteRuntimes(a: {
  profileDir: string
  version: string
  /** Test seam: the controller link for a target. */
  open?(t: RemoteTarget): RemoteLink
  /** Test seam: the pinned connection `follow` signs in on. */
  connect?: typeof connectRuntime
  /** This app's language, for the Runtime's journal rows (review I6). */
  lang?(): string
  /** A Runtime's client was replaced (a re-pair) or removed, after the fact. Its link does not tell the streams on it
   *  that it closed, so their owner subscribes them again (Phase 9b remoteStreams `rebind`). */
  onClientChange?(runtimeId: string): void
}): RemoteRuntimes {
  const clients = new Map<string, { client: RemoteRuntimeClient; pairing: string; stamp: string | null }>()
  /** The registry file as last seen (performance audit M4). Every remote call looks its Runtime up, and a lookup reads
   *  and checks the registry and the token file; while this file is unchanged a kept client is still the pairing it
   *  was made for, since a pairing (here or by `astera runtimes add|remove` elsewhere) always rewrites it. One stat
   *  instead of two checked reads. Null when it cannot be read: then nothing is reused. */
  const registryFile = path.join(a.profileDir, 'runtimes', 'runtimes.json')
  const stampOf = async (): Promise<string | null> => {
    try {
      const st = await fs.stat(registryFile)
      return `${st.ino}:${st.mtimeMs}:${st.ctimeMs}:${st.size}`
    } catch {
      return null
    }
  }
  /** Opened once (review I-4): opening takes the store's lock and sweeps it, which a read on every call must not do. */
  let registry: Promise<RuntimeRegistry> | null = null
  const reg = (): Promise<RuntimeRegistry> => {
    registry ??= controllerRegistry(a.profileDir).catch((e: unknown) => {
      registry = null
      throw e
    })
    return registry
  }
  /** One lookup per Runtime at a time (review I-1): two first calls at once share it, so no second link is opened. */
  const pending = new Map<string, Promise<Found>>()

  const lookup = async (runtimeId: string): Promise<Found> => {
    const stamp = await stampOf()
    const held = clients.get(runtimeId)
    if (held && stamp !== null && held.stamp === stamp) return held.client
    const r = await reg()
    const found = resolveRuntime(await r.list(), runtimeId)
    // By id only from the app: a name is for a person typing a command, and a view keys its data by id.
    if ('code' in found || found.runtimeId !== runtimeId) {
      // Removed outside this app (`astera runtimes remove`, second pass M2-7): its client and link go too.
      if (held) {
        held.client.close()
        clients.delete(runtimeId)
        setTimeout(() => a.onClientChange?.(runtimeId), 0)
      }
      return { code: 'RUNTIME_NOT_FOUND', message: `no paired Runtime has the id ${runtimeId}` }
    }
    const token = await r.token(found.runtimeId)
    if (token === null) return { code: 'RUNTIME_NOT_FOUND', message: `${found.name} has no token on this machine; pair it again` }
    const pairing = `${found.address}:${found.port}:${found.fingerprint}:${createHash('sha256').update(token).digest('hex')}`
    const kept = clients.get(found.runtimeId)
    if (kept?.pairing === pairing) {
      kept.stamp = stamp
      return kept.client
    }
    kept?.client.close()
    const target: RemoteTarget = { runtimeId: found.runtimeId, address: found.address, port: found.port, fingerprint: found.fingerprint, token }
    const link = (
      a.open ??
      ((t) => openRemoteLink({ target: t, client: { name: 'astera app', version: a.version, surface: 'desktop' }, reconnectForMs: APP_RECONNECT_FOR_MS }))
    )(target)
    const client = createRemoteRuntimeClient({ runtimeId: found.runtimeId, link, ...(a.lang ? { lang: a.lang } : {}) })
    clients.set(found.runtimeId, { client, pairing, stamp })
    // After this lookup settles, so the owner's own client() finds the new client rather than this pending lookup.
    if (kept) setTimeout(() => a.onClientChange?.(found.runtimeId), 0)
    return client
  }

  const client = (runtimeId: string): Promise<Found> => {
    const inFlight = pending.get(runtimeId)
    if (inFlight) return inFlight
    const p = lookup(runtimeId).finally(() => pending.delete(runtimeId))
    pending.set(runtimeId, p)
    return p
  }

  /** The Runtime's hello on a fresh pinned connection, closed after; null when it does not answer in FOLLOW_SIGN_IN_MS. */
  const signIn = async (to: { host: string; port: number; pin: string }, token: string): Promise<{ runtimeId: string } | null> => {
    const opening = (a.connect ?? connectRuntime)(to)
    const hello = opening.then((l) => l.auth(token, { name: 'astera app', version: a.version, surface: 'desktop' }))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([hello, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), FOLLOW_SIGN_IN_MS)))])
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      // Closed whenever it opens, after the deadline too.
      opening.then((l) => l.close(), () => {})
    }
  }

  return {
    list: async () => {
      const r = await reg()
      return (await r.list()).map((p) => {
        const c = clients.get(p.runtimeId)?.client
        return {
          runtimeId: p.runtimeId,
          name: p.name,
          address: p.address,
          port: p.port,
          permission: p.permission,
          // What this app last heard, by any call (Phase 6 review minor); the registry's time before any.
          lastSeenAt: c?.status().lastSeenAt ?? p.lastSeenAt,
          // Unknown until this app asked it something; then whether the last call was answered.
          offline: c ? c.status().offline : null
        }
      })
    },
    add: async (pairing, name) => {
      const done = await runRuntimesCommand('runtimes-add', { pair: pairing, ...(name ? { name } : {}) }, {
        registry: reg,
        connect: (o) => connectRuntime(o),
        hostname: () => os.hostname(),
        now: () => new Date().toISOString(),
        version: a.version,
        surface: 'app'
      })
      return done.ok ? { ok: true, runtime: done.body as Record<string, unknown> } : { ok: false, code: done.error.code, message: done.error.message }
    },
    remove: async (runtimeId) => {
      const r = await reg()
      if (!(await r.list()).some((p) => p.runtimeId === runtimeId)) return { ok: false, code: 'RUNTIME_NOT_FOUND', message: `no paired Runtime has the id ${runtimeId}` }
      await r.remove(runtimeId)
      clients.get(runtimeId)?.client.close()
      clients.delete(runtimeId)
      a.onClientChange?.(runtimeId)
      return { ok: true }
    },
    pins: async () => (await (await reg()).list()).map((p) => ({ runtimeId: p.runtimeId, address: p.address, port: p.port, fingerprint: p.fingerprint })),
    follow: async (runtimeId, fingerprint, address, port) => {
      const r = await reg()
      const p = (await r.list()).find((x) => x.runtimeId === runtimeId)
      if (!p || p.fingerprint !== fingerprint || (p.address === address && p.port === port)) return false
      const token = await r.token(runtimeId)
      if (token === null) return false
      const hello = await signIn({ host: address, port, pin: fingerprint }, token)
      if (hello?.runtimeId !== runtimeId) return false
      if (!(await r.setAddress(runtimeId, fingerprint, address, port))) return false
      // The registry changed, so this lookup replaces the kept client with one at the new address (and rebinds its streams).
      void client(runtimeId)
      return true
    },
    client,
    close: () => {
      for (const c of clients.values()) c.client.close()
      clients.clear()
    }
  }
}
