// The Runtime's beacon: on its listen address's network only, every few seconds while the Gateway is up, and never
// for a Gateway on 127.0.0.1.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { BEACON_GROUP, BEACON_PORT, decodeBeacon, type Beacon } from '../../core/remote/discovery'
import { beaconOs, startBeacon, type BeaconSocket } from './beacon'

const beacon: Beacon = { v: 1, runtimeId: 'rt_ab12', name: 'Office', port: 47831, fingerprint: 'A'.repeat(43), os: 'linux', version: '1.4.8' }

const fakeSocket = () => {
  const s = {
    bound: null as { address: string; port: number } | null,
    iface: null as string | null,
    ttl: null as number | null,
    sent: [] as Array<{ msg: Buffer; port: number; address: string }>,
    closed: false
  }
  const sock: BeaconSocket = {
    bind: (o, cb) => {
      s.bound = o
      cb()
    },
    setMulticastInterface: (a) => void (s.iface = a),
    setMulticastTTL: (t) => void (s.ttl = t),
    send: (msg, port, address) => void s.sent.push({ msg, port, address }),
    on: () => sock,
    close: () => void (s.closed = true)
  }
  return { s, sock }
}

afterEach(() => vi.useRealTimers())

describe('startBeacon', () => {
  it('sends the beacon to the group from the listen address, one hop, every few seconds until stopped', () => {
    vi.useFakeTimers()
    const { s, sock } = fakeSocket()
    const b = startBeacon({ listen: '192.168.1.20', beacon, socket: () => sock, everyMs: 5000 })
    expect(b).not.toBeNull()
    expect(s.bound).toEqual({ address: '192.168.1.20', port: 0 })
    expect(s.iface).toBe('192.168.1.20')
    expect(s.ttl).toBe(1)
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0]).toMatchObject({ port: BEACON_PORT, address: BEACON_GROUP })
    expect(decodeBeacon(s.sent[0].msg)).toEqual(beacon)
    vi.advanceTimersByTime(10_000)
    expect(s.sent).toHaveLength(3)
    b!.stop()
    expect(s.closed).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(s.sent).toHaveLength(3)
  })
  it('sends nothing, and opens no socket, for a Gateway on 127.0.0.1 or every interface', () => {
    for (const listen of ['127.0.0.1', '0.0.0.0', '::1']) {
      const socket = vi.fn(() => fakeSocket().sock)
      expect(startBeacon({ listen, beacon, socket })).toBeNull()
      expect(socket).not.toHaveBeenCalled()
    }
  })
  it('names the OS as Tailscale does', () => {
    expect([beaconOs('win32'), beaconOs('darwin'), beaconOs('linux')]).toEqual(['windows', 'macOS', 'linux'])
  })
})
