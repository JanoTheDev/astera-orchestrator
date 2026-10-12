// Where this computer can listen as a Runtime, as Settings offers it: its own private addresses (a LAN's or
// Tailscale's), and itself alone. Every interface (0.0.0.0) is never offered: the docs say not to open the port to
// the internet, and a person choosing from a list should not be one click from it.
import { describe, it, expect } from 'vitest'
import type { NetworkInterfaceInfo } from 'node:os'
import { listenChoices, privateIPv4s } from './addresses'

const nic = (address: string, o: Partial<NetworkInterfaceInfo> = {}): NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null, ...o }) as NetworkInterfaceInfo

const interfaces = {
  'Wi-Fi': [nic('192.168.0.235'), nic('fe80::1', { family: 'IPv6' })],
  Tailscale: [nic('100.101.102.103')],
  Ethernet: [nic('10.0.0.5'), nic('172.20.1.2')],
  Public: [nic('203.0.113.9')],
  Loopback: [nic('127.0.0.1', { internal: true })]
}

describe('privateIPv4s', () => {
  it("is this machine's private IPv4 addresses with their interface, never a public, internal or IPv6 one", () => {
    expect(privateIPv4s(interfaces)).toEqual([
      { address: '192.168.0.235', iface: 'Wi-Fi' },
      { address: '100.101.102.103', iface: 'Tailscale' },
      { address: '10.0.0.5', iface: 'Ethernet' },
      { address: '172.20.1.2', iface: 'Ethernet' }
    ])
  })

  // Seen on this PC's own Settings: Hyper-V's and WSL's virtual switches have private addresses no other computer can
  // reach. They are left out the way MCP over HTTP leaves them out (core/net/adapters.ts); an External switch carries
  // the physical LAN address and stays.
  it("leaves out virtual adapters other computers cannot reach, and keeps a Hyper-V External switch", () => {
    expect(
      privateIPv4s({
        'vEthernet (Default Switch)': [nic('172.20.160.1')],
        'vEthernet (WSL (Hyper-V firewall))': [nic('172.30.128.1')],
        'VMware Network Adapter VMnet8': [nic('192.168.56.1')],
        'vEthernet (LAN)': [nic('192.168.0.10')]
      })
    ).toEqual([{ address: '192.168.0.10', iface: 'vEthernet (LAN)' }])
  })

  it('keeps the ranges the pairing string uses: 172.16/12 and 100.64/10, not their neighbours', () => {
    expect(privateIPv4s({ a: [nic('172.15.0.1'), nic('172.32.0.1'), nic('100.63.0.1'), nic('100.128.0.1')] })).toEqual([])
  })
})

describe('listenChoices', () => {
  it("offers the private addresses, then this computer only, and never every interface", () => {
    const choices = listenChoices(interfaces)
    expect(choices.map((c) => c.address)).toEqual(['192.168.0.235', '100.101.102.103', '10.0.0.5', '172.20.1.2', '127.0.0.1'])
    expect(choices.find((c) => c.address === '127.0.0.1')?.local).toBe(true)
    expect(choices.some((c) => c.address === '0.0.0.0' || c.address === '::')).toBe(false)
  })
})
