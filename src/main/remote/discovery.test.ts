// Found on your network, the controller's side: beacons and Tailscale peers in one list, entries that expire, and a
// paired Runtime followed to a new address only under its pin.
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { NetworkInterfaceInfo } from 'node:os'
import { BEACON_GROUP, BEACON_PORT, encodeBeacon, type Beacon, type FoundDevice } from '../../core/remote/discovery'
import { createDiscovery, type DiscoverySocket } from './discovery'

const FP = 'A'.repeat(43)
const beacon: Beacon = { v: 1, runtimeId: 'rt_a', name: 'Office', port: 47831, fingerprint: FP, os: 'linux', version: '1.4.8' }
const nic = (address: string): NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null }) as NetworkInterfaceInfo
const status = JSON.stringify({ Peer: { x: { DNSName: 'box.ts.net.', OS: 'windows', Online: true, TailscaleIPs: ['100.64.0.9'] } } })

const fakeSocket = () => {
  const s = { bound: null as number | null, groups: [] as Array<[string, string | undefined]>, closed: false, message: (_m: Buffer, _r: { address: string }): void => {} }
  const sock = {
    bind: (port: number, cb: () => void) => {
      s.bound = port
      cb()
    },
    addMembership: (g: string, i?: string) => void s.groups.push([g, i]),
    on: (event: string, cb: (m: Buffer, r: { address: string }) => void) => {
      if (event === 'message') s.message = cb
      return sock
    },
    close: () => void (s.closed = true)
  } as DiscoverySocket
  return { s, sock, hear: (b: unknown, address: string) => s.message(Buffer.isBuffer(b) ? b : encodeBeacon(b as Beacon)!, { address }) }
}

const setup = (o: { tailscale?: () => Promise<string | null>; follow?: (id: string, fp: string, addr: string, port: number) => Promise<boolean> } = {}) => {
  let t = 1_000_000
  const f = fakeSocket()
  const changes: FoundDevice[][] = []
  const pins = [{ runtimeId: 'rt_a', address: '192.168.1.5', port: 47831, fingerprint: FP }]
  const follow = vi.fn(o.follow ?? (async () => true))
  const d = createDiscovery({
    pins: async () => pins,
    follow,
    onChange: (l) => void changes.push(l),
    socket: () => f.sock,
    interfaces: () => ({ 'Wi-Fi': [nic('192.168.1.10')] }),
    tailscale: o.tailscale ?? (async () => null),
    now: () => t
  })
  return { d, f, changes, follow, pins, tick: (ms: number) => (t += ms) }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => vi.useRealTimers())

describe('createDiscovery', () => {
  it('listens on the beacon port and group from the first discover, until closed', async () => {
    const { d, f } = setup()
    expect(f.s.bound).toBeNull()
    await d.discover()
    expect(f.s.bound).toBe(BEACON_PORT)
    expect(f.s.groups).toEqual([[BEACON_GROUP, '192.168.1.10']])
    d.close()
    expect(f.s.closed).toBe(true)
  })
  it('lists beacons and online Tailscale peers, marked paired or found', async () => {
    const { d, f } = setup({ tailscale: async () => status })
    await d.discover()
    f.hear({ ...beacon, runtimeId: 'rt_b', fingerprint: 'B'.repeat(43) }, '192.168.1.30')
    expect(await d.discover()).toEqual([
      { key: 'ts:box.ts.net', name: 'box.ts.net', address: '100.64.0.9', os: 'windows', sources: ['tailscale'] },
      { key: 'rt:rt_b@192.168.1.30', name: 'Office', address: '192.168.1.30', port: 47831, os: 'linux', sources: ['lan'] }
    ])
    f.hear(beacon, '192.168.1.5')
    expect((await d.discover()).find((x) => x.address === '192.168.1.5')).toMatchObject({ paired: 'rt_a' })
    d.close()
  })
  it('a missing or failing tailscale is beacons only, no error', async () => {
    for (const tailscale of [async () => null, async () => Promise.reject(new Error('ENOENT')), async () => 'garbage']) {
      const { d, f } = setup({ tailscale })
      await d.discover()
      f.hear({ ...beacon, runtimeId: 'rt_b' }, '192.168.1.30')
      expect((await d.discover()).map((x) => x.key)).toEqual(['rt:rt_b@192.168.1.30'])
      d.close()
    }
  })
  it('drops malformed packets, and forgets a Runtime not heard for 20 s', async () => {
    const { d, f, tick } = setup()
    await d.discover()
    f.hear(Buffer.from('{"v":2}'), '192.168.1.30')
    f.hear({ ...beacon, runtimeId: 'rt_b' }, '192.168.1.30')
    expect(await d.discover()).toHaveLength(1)
    tick(21_000)
    expect(await d.discover()).toEqual([])
    d.close()
  })
  it('announces a new device on onChange', async () => {
    const { d, f, changes } = setup()
    await d.discover()
    f.hear({ ...beacon, runtimeId: 'rt_b' }, '192.168.1.30')
    await flush()
    expect(changes.at(-1)?.map((x) => x.key)).toEqual(['rt:rt_b@192.168.1.30'])
    d.close()
  })
})

describe('following a paired Runtime to a new address', () => {
  it('a beacon under the pin at another address is followed there', async () => {
    const { d, f, follow } = setup()
    await d.discover()
    f.hear(beacon, '192.168.1.40')
    await flush()
    expect(follow).toHaveBeenCalledWith('rt_a', FP, '192.168.1.40', 47831)
    d.close()
  })
  it('a wrong pin, or the address it is already at, is never followed', async () => {
    const { d, f, follow } = setup()
    await d.discover()
    f.hear({ ...beacon, fingerprint: 'B'.repeat(43) }, '192.168.1.40')
    f.hear(beacon, '192.168.1.5')
    await flush()
    expect(follow).not.toHaveBeenCalled()
    d.close()
  })
  it('a failed sign-in is not tried again at once, at the same address', async () => {
    const { d, f, follow, tick } = setup({ follow: async () => false })
    await d.discover()
    f.hear(beacon, '192.168.1.40')
    await flush()
    f.hear(beacon, '192.168.1.40')
    await flush()
    expect(follow).toHaveBeenCalledTimes(1)
    tick(61_000)
    f.hear(beacon, '192.168.1.40')
    await flush()
    expect(follow).toHaveBeenCalledTimes(2)
    d.close()
  })
})
