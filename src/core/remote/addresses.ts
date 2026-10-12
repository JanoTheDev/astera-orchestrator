// The addresses this computer can serve as a Runtime on: the pairing string's rule (a private IPv4: RFC 1918, or the
// 100.64/10 range Tailscale uses), shared by the CLI's pairing string and Settings' address choice.
import type { NetworkInterfaceInfo } from 'node:os'
import { isVirtualAdapter } from '../net/adapters'

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/

type Interfaces = Record<string, NetworkInterfaceInfo[] | undefined>

/** This machine's private IPv4 addresses, in the order the system lists them, with the interface each is on; none of a
 *  virtual adapter (Hyper-V's Default Switch, WSL, VMware...), which no other computer can reach (core/net/adapters.ts). */
export function privateIPv4s(interfaces: Interfaces): Array<{ address: string; iface: string }> {
  const out: Array<{ address: string; iface: string }> = []
  for (const [iface, list] of Object.entries(interfaces)) {
    if (isVirtualAdapter(iface)) continue
    for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal && PRIVATE.test(n.address)) out.push({ address: n.address, iface })
  }
  return out
}

/** What Settings offers to listen on: the private addresses, then 127.0.0.1 (this computer only, `local`). Every
 *  interface (0.0.0.0, ::) is never offered: the docs say not to open the port beyond a private network, and a person
 *  choosing from a list should not be one click from it. */
export function listenChoices(interfaces: Interfaces): Array<{ address: string; iface: string | null; local: boolean }> {
  return [...privateIPv4s(interfaces).map((a) => ({ ...a, local: false })), { address: '127.0.0.1', iface: null, local: true }]
}
