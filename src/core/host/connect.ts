// The app's side of the Host handshake: the package's (packages/client/src/connect.ts), with the MCP client name
// cleaned the way the Host stores it (core/continuity/actor.ts). The CLI and its MCP server call this.
import { connectHost as connect, type ConnectFailure, type HostConnection as PackageConnection } from '../publicContract'
import { mcpClientOf, type McpClient } from '../continuity/actor'
import type { ClientMessage, HostMessage } from './protocol'

export type { ConnectFailure }

/** The package's connection, read with the app's whole protocol: the package types a connection by the messages it
 *  knows, and the same socket carries every message the app and the Host exchange. */
export interface HostConnection extends Omit<PackageConnection, 'call' | 'onMessage'> {
  call(m: ClientMessage): void
  onMessage(cb: (m: HostMessage) => void): () => void
}

export async function connectHost(
  a: Omit<Parameters<typeof connect>[0], 'client'> & { client?: McpClient }
): Promise<HostConnection | ConnectFailure> {
  const client = mcpClientOf(a.client)
  const { client: _given, ...rest } = a
  return (await connect({ ...rest, ...(client ? { client } : {}) })) as HostConnection | ConnectFailure
}
