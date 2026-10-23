// Found on your network: the beacon is read strictly and carries only who a Runtime is, never a secret; one list of
// what beacons and Tailscale found, each marked paired only on the pin.
import { describe, it, expect } from 'vitest'
import { BEACON_MAX_BYTES, beaconInterface, decodeBeacon, encodeBeacon, mergeFound, parseTailscaleStatus, type Beacon } from './discovery'

const FP = 'A'.repeat(43)
const beacon: Beacon = { v: 1, runtimeId: 'rt_ab12', name: 'Office', port: 47831, fingerprint: FP, os: 'linux', version: '1.4.8' }
const raw = (o: unknown): Buffer => Buffer.from(JSON.stringify(o))

describe('encodeBeacon and decodeBeacon', () => {
  it('round-trips the seven fields', () => {
    expect(decodeBeacon(encodeBeacon(beacon)!)).toEqual(beacon)
  })
  it('a decoded beacon carries only runtimeId, name, port, fingerprint, os and version', () => {
    const d = decodeBeacon(raw({ ...beacon, token: 'secret', pairing: 'code', accounts: ['a'] }))
    expect(Object.keys(d!).sort()).toEqual(['fingerprint', 'name', 'os', 'port', 'runtimeId', 'v', 'version'])
  })
  it('the encoder writes nothing but those fields', () => {
    const sent = JSON.parse(encodeBeacon({ ...beacon, token: 'secret' } as Beacon)!.toString()) as Record<string, unknown>
    expect(sent).not.toHaveProperty('token')
  })
  it('drops a wrong version, a malformed packet and wrong field types', () => {
    for (const bad of [
      Buffer.from('not json'),
      raw([beacon]),
      raw(null),
      raw({ ...beacon, v: 2 }),
      raw({ ...beacon, v: '1' }),
      raw({ ...beacon, runtimeId: 'RT_AB' }),
      raw({ ...beacon, runtimeId: '../x' }),
      raw({ ...beacon, port: 0 }),
      raw({ ...beacon, port: 1.5 }),
      raw({ ...beacon, port: '47831' }),
      raw({ ...beacon, fingerprint: 'short' }),
      raw({ ...beacon, name: '' }),
      raw({ ...beacon, os: 7 }),
      raw({ ...beacon, version: undefined })
    ])
      expect(decodeBeacon(bad)).toBeNull()
  })
  it('drops an oversized packet, and will not encode one', () => {
    const big = raw({ ...beacon, pad: 'x'.repeat(BEACON_MAX_BYTES) })
    expect(decodeBeacon(big)).toBeNull()
    expect(encodeBeacon({ ...beacon, name: 'x'.repeat(BEACON_MAX_BYTES) })).toBeNull()
  })
})

describe('beaconInterface', () => {
  it('is the listen address when other machines can reach it, never 127.0.0.1, 0.0.0.0 or not IPv4', () => {
    expect(beaconInterface('192.168.1.20')).toBe('192.168.1.20')
    expect(beaconInterface('100.101.102.103')).toBe('100.101.102.103')
    for (const no of ['127.0.0.1', '0.0.0.0', '::', '::1', 'localhost', '300.1.1.1', '']) expect(beaconInterface(no)).toBeNull()
  })
})

describe('parseTailscaleStatus', () => {
  it('is the online Linux and Windows peers, by DNS name and first IPv4', () => {
    const status = {
      Self: { DNSName: 'me.tail.ts.net.', OS: 'linux', Online: true, TailscaleIPs: ['100.64.0.1'] },
      Peer: {
        a: { DNSName: 'box.tail.ts.net.', HostName: 'box', OS: 'linux', Online: true, TailscaleIPs: ['fd7a::1', '100.64.0.2'] },
        b: { DNSName: 'win.tail.ts.net.', OS: 'windows', Online: true, TailscaleIPs: ['100.64.0.3'] },
        c: { DNSName: 'off.tail.ts.net.', OS: 'linux', Online: false, TailscaleIPs: ['100.64.0.4'] },
        d: { DNSName: 'phone.tail.ts.net.', OS: 'iOS', Online: true, TailscaleIPs: ['100.64.0.5'] },
        e: { DNSName: 'mac.tail.ts.net.', OS: 'macOS', Online: true, TailscaleIPs: ['100.64.0.6'] }
      }
    }
    expect(parseTailscaleStatus(JSON.stringify(status))).toEqual([
      { source: 'tailscale', host: 'box.tail.ts.net', address: '100.64.0.2', os: 'linux' },
      { source: 'tailscale', host: 'win.tail.ts.net', address: '100.64.0.3', os: 'windows' }
    ])
  })
  it('anything unreadable is none', () => {
    expect(parseTailscaleStatus('')).toEqual([])
    expect(parseTailscaleStatus('null')).toEqual([])
    expect(parseTailscaleStatus('{"Peer":{"x":null}}')).toEqual([])
  })
})

describe('mergeFound', () => {
  const paired = [{ runtimeId: 'rt_ab12', address: '192.168.1.5', fingerprint: FP }]
  it('marks a beacon paired only under the paired pin', () => {
    const [ok] = mergeFound([{ ...beacon, address: '192.168.1.20' }], [], paired)
    expect(ok).toEqual({ key: 'rt:rt_ab12@192.168.1.20', name: 'Office', address: '192.168.1.20', port: 47831, os: 'linux', sources: ['lan'], paired: 'rt_ab12' })
    const [other] = mergeFound([{ ...beacon, fingerprint: 'B'.repeat(43), address: '192.168.1.20' }], [], paired)
    expect(other).not.toHaveProperty('paired')
  })
  it('a beacon and a Tailscale peer at one address are one device; a peer at a paired address is paired', () => {
    const peers = [
      { source: 'tailscale' as const, host: 'office.ts.net', address: '100.64.0.2', os: 'linux' },
      { source: 'tailscale' as const, host: 'box.ts.net', address: '192.168.1.5', os: 'linux' },
      { source: 'tailscale' as const, host: 'win.ts.net', address: '100.64.0.9', os: 'windows' }
    ]
    const found = mergeFound([{ ...beacon, runtimeId: 'rt_cd', address: '100.64.0.2' }], peers, paired)
    expect(found.map((f) => [f.key, f.sources, f.paired])).toEqual([
      ['ts:box.ts.net', ['tailscale'], 'rt_ab12'],
      ['rt:rt_cd@100.64.0.2', ['lan', 'tailscale'], undefined],
      ['ts:win.ts.net', ['tailscale'], undefined]
    ])
  })
})
