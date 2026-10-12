// Adapter names of virtual networks, shared by MCP over HTTP's offered hosts (cli/mcp/http.ts) and the addresses a
// Runtime offers to listen on (core/remote/addresses.ts): other devices cannot reach their addresses.

/** Adapter names of virtual networks on this machine, case-insensitive. Other devices cannot reach their
 *  addresses. Windows names are matched anywhere: Hyper-V's `vEthernet (Default Switch)` and WSL's
 *  `vEthernet (WSL (Hyper-V firewall))`, `VirtualBox Host-Only Network`, `VMware Network Adapter VMnet1`,
 *  `Loopback Pseudo-Interface 1`. A bare `vEthernet` is not virtual: a Hyper-V External switch puts the
 *  physical LAN address on `vEthernet (<switch name>)`. Linux and macOS names are matched at the start:
 *  docker's `docker0`, `br-<hex>`, `veth<hex>` (but not `vEthernet`), libvirt's
 *  `virbr0`, VirtualBox's `vboxnet0`, VMware's `vmnet8`.
 *  Substring terms can still catch a physical adapter someone renamed to contain one (`wsl`, `docker`); that
 *  is accepted, and a typed `--hosts` address is offered regardless. */
const VIRTUAL_ADAPTER = /default switch|wsl|hyper-v|docker|virtualbox|vmware|loopback|^(?:br-|veth(?!ernet)|virbr|vboxnet|vmnet)/i

/** Whether an adapter of this name is a virtual network other devices cannot reach. */
export function isVirtualAdapter(name: string): boolean {
  return VIRTUAL_ADAPTER.test(name)
}
