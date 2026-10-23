// Found on your network (docs/remote-runtime.md): a Runtime with Remote on says it is there with a small UDP multicast
// beacon on its listen address's network, and the controller lists what it hears beside its online Tailscale peers.
// The beacon is secret-free: who the Runtime is, its port and its pin, never a token, a pairing code, an account or a
// project. A beacon proves nothing; a paired Runtime is only believed at a new address after its pin and hello there.
import type { FoundDevice } from '../types'
import { isRuntimeId } from '../runtimes/registry'

export type { FoundDevice }

/** The multicast group and UDP port of the beacon: one of each, site-local (239.255/16). Block the port to stop it. */
export const BEACON_GROUP = '239.255.71.83'
export const BEACON_PORT = 47832
/** The largest beacon sent or read. */
export const BEACON_MAX_BYTES = 512
/** How often a Runtime sends it, and how long the controller keeps one it no longer hears. */
export const BEACON_EVERY_MS = 5_000
export const FOUND_TTL_MS = 20_000

export interface Beacon {
  v: 1
  runtimeId: string
  name: string
  port: number
  /** The Runtime's SPKI pin (cert.ts `spkiSha256`, base64url). */
  fingerprint: string
  os: string
  version: string
}

/** A beacon as heard: who sent it, from which address. */
export type HeardBeacon = Beacon & { address: string }

/** An online Tailscale peer this app could add (`tailscale status --json`). */
export interface TailscalePeer {
  source: 'tailscale'
  host: string
  address: string
  os: string
}

const PIN = /^[A-Za-z0-9_-]{43}$/
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const shortText = (v: unknown, max: number): v is string => typeof v === 'string' && v !== '' && v.length <= max

/** The beacon's bytes: its seven fields and nothing else, or null when they would pass the cap. */
export function encodeBeacon(b: Beacon): Buffer | null {
  const { v, runtimeId, name, port, fingerprint, os, version } = b
  const buf = Buffer.from(JSON.stringify({ v, runtimeId, name, port, fingerprint, os, version }))
  return buf.length <= BEACON_MAX_BYTES ? buf : null
}

/** A beacon read strictly: the version, every field's type and the cap; anything else is null. Unknown fields are
 *  dropped, so nothing else a sender puts in one reaches the app. */
export function decodeBeacon(buf: Buffer): Beacon | null {
  if (buf.length > BEACON_MAX_BYTES) return null
  let j: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(buf.toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    j = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const { v, runtimeId, name, port, fingerprint, os, version } = j
  if (v !== 1) return null
  if (typeof runtimeId !== 'string' || !isRuntimeId(runtimeId)) return null
  if (!shortText(name, 128) || !shortText(os, 32) || !shortText(version, 64)) return null
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (typeof fingerprint !== 'string' || !PIN.test(fingerprint)) return null
  return { v, runtimeId, name, port, fingerprint, os, version }
}

/** The interface a Runtime listening on `listen` sends its beacon on: that address itself, when it is one IPv4 other
 *  machines can reach. Null for 127.0.0.1 (this computer only), every interface (0.0.0.0) and anything not IPv4. */
export function beaconInterface(listen: string): string | null {
  const m = IPV4.exec(listen)
  if (!m || m.slice(1).some((p) => Number(p) > 255)) return null
  if (m[1] === '127' || m[1] === '0') return null
  return listen
}

/** The online Linux and Windows peers in `tailscale status --json`, with their first IPv4. Anything unreadable is none. */
export function parseTailscaleStatus(json: string): TailscalePeer[] {
  let j: { Peer?: Record<string, { DNSName?: unknown; HostName?: unknown; OS?: unknown; Online?: unknown; TailscaleIPs?: unknown }> }
  try {
    j = JSON.parse(json) as typeof j
  } catch {
    return []
  }
  const out: TailscalePeer[] = []
  for (const p of Object.values(j?.Peer ?? {})) {
    if (p?.Online !== true || (p.OS !== 'linux' && p.OS !== 'windows')) continue
    const address = Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs.find((ip): ip is string => typeof ip === 'string' && IPV4.test(ip)) : undefined
    const host = typeof p.DNSName === 'string' && p.DNSName !== '' ? p.DNSName.replace(/\.$/, '') : typeof p.HostName === 'string' ? p.HostName : ''
    if (address && host) out.push({ source: 'tailscale', host, address, os: p.OS })
  }
  return out
}

/** One list of what was found: a beacon and a Tailscale peer at the same address are one device. A device is marked
 *  paired when its beacon names a paired Runtime under the same pin, or, with no beacon, when it is at a paired
 *  Runtime's address. A beacon under a paired id with another pin is some other machine: found, not paired. */
export function mergeFound(
  beacons: HeardBeacon[],
  peers: TailscalePeer[],
  paired: Array<{ runtimeId: string; address: string; fingerprint: string }>
): FoundDevice[] {
  const out: FoundDevice[] = []
  const peerAt = new Map(peers.map((p) => [p.address, p]))
  const taken = new Set<string>()
  for (const b of beacons) {
    const peer = peerAt.get(b.address)
    if (peer) taken.add(peer.address)
    const mine = paired.find((p) => p.runtimeId === b.runtimeId && p.fingerprint === b.fingerprint)
    out.push({
      key: `rt:${b.runtimeId}@${b.address}`,
      name: b.name,
      address: b.address,
      port: b.port,
      os: b.os,
      sources: peer ? ['lan', 'tailscale'] : ['lan'],
      ...(mine ? { paired: mine.runtimeId } : {})
    })
  }
  for (const p of peers) {
    if (taken.has(p.address)) continue
    const mine = paired.find((r) => r.address === p.address || r.address === p.host)
    out.push({ key: `ts:${p.host}`, name: p.host, address: p.address, os: p.os, sources: ['tailscale'], ...(mine ? { paired: mine.runtimeId } : {}) })
  }
  return out.sort((x, y) => x.name.localeCompare(y.name) || x.key.localeCompare(y.key))
}
