// The Runtime's side of Found on your network (core/remote/discovery.ts): while the Gateway is up, its beacon goes to
// the multicast group every few seconds, out of the listen address's own interface and no other, one hop only. A
// Gateway on 127.0.0.1 sends nothing. A send that fails is dropped: the next one tries again.
import dgram from 'node:dgram'
import { BEACON_EVERY_MS, BEACON_GROUP, BEACON_PORT, beaconInterface, encodeBeacon, type Beacon } from '../../core/remote/discovery'

/** What the sender needs of a UDP socket (node:dgram's, or a test's). */
export interface BeaconSocket {
  bind(o: { address: string; port: number }, cb: () => void): unknown
  setMulticastInterface(address: string): void
  setMulticastTTL(ttl: number): unknown
  send(msg: Buffer, port: number, address: string, cb?: (e: Error | null) => void): void
  on(event: 'error', cb: (e: Error) => void): unknown
  close(): void
}

/** The beacon's `os`: the words Tailscale uses, so both sources read alike. */
export const beaconOs = (platform: NodeJS.Platform): string => (platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macOS' : platform)

/** Starts sending `beacon` for a Gateway listening on `listen`; null (and nothing sent) when that address is not one
 *  other machines can reach. */
export function startBeacon(o: {
  listen: string
  beacon: Beacon
  /** Test seam: a udp4 socket. */
  socket?(): BeaconSocket
  everyMs?: number
}): { stop(): void } | null {
  const iface = beaconInterface(o.listen)
  const msg = encodeBeacon(o.beacon)
  if (iface === null || msg === null) return null
  const sock = o.socket?.() ?? dgram.createSocket({ type: 'udp4' })
  sock.on('error', () => {})
  let timer: ReturnType<typeof setInterval> | null = null
  let stopped = false
  const send = (): void => {
    if (!stopped) sock.send(msg, BEACON_PORT, BEACON_GROUP, () => {})
  }
  // Bound to the listen address, so the packets leave from it, on its network only.
  sock.bind({ address: iface, port: 0 }, () => {
    if (stopped) return
    try {
      sock.setMulticastInterface(iface)
      sock.setMulticastTTL(1)
    } catch {
      return
    }
    send()
    timer = setInterval(send, o.everyMs ?? BEACON_EVERY_MS)
    timer.unref?.()
  })
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      if (timer) clearInterval(timer)
      try {
        sock.close()
      } catch {
        /* closed already */
      }
    }
  }
}
