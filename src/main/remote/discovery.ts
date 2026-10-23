// Found on your network, the controller's side (core/remote/discovery.ts): the app listens for Runtimes' beacons once
// something asks (`remote.discover`), until it quits, and reads the online Tailscale peers on each ask. A beacon that
// names a paired Runtime under its pin at another address is followed there: `follow` signs in under the pin first,
// and only then moves the stored address. A wrong pin is ignored, and a failed sign-in changes nothing.
import dgram from 'node:dgram'
import { execFile } from 'node:child_process'
import os, { type NetworkInterfaceInfo } from 'node:os'
import { privateIPv4s } from '../../core/remote/addresses'
import {
  BEACON_EVERY_MS,
  BEACON_GROUP,
  BEACON_PORT,
  FOUND_TTL_MS,
  decodeBeacon,
  mergeFound,
  parseTailscaleStatus,
  type FoundDevice,
  type HeardBeacon,
  type TailscalePeer
} from '../../core/remote/discovery'

/** What the listener needs of a UDP socket (node:dgram's, or a test's). */
export interface DiscoverySocket {
  bind(port: number, cb: () => void): unknown
  addMembership(group: string, iface?: string): void
  on(event: 'message', cb: (msg: Buffer, rinfo: { address: string }) => void): unknown
  on(event: 'error', cb: (e: Error) => void): unknown
  close(): void
}

/** How long a Runtime that could not be reached at an address is not tried there again. */
export const FOLLOW_RETRY_MS = 60_000

export interface Discovery {
  /** What is found now; the first call starts listening. */
  discover(): Promise<FoundDevice[]>
  close(): void
}

/** `tailscale status --json`, or null when there is no tailscale or it fails. */
const tailscaleStatus = (): Promise<string | null> =>
  new Promise((resolve) =>
    execFile('tailscale', ['status', '--json'], { timeout: 5_000, windowsHide: true, maxBuffer: 8 << 20 }, (e, stdout) => resolve(e ? null : stdout))
  )

export function createDiscovery(a: {
  /** Each paired Runtime's address and pin (main/remote/runtimes.ts `pins`). */
  pins(): Promise<Array<{ runtimeId: string; address: string; port: number; fingerprint: string }>>
  /** Signs in at the new address and moves it there on success (main/remote/runtimes.ts `follow`). */
  follow(runtimeId: string, fingerprint: string, address: string, port: number): Promise<boolean>
  /** The list again, whenever a beacon comes, goes or a Runtime moved. */
  onChange(found: FoundDevice[]): void
  log?(line: string): void
  /** Test seams. */
  socket?(): DiscoverySocket
  interfaces?(): Record<string, NetworkInterfaceInfo[] | undefined>
  tailscale?(): Promise<string | null>
  now?(): number
}): Discovery {
  const now = a.now ?? Date.now
  const heard = new Map<string, HeardBeacon & { at: number }>()
  let peers: TailscalePeer[] = []
  let sock: DiscoverySocket | null = null
  let sweep: ReturnType<typeof setInterval> | null = null
  const joined = new Set<string>()
  const following = new Set<string>()
  const failedAt = new Map<string, number>()

  const list = async (): Promise<FoundDevice[]> => {
    const pins = await a.pins().catch(() => [])
    return mergeFound([...heard.values()].map(({ at: _at, ...b }) => b), peers, pins)
  }
  const push = (): void => void list().then(a.onChange, () => {})
  /** Drops what was not heard for FOUND_TTL_MS; true when something went. */
  const expire = (): boolean => {
    let gone = false
    for (const [k, b] of heard) if (now() - b.at > FOUND_TTL_MS) gone = heard.delete(k) || gone
    return gone
  }
  /** The group on each private interface, joined again as interfaces come (this computer's own Wi-Fi moved too). */
  const join = (): void => {
    if (!sock) return
    for (const { address } of privateIPv4s((a.interfaces ?? os.networkInterfaces)())) {
      if (joined.has(address)) continue
      try {
        sock.addMembership(BEACON_GROUP, address)
        joined.add(address)
      } catch {
        /* an interface that went, or cannot join; the next sweep tries again */
      }
    }
  }

  const follow = async (b: HeardBeacon): Promise<void> => {
    const pin = (await a.pins().catch(() => [])).find((p) => p.runtimeId === b.runtimeId)
    // Not paired, another key (some other machine under that id: ignored), or already there.
    if (!pin || pin.fingerprint !== b.fingerprint || (pin.address === b.address && pin.port === b.port)) return
    const at = `${b.runtimeId}@${b.address}:${b.port}`
    if (following.has(b.runtimeId) || now() - (failedAt.get(at) ?? -Infinity) < FOLLOW_RETRY_MS) return
    following.add(b.runtimeId)
    try {
      const moved = await a.follow(b.runtimeId, b.fingerprint, b.address, b.port).catch(() => false)
      a.log?.(`remote discovery: ${b.runtimeId} ${moved ? 'moved to' : 'not reached at'} ${b.address}:${b.port}`)
      if (moved) {
        failedAt.delete(at)
        push()
      } else failedAt.set(at, now())
    } finally {
      following.delete(b.runtimeId)
    }
  }

  const onMessage = (msg: Buffer, rinfo: { address: string }): void => {
    const b = decodeBeacon(msg)
    if (!b) return
    const key = `${b.runtimeId}@${rinfo.address}`
    const was = heard.get(key)
    heard.set(key, { ...b, address: rinfo.address, at: now() })
    if (!was || was.port !== b.port || was.name !== b.name || was.fingerprint !== b.fingerprint) push()
    void follow({ ...b, address: rinfo.address })
  }

  const start = (): void => {
    if (sock) return
    const s: DiscoverySocket = a.socket?.() ?? dgram.createSocket({ type: 'udp4', reuseAddr: true })
    sock = s
    s.on('error', () => {})
    s.on('message', onMessage)
    s.bind(BEACON_PORT, join)
    sweep = setInterval(() => {
      join()
      if (expire()) push()
    }, BEACON_EVERY_MS)
    sweep.unref?.()
  }

  return {
    discover: async () => {
      start()
      peers = parseTailscaleStatus((await (a.tailscale ?? tailscaleStatus)().catch(() => null)) ?? '')
      expire()
      return list()
    },
    close: () => {
      if (sweep) clearInterval(sweep)
      sweep = null
      try {
        sock?.close()
      } catch {
        /* closed already */
      }
      sock = null
      joined.clear()
    }
  }
}
